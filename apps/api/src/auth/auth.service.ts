import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import QRCode from 'qrcode';
import { legacyFromGrants, parseOrganizationSettings, resolveGrants } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { env } from '../common/env';
import { newToken, sha256 } from '../common/tokens';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from './mfa';
import { dummyHash, hashPassword, verifyPassword } from './password';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 30;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
/** A half-signed-in session (password only) lives this long. */
const MFA_PENDING_TTL_MIN = 10;
/** Wrong codes allowed on one half-signed-in session before it is discarded. */
const MFA_MAX_FAILURES = 5;
const MFA_ISSUER = 'FG One';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ───────── login / sessions ─────────

  async login(email: string, password: string, meta: ClientMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });
    const invalid = new UnauthorizedException('Invalid email or password');

    if (!user || !user.passwordHash) {
      await verifyPassword(await dummyHash(), password); // constant-ish timing
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Too many failed attempts. Try again in 15 minutes or ask your administrator for help.');
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      if (failed >= MAX_FAILED) {
        await this.audit.log({ organizationId: user.organizationId, userId: user.id, ip: meta.ip }, 'auth.locked', 'user', user.id);
      }
      throw invalid;
    }
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active. Contact your administrator.');
    if (user.organization.status !== 'ACTIVE') throw new ForbiddenException('This workspace is suspended.');

    if (user.mfaEnabledAt && user.mfaSecretEnc && !env().MFA_BYPASS_LOCAL) {
      // Password is right; the second step is still owed. Failed-login counters reset only after it.
      const pending = await this.createSession(user.id, user.organizationId, 0, meta, { mfaPendingMinutes: MFA_PENDING_TTL_MIN });
      return { ...pending, mfaRequired: true, demoMfaCode: this.isDemoMfaAccount(user.email) ? env().DEMO_MFA_CODE : null };
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const token = await this.createSession(user.id, user.organizationId, parseOrganizationSettings(user.organization.settings).auth.sessionTtlHours, meta);
    await this.audit.log({ organizationId: user.organizationId, userId: user.id, ip: meta.ip }, 'auth.login', 'user', user.id);
    return { ...token, mfaRequired: false, demoMfaCode: null };
  }

  async createSession(userId: string, organizationId: string, ttlHours: number, meta: ClientMeta, opts: { mfaPendingMinutes?: number } = {}) {
    const token = newToken();
    const pending = !!opts.mfaPendingMinutes;
    const expiresAt = new Date(Date.now() + (pending ? opts.mfaPendingMinutes! * 60_000 : ttlHours * 3600_000));
    await this.prisma.session.create({
      data: { tokenHash: sha256(token), userId, organizationId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300), mfaPending: pending },
    });
    return { token, expiresAt };
  }

  /** Second sign-in step. Replaces the half-signed-in session with a fresh one (new token). */
  async verifyMfaLogin(auth: AuthContext, code: string, meta: ClientMeta) {
    const session = await this.prisma.session.findUnique({ where: { id: auth.sessionId } });
    if (!session?.mfaPending) throw new BadRequestException('You are already signed in');
    const method = await this.checkSecondFactor(auth.userId, code);
    const ctx = { organizationId: auth.organizationId, userId: auth.userId, ip: meta.ip };
    if (!method) {
      const failures = session.mfaFailures + 1;
      await this.audit.log(ctx, 'auth.mfa_failed', 'user', auth.userId, { attempt: failures });
      if (failures >= MFA_MAX_FAILURES) {
        await this.prisma.session.deleteMany({ where: { id: session.id } });
        throw new UnauthorizedException('Too many wrong codes. Sign in again.');
      }
      await this.prisma.session.update({ where: { id: session.id }, data: { mfaFailures: failures } });
      throw new BadRequestException('That code is not correct. Check your authenticator app and try again.');
    }
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    const [, , token] = await Promise.all([
      this.prisma.session.deleteMany({ where: { id: session.id } }),
      this.prisma.user.update({ where: { id: auth.userId }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }),
      this.createSession(auth.userId, auth.organizationId, parseOrganizationSettings(org.settings).auth.sessionTtlHours, meta),
    ]);
    await this.audit.log(ctx, 'auth.login', 'user', auth.userId, { mfa: method });
    return token;
  }

  async validateSession(token: string, ip?: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        user: {
          include: {
            role: { include: { grants: true } },
            extraRoles: { include: { role: { include: { grants: true } } } },
            permissionOverrides: true,
            organization: { select: { status: true } },
          },
        },
      },
    });
    if (!session) return null;
    if (session.expiresAt < new Date() || session.user.status !== 'ACTIVE' || session.user.organization.status !== 'ACTIVE') {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    // Defence in depth: the session's tenant must match the user's tenant.
    if (session.organizationId !== session.user.organizationId) return null;
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    const u = session.user;
    // Extra roles must belong to the same tenant (defence in depth).
    const roles = [u.role, ...u.extraRoles.map((x) => x.role).filter((r) => r.organizationId === u.organizationId)];
    const mfaEnabled = !!(u.mfaEnabledAt && u.mfaSecretEnc);
    // Super Admin authority is dormant until two-step verification is on.
    // Dormant until two-step verification is on and any admin-set temporary password has been replaced.
    const isSuperAdmin = u.accountType === 'INTERNAL' && u.isSuperAdmin && mfaEnabled && !u.mustChangePassword;
    const grants = session.mfaPending || u.mustChangePassword ? {} : resolveGrants(roles, u.permissionOverrides, { isSuperAdmin, accountType: u.accountType });
    return {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      email: session.user.email,
      roleKey: session.user.role.key,
      rank: session.user.role.rank,
      permissions: legacyFromGrants(grants),
      grants,
      isSuperAdmin,
      accountType: u.accountType,
      mfaPending: session.mfaPending,
      mfaEnabled,
      mustChangePassword: u.mustChangePassword,
      superAdminNeedsMfa: u.accountType === 'INTERNAL' && u.isSuperAdmin && !mfaEnabled,
      authenticatedAt: session.authenticatedAt,
      ip,
    };
  }

  async logout(auth: AuthContext) {
    await this.prisma.session.deleteMany({ where: { id: auth.sessionId } });
    await this.audit.log(auth, 'auth.logout', 'user', auth.userId);
  }

  // ───────── password reset ─────────

  /** Always resolves the same way whether or not the email exists (no account enumeration). */
  async requestPasswordReset(email: string, meta: ClientMeta) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { organization: { select: { settings: true } } } });
    if (!user || user.status !== 'ACTIVE') return;
    // With admin-managed passwords there is no self-service reset; the same reply is returned (no enumeration).
    if (!parseOrganizationSettings(user.organization.settings).auth.selfServicePassword) return;
    // Invalidate older outstanding tokens.
    await this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    const token = newToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000) },
    });
    const link = `${env().WEB_ORIGIN}/reset-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Reset your FG One password',
      text: `Hi ${user.firstName},\n\nUse the link below to set a new FG One password. It expires in ${RESET_TTL_MIN} minutes.\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    });
    await this.audit.log({ organizationId: user.organizationId, userId: user.id, ip: meta.ip }, 'auth.password_reset_requested', 'user', user.id);
  }

  async resetPassword(token: string, password: string, meta: ClientMeta) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { organization: { select: { settings: true } } } } } });
    // Links issued before the organization switched to admin-managed passwords stop working too.
    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.status !== 'ACTIVE' || !parseOrganizationSettings(record.user.organization.settings).auth.selfServicePassword) {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      // They chose this password themselves, so any temporary-password flag is cleared.
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null, mustChangePassword: false } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.session.deleteMany({ where: { userId: record.userId } }), // sign out everywhere
    ]);
    await this.audit.log({ organizationId: record.user.organizationId, userId: record.userId, ip: meta.ip }, 'auth.password_reset', 'user', record.userId);
    return { userId: record.userId };
  }

  async changePassword(auth: AuthContext, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, include: { organization: { select: { settings: true } } } });
    // With admin-managed passwords, people only replace a temporary one an admin marked for change.
    if (!user.mustChangePassword && !parseOrganizationSettings(user.organization.settings).auth.selfServicePassword) {
      throw new ForbiddenException('Passwords are managed by your administrator. Ask them to set a new one.');
    }
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (current === next) throw new BadRequestException('Choose a password different from your current one');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } }),
      this.prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: auth.sessionId } } }),
    ]);
    await this.audit.log(auth, 'auth.password_changed', 'user', user.id);
  }

  // ───────── two-step verification ─────────

  /** Demo accounts (DEMO_MFA_EMAILS) may use the fixed DEMO_MFA_CODE. Remove both env vars before go-live. */
  isDemoMfaAccount(email: string) {
    const e = env();
    return !!e.DEMO_MFA_CODE && e.DEMO_MFA_EMAILS.includes(email.toLowerCase());
  }

  // ───────── demo passwordless sign-in (remove before go-live) ─────────

  /** Whether an account may be signed in without a password. Only the listed demo accounts, never in production. */
  private isDemoPasswordlessAccount(email: string) {
    const e = env();
    return e.DEMO_PASSWORDLESS_LOGIN && e.DEMO_MFA_EMAILS.includes(email.toLowerCase());
  }

  /** The login screen asks this to decide whether to show the "Sign in without a password" link. */
  async demoAccounts() {
    if (!env().DEMO_PASSWORDLESS_LOGIN) return { enabled: false as const, accounts: [] };
    const emails = env().DEMO_MFA_EMAILS;
    if (!emails.length) return { enabled: true as const, accounts: [] };
    const users = await this.prisma.user.findMany({
      where: { email: { in: emails }, status: 'ACTIVE', accountType: 'INTERNAL' },
      select: { email: true, firstName: true, lastName: true, avatarColor: true, role: { select: { name: true, rank: true } } },
      orderBy: { role: { rank: 'desc' } },
    });
    return {
      enabled: true as const,
      accounts: users.map((u) => ({ email: u.email, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role?.name ?? null, avatarColor: u.avatarColor })),
    };
  }

  /**
   * Signs a demo account in with no password and no two-step code. Guarded three ways: the feature
   * flag, the production boot-check in env(), and an explicit allow-list of demo emails. A disabled
   * feature or a non-listed email is reported as "not found" so the route is invisible when off.
   */
  async demoLogin(email: string, meta: ClientMeta) {
    const notAvailable = new NotFoundException('Not found');
    if (!env().DEMO_PASSWORDLESS_LOGIN) throw notAvailable;
    const normalized = email.toLowerCase();
    if (!this.isDemoPasswordlessAccount(normalized)) throw notAvailable;
    const user = await this.prisma.user.findUnique({ where: { email: normalized }, include: { organization: true } });
    if (!user || user.accountType !== 'INTERNAL') throw notAvailable;
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active. Contact your administrator.');
    if (user.organization.status !== 'ACTIVE') throw new ForbiddenException('This workspace is suspended.');
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const token = await this.createSession(user.id, user.organizationId, parseOrganizationSettings(user.organization.settings).auth.sessionTtlHours, meta);
    await this.audit.log({ organizationId: user.organizationId, userId: user.id, ip: meta.ip }, 'auth.demo_login', 'user', user.id);
    return token;
  }

  /** Checks an authenticator code (no replay) or consumes a recovery code. Returns how the user proved it, or null. */
  private async checkSecondFactor(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, mfaSecretEnc: true, mfaLastStep: true, mfaEnabledAt: true } });
    if (!user.mfaEnabledAt || !user.mfaSecretEnc) return null;
    const trimmed = code.trim();
    if (this.isDemoMfaAccount(user.email) && trimmed.replace(/\s/g, '') === env().DEMO_MFA_CODE) return 'totp';
    if (/^\d{6}$/.test(trimmed.replace(/\s/g, ''))) {
      const step = verifyTotp(decryptSecret(user.mfaSecretEnc), trimmed, user.mfaLastStep);
      if (step === null) return null;
      // Conditional write: two requests racing with the same code cannot both succeed.
      const { count } = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
        data: { mfaLastStep: step },
      });
      return count === 1 ? 'totp' : null;
    }
    const hash = hashRecoveryCode(trimmed);
    const used = await this.prisma.$executeRaw`UPDATE "User" SET "mfaRecoveryCodes" = array_remove("mfaRecoveryCodes", ${hash}) WHERE id = ${userId} AND ${hash} = ANY("mfaRecoveryCodes")`;
    return used === 1 ? 'recovery' : null;
  }

  async mfaStatus(auth: AuthContext) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { mfaEnabledAt: true, mfaRecoveryCodes: true, isSuperAdmin: true } });
    return {
      enabled: auth.mfaEnabled,
      enabledAt: u.mfaEnabledAt,
      recoveryCodesLeft: auth.mfaEnabled ? u.mfaRecoveryCodes.length : 0,
      /** Super Admins must keep it on. */
      required: u.isSuperAdmin,
    };
  }

  /** Starts enrolment: a new secret the user adds to their authenticator app. Nothing changes until a code is confirmed. */
  async mfaSetup(auth: AuthContext) {
    if (auth.mfaEnabled) throw new ConflictException('Two-step verification is already on');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: auth.userId }, data: { mfaPendingSecretEnc: encryptSecret(secret) } });
    const url = otpauthUrl(secret, auth.email, MFA_ISSUER);
    return { secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
  }

  /** Finishes enrolment with the first code. Returns the recovery codes once; only their hashes are kept. */
  async mfaEnable(auth: AuthContext, code: string) {
    if (auth.mfaEnabled) throw new ConflictException('Two-step verification is already on');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { mfaPendingSecretEnc: true } });
    if (!u.mfaPendingSecretEnc) throw new BadRequestException('Start the setup again');
    const secret = decryptSecret(u.mfaPendingSecretEnc);
    const step = verifyTotp(secret, code, null);
    if (step === null) throw new BadRequestException('That code is not correct. Check the time on your phone and try again.');
    const codes = newRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: auth.userId },
        data: { mfaSecretEnc: u.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryCodes: codes.map(hashRecoveryCode) },
      }),
      // Other devices signed in with the password alone must sign in again.
      this.prisma.session.deleteMany({ where: { userId: auth.userId, NOT: { id: auth.sessionId } } }),
    ]);
    await this.audit.log(auth, 'auth.mfa_enabled', 'user', auth.userId);
    return { recoveryCodes: codes };
  }

  async mfaDisable(auth: AuthContext) {
    if (!auth.mfaEnabled) throw new BadRequestException('Two-step verification is not on');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { isSuperAdmin: true } });
    if (u.isSuperAdmin) {
      throw new ForbiddenException('Super Admins must keep two-step verification on. Ask another Super Admin to remove your Super Admin authority first.');
    }
    await this.prisma.user.update({
      where: { id: auth.userId },
      data: { mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] },
    });
    await this.audit.log(auth, 'auth.mfa_disabled', 'user', auth.userId);
    return { ok: true };
  }

  async regenerateRecoveryCodes(auth: AuthContext) {
    if (!auth.mfaEnabled) throw new BadRequestException('Two-step verification is not on');
    const codes = newRecoveryCodes();
    await this.prisma.user.update({ where: { id: auth.userId }, data: { mfaRecoveryCodes: codes.map(hashRecoveryCode) } });
    await this.audit.log(auth, 'auth.mfa_recovery_codes_regenerated', 'user', auth.userId);
    return { recoveryCodes: codes };
  }

  /** Re-authentication before sensitive actions: password, plus a code when two-step verification is on. */
  async reauth(auth: AuthContext, password: string, code?: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { passwordHash: true } });
    const passwordOk = !!u.passwordHash && (await verifyPassword(u.passwordHash, password));
    if (!passwordOk) {
      await this.audit.log(auth, 'auth.reauth_failed', 'user', auth.userId, { reason: 'password' });
      throw new BadRequestException('That password is not correct');
    }
    if (auth.mfaEnabled && !env().MFA_BYPASS_LOCAL) {
      if (!code) throw new BadRequestException('Enter the code from your authenticator app');
      if (!(await this.checkSecondFactor(auth.userId, code))) {
        await this.audit.log(auth, 'auth.reauth_failed', 'user', auth.userId, { reason: 'code' });
        throw new BadRequestException('That code is not correct');
      }
    }
    await this.prisma.session.update({ where: { id: auth.sessionId }, data: { authenticatedAt: new Date() } });
    await this.audit.log(auth, 'auth.reauthenticated', 'user', auth.userId);
    return { ok: true };
  }

  // ───────── sessions (devices) ─────────

  async listSessions(organizationId: string, userId: string, currentSessionId?: string) {
    const rows = await this.prisma.session.findMany({
      where: { userId, organizationId, mfaPending: false, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, current: r.id === currentSessionId }));
  }

  async revokeSession(auth: AuthContext, id: string) {
    if (id === auth.sessionId) throw new BadRequestException('To sign out of this device, use Sign out');
    const { count } = await this.prisma.session.deleteMany({ where: { id, userId: auth.userId } });
    if (!count) throw new NotFoundException('Session not found');
    await this.audit.log(auth, 'auth.session_revoked', 'session', id);
  }

  async revokeOtherSessions(auth: AuthContext) {
    const { count } = await this.prisma.session.deleteMany({ where: { userId: auth.userId, NOT: { id: auth.sessionId } } });
    await this.audit.log(auth, 'auth.sessions_revoked', 'user', auth.userId, { count });
    return { count };
  }

  /** The caller's own sign-in and sign-out events, plus MFA failures and session revocations. */
  async loginHistory(auth: AuthContext) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: {
          in: [
            'auth.login',
            'auth.demo_login',
            'auth.logout',
            'auth.locked',
            'auth.mfa_failed',
            'auth.password_reset',
            'auth.password_reset_requested',
            'auth.password_changed',
            'auth.reauthenticated',
            'auth.reauth_failed',
            'auth.session_revoked',
            'auth.sessions_revoked',
            'auth.invitation_accepted',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, createdAt: true, ip: true, metadata: true },
    });
    return rows;
  }

  // ───────── invitations ─────────

  private async findValidInvitation(token: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true, organization: { select: { name: true, logoUrl: true, primaryColor: true } } },
    });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.user.status !== 'INVITED') {
      throw new BadRequestException('This invitation is invalid or has expired. Ask your administrator for a new one.');
    }
    return inv;
  }

  async inspectInvitation(token: string) {
    const inv = await this.findValidInvitation(token);
    return { email: inv.user.email, firstName: inv.user.firstName, organization: inv.organization };
  }

  async acceptInvitation(token: string, password: string, meta: ClientMeta) {
    const inv = await this.findValidInvitation(token);
    const passwordHash = await hashPassword(password);
    const defaults = await this.prisma.channel.findMany({ where: { organizationId: inv.organizationId, isDefault: true }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: inv.userId }, data: { passwordHash, status: 'ACTIVE', lastLoginAt: new Date() } }),
      this.prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
      this.prisma.channelMember.createMany({ data: defaults.map((c) => ({ channelId: c.id, userId: inv.userId })), skipDuplicates: true }),
    ]);
    await this.audit.log({ organizationId: inv.organizationId, userId: inv.userId, ip: meta.ip }, 'auth.invitation_accepted', 'user', inv.userId);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: inv.organizationId } });
    return this.createSession(inv.userId, inv.organizationId, parseOrganizationSettings(org.settings).auth.sessionTtlHours, meta);
  }
}
