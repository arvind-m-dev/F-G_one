import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseOrganizationSettings, SUPER_ADMIN_HARD_LIMIT } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import { verifyPassword } from '../auth/password';
import type { AuthContext } from '../common/auth-context';
import { env } from '../common/env';
import { newToken, sha256 } from '../common/tokens';
import { MailService } from '../mail/mail.service';
import { personSelect, toPerson } from '../employees/employee.mapper';
import { PrismaService } from '../prisma/prisma.service';

const INVITE_TTL_HOURS = 72;
type Tx = Prisma.TransactionClient;

/**
 * Super Admin authority (Phase 2b). Separate from roles; changed only here.
 * - limit: settings.security.superAdminLimit, capped at SUPER_ADMIN_HARD_LIMIT (active + pending invites)
 * - nominees must be active internal users and accept with their own password
 * - nobody changes their own authority; the last active Super Admin cannot be removed
 * - every check-and-write runs in a SERIALIZABLE transaction, so concurrent changes cannot bypass the rules
 */
@Injectable()
export class SuperAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private async limit(tx: Tx | PrismaService, organizationId: string) {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    return Math.min(parseOrganizationSettings(org.settings).security.superAdminLimit, SUPER_ADMIN_HARD_LIMIT);
  }
  private activeWhere = (organizationId: string): Prisma.UserWhereInput => ({ organizationId, isSuperAdmin: true, status: 'ACTIVE', accountType: 'INTERNAL' });
  private pendingWhere = (organizationId: string): Prisma.SuperAdminInvitationWhereInput => ({ organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } });

  private async confirmPassword(auth: AuthContext, password: string) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { passwordHash: true } });
    if (!me.passwordHash || !(await verifyPassword(me.passwordHash, password))) {
      await this.audit.log(auth, 'superadmin.reauth_failed', 'user', auth.userId);
      throw new ForbiddenException('That password is not correct');
    }
  }

  private async serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Another change happened at the same time. Please try again.');
      }
      throw e;
    }
  }

  async list(auth: AuthContext) {
    const [limit, active, pending] = await Promise.all([
      this.limit(this.prisma, auth.organizationId),
      this.prisma.user.findMany({ where: { organizationId: auth.organizationId, isSuperAdmin: true }, select: { ...personSelect, status: true, lastLoginAt: true }, orderBy: { firstName: 'asc' } }),
      this.prisma.superAdminInvitation.findMany({
        where: this.pendingWhere(auth.organizationId),
        include: { user: { select: personSelect }, invitedBy: { select: personSelect } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const activeCount = active.filter((a) => a.status === 'ACTIVE').length;
    return {
      limit,
      hardLimit: SUPER_ADMIN_HARD_LIMIT,
      used: activeCount + pending.length,
      superAdmins: active.map(({ status, lastLoginAt, ...p }) => ({ ...toPerson(p), status, lastLoginAt, isYou: p.id === auth.userId })),
      pending: pending.map((i) => ({ id: i.id, person: toPerson(i.user), invitedBy: i.invitedBy ? toPerson(i.invitedBy) : null, createdAt: i.createdAt, expiresAt: i.expiresAt })),
    };
  }

  async invite(auth: AuthContext, userId: string, password: string) {
    await this.confirmPassword(auth, password);
    const token = newToken();
    const result = await this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, organizationId: auth.organizationId } });
      if (!target) throw new NotFoundException('Person not found');
      if (target.isSuperAdmin) throw new ConflictException('They are already a Super Admin');
      if (target.accountType !== 'INTERNAL' || target.status !== 'ACTIVE') {
        throw new ConflictException('Only active employees who have set up their account can become Super Admins');
      }
      const limit = await this.limit(tx, auth.organizationId);
      await tx.superAdminInvitation.updateMany({ where: { userId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const used = (await tx.user.count({ where: this.activeWhere(auth.organizationId) })) + (await tx.superAdminInvitation.count({ where: this.pendingWhere(auth.organizationId) }));
      if (used >= limit) {
        throw new ConflictException(`Your organization allows ${limit} Super Admin${limit === 1 ? '' : 's'}, and that limit is reached (including pending invitations). Remove one or revoke an invitation first.`);
      }
      const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);
      const inv = await tx.superAdminInvitation.create({ data: { organizationId: auth.organizationId, userId, invitedById: auth.userId, tokenHash: sha256(token), expiresAt } });
      return { inv, target };
    });
    const url = `${env().WEB_ORIGIN}/super-admin/accept?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: result.target.email,
      subject: 'You have been nominated as a Super Admin on FG One',
      text: `Hi ${result.target.firstName},\n\nYou have been nominated as a Super Admin. Super Admins have full control of the workspace.\nSign in and confirm with your password here (valid for ${INVITE_TTL_HOURS} hours):\n\n${url}\n\nIf you did not expect this, ignore this email and tell your IT team.\n`,
    });
    await this.audit.log(auth, 'superadmin.invited', 'user', userId, { invitationId: result.inv.id });
    // The link only works for the nominee while signed in with their own password, so returning it is safe.
    return { id: result.inv.id, expiresAt: result.inv.expiresAt, url };
  }

  async revokeInvite(auth: AuthContext, id: string) {
    const inv = await this.prisma.superAdminInvitation.findFirst({ where: { id, organizationId: auth.organizationId, acceptedAt: null, revokedAt: null } });
    if (!inv) throw new NotFoundException('Invitation not found');
    await this.prisma.superAdminInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.log(auth, 'superadmin.invite_revoked', 'user', inv.userId, { invitationId: id });
    return { ok: true };
  }

  /** The nominee accepts while signed in as themselves. */
  async accept(auth: AuthContext, token: string, password: string) {
    await this.confirmPassword(auth, password);
    const inv = await this.serializable(async (tx) => {
      const inv = await tx.superAdminInvitation.findUnique({ where: { tokenHash: sha256(token) } });
      // Same answer for unknown, someone else's, used, revoked or expired links.
      if (!inv || inv.userId !== auth.userId || inv.organizationId !== auth.organizationId || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) {
        throw new NotFoundException('This nomination link is not valid. Ask a Super Admin for a new one.');
      }
      if (auth.accountType !== 'INTERNAL') throw new NotFoundException('This nomination link is not valid. Ask a Super Admin for a new one.');
      const limit = await this.limit(tx, auth.organizationId);
      const active = await tx.user.count({ where: this.activeWhere(auth.organizationId) });
      if (active >= limit) throw new ConflictException('The Super Admin limit has been reached. Ask a Super Admin to make room.');
      await tx.superAdminInvitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await tx.user.update({ where: { id: auth.userId }, data: { isSuperAdmin: true } });
      return inv;
    });
    await this.audit.log(auth, 'superadmin.accepted', 'user', auth.userId, { invitationId: inv.id, invitedById: inv.invitedById });
    return { ok: true };
  }

  async remove(auth: AuthContext, userId: string, password: string) {
    if (userId === auth.userId) throw new ForbiddenException('You cannot change your own Super Admin authority. Ask another Super Admin.');
    await this.confirmPassword(auth, password);
    await this.serializable(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, organizationId: auth.organizationId, isSuperAdmin: true } });
      if (!target) throw new NotFoundException('Super Admin not found');
      const remaining = await tx.user.count({ where: { ...this.activeWhere(auth.organizationId), id: { not: userId } } });
      if (remaining < 1) throw new ConflictException('You cannot remove the last active Super Admin.');
      await tx.user.update({ where: { id: userId }, data: { isSuperAdmin: false } });
    });
    await this.audit.log(auth, 'superadmin.removed', 'user', userId);
    return { ok: true };
  }
}
