import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { legacyFromGrants, parseOrganizationSettings, resolveGrants } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { env } from '../common/env';
import { newToken, sha256 } from '../common/tokens';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { dummyHash, hashPassword, verifyPassword } from './password';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 30;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

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
      throw new ForbiddenException('Too many failed attempts. Try again in a few minutes or reset your password.');
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

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const token = await this.createSession(user.id, user.organizationId, parseOrganizationSettings(user.organization.settings).auth.sessionTtlHours, meta);
    await this.audit.log({ organizationId: user.organizationId, userId: user.id, ip: meta.ip }, 'auth.login', 'user', user.id);
    return token;
  }

  async createSession(userId: string, organizationId: string, ttlHours: number, meta: ClientMeta) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
    await this.prisma.session.create({
      data: { tokenHash: sha256(token), userId, organizationId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
    });
    return { token, expiresAt };
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
    const grants = resolveGrants(roles, u.permissionOverrides, { isSuperAdmin: u.isSuperAdmin, accountType: u.accountType });
    return {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      email: session.user.email,
      roleKey: session.user.role.key,
      rank: session.user.role.rank,
      permissions: legacyFromGrants(grants),
      grants,
      isSuperAdmin: u.accountType === 'INTERNAL' && u.isSuperAdmin,
      accountType: u.accountType,
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
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
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
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.status !== 'ACTIVE') {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.session.deleteMany({ where: { userId: record.userId } }), // sign out everywhere
    ]);
    await this.audit.log({ organizationId: record.user.organizationId, userId: record.userId, ip: meta.ip }, 'auth.password_reset', 'user', record.userId);
  }

  async changePassword(auth: AuthContext, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } }),
      this.prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: auth.sessionId } } }),
    ]);
    await this.audit.log(auth, 'auth.password_changed', 'user', user.id);
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
