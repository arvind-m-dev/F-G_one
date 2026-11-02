import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  parseOrganizationSettings,
  resetPasswordSchema,
} from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext, Public } from '../common/auth-context';
import { env } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { employeeSelect, toEmployee } from '../employees/employee.mapper';
import { AuthService, ClientMeta } from './auth.service';

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
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt } = await this.auth.login(body.email, body.password, meta(req));
    setSessionCookie(res, token, expiresAt);
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth);
    res.clearCookie(env().SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  /** The signed-in user, their permissions and their organization's branding/settings. */
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
      role: { key: auth.roleKey, rank: auth.rank },
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
    await this.auth.resetPassword(body.token, body.password, meta(req));
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async change(@Auth() auth: AuthContext, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(auth, body.currentPassword, body.newPassword);
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
