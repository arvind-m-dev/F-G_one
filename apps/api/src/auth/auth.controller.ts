import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  parseOrganizationSettings,
  reauthSchema,
  resetPasswordSchema,
} from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext, ClientAllowed, MfaPendingAllowed, Public, RequireRecentAuth } from '../common/auth-context';
import { env } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { employeeSelect, toEmployee } from '../employees/employee.mapper';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthService, ClientMeta } from './auth.service';

/** Sign-in attempts per minute per client IP (raise only for local end-to-end test runs). */
const LOGIN_LIMIT = Number(process.env.LOGIN_RATE_LIMIT_PER_MIN ?? 10) || 10;

const meta = (req: Request): ClientMeta => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(env().SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt, mfaRequired } = await this.auth.login(body.email, body.password, meta(req));
    setSessionCookie(res, token, expiresAt);
    // With two-step verification on, this cookie only allows /auth/mfa/verify and sign out.
    return { ok: true, mfaRequired };
  }

  /** Second sign-in step: an authenticator or recovery code. Issues a new session cookie. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_LIMIT, ttl: 60_000 } })
  async verifyMfa(@Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Public so the guard does not reject the half-signed-in session; validated here instead.
    const raw = req.cookies?.[env().SESSION_COOKIE_NAME];
    const auth = raw ? await this.auth.validateSession(raw, req.ip) : null;
    if (!auth?.mfaPending) throw new UnauthorizedException('Sign in again');
    try {
      const { token, expiresAt } = await this.auth.verifyMfaLogin(auth, body.code, meta(req));
      setSessionCookie(res, token, expiresAt);
      return { ok: true };
    } catch (e) {
      if (e instanceof UnauthorizedException) res.clearCookie(env().SESSION_COOKIE_NAME, { path: '/' });
      throw e;
    }
  }

  @ClientAllowed()
  @MfaPendingAllowed()
  @Post('logout')
  @HttpCode(200)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth);
    this.realtime.disconnectSession(auth.sessionId);
    res.clearCookie(env().SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  /** The signed-in user, their permissions and their organization's branding/settings. */
  @ClientAllowed()
  @Get('me')
  async me(@Auth() auth: AuthContext) {
    const [user, org, prefs] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: employeeSelect }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { preferences: true } }),
    ]);
    return {
      user: toEmployee(user, { privileged: true, online: true }),
      permissions: auth.permissions,
      grants: auth.grants,
      role: { key: auth.roleKey, rank: auth.rank },
      isSuperAdmin: auth.isSuperAdmin,
      accountType: auth.accountType,
      mfaEnabled: auth.mfaEnabled,
      superAdminNeedsMfa: auth.superAdminNeedsMfa,
      preferences: prefs.preferences,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logoUrl: org.logoUrl,
        primaryColor: org.primaryColor,
        secondaryColor: org.secondaryColor,
        settings: parseOrganizationSettings(org.settings),
      },
    };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }, @Req() req: Request) {
    await this.auth.requestPasswordReset(body.email, meta(req));
    return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>, @Req() req: Request) {
    const { userId } = await this.auth.resetPassword(body.token, body.password, meta(req));
    this.realtime.disconnectUser(userId);
    return { ok: true };
  }

  @ClientAllowed()
  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async change(@Auth() auth: AuthContext, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(auth, body.currentPassword, body.newPassword);
    this.realtime.disconnectUser(auth.userId, auth.sessionId);
    return { ok: true };
  }

  // ───────── re-authentication ─────────

  @ClientAllowed()
  @Post('reauth')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  reauth(@Auth() auth: AuthContext, @Body(new ZodPipe(reauthSchema)) body: z.infer<typeof reauthSchema>) {
    return this.auth.reauth(auth, body.password, body.code);
  }

  // ───────── two-step verification ─────────

  @ClientAllowed()
  @Get('mfa')
  mfaStatus(@Auth() auth: AuthContext) {
    return this.auth.mfaStatus(auth);
  }

  @ClientAllowed()
  @RequireRecentAuth()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@Auth() auth: AuthContext) {
    return this.auth.mfaSetup(auth);
  }

  /** No recent-auth check: it only completes a setup that already required one, and it can only add protection. */
  @ClientAllowed()
  @Post('mfa/enable')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async mfaEnable(@Auth() auth: AuthContext, @Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    const result = await this.auth.mfaEnable(auth, body.code);
    this.realtime.disconnectUser(auth.userId, auth.sessionId);
    return result;
  }

  @ClientAllowed()
  @RequireRecentAuth()
  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(@Auth() auth: AuthContext) {
    return this.auth.mfaDisable(auth);
  }

  @ClientAllowed()
  @RequireRecentAuth()
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  regenerateRecoveryCodes(@Auth() auth: AuthContext) {
    return this.auth.regenerateRecoveryCodes(auth);
  }

  // ───────── sessions (devices) ─────────

  @ClientAllowed()
  @Get('sessions')
  sessions(@Auth() auth: AuthContext) {
    return this.auth.listSessions(auth.organizationId, auth.userId, auth.sessionId);
  }

  @ClientAllowed()
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@Auth() auth: AuthContext) {
    const result = await this.auth.revokeOtherSessions(auth);
    this.realtime.disconnectUser(auth.userId, auth.sessionId);
    return result;
  }

  @ClientAllowed()
  @Post('sessions/:id/revoke')
  @HttpCode(200)
  async revokeSession(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.auth.revokeSession(auth, id);
    this.realtime.disconnectSession(id);
    return { ok: true };
  }

  @Public()
  @Get('invitations/:token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  inspect(@Param('token') token: string) {
    return this.auth.inspectInvitation(token);
  }

  @Public()
  @Post('accept-invitation')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async accept(@Body(new ZodPipe(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt } = await this.auth.acceptInvitation(body.token, body.password, meta(req));
    setSessionCookie(res, token, expiresAt);
    return { ok: true };
  }
}
