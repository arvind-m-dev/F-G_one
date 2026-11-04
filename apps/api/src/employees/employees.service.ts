import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  accessGains,
  allowBlockReason,
  CATALOG_BY_KEY,
  gainsBlockReason,
  hasPermission,
  parseOrganizationSettings,
  PERMISSIONS,
  resolveGrants,
  roleBlockReason,
  widestScope,
  type AccessActor,
  type CreateAccountInput,
  type PermissionOverrideInput,
  type Scope,
  type SuspendEmployeeInput,
  type UpdateEmployeeAccessInput,
  type UpdateEmployeeInput,
} from '@fg/shared';
import { AttendanceService } from '../attendance/attendance.service';
import { likeContains } from '../common/like';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import { RECENT_AUTH_DEFAULT_MINUTES, type AuthContext } from '../common/auth-context';
import { toDateOnly } from '../common/dates';
import { env } from '../common/env';
import { newToken, sha256 } from '../common/tokens';
import { LeaveService } from '../leave/leave.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { employeeSelect, toEmployee } from './employee.mapper';

const INVITE_TTL_DAYS = 7;
/** Role columns needed to resolve and check access. */
const roleAccessSelect = {
  id: true,
  key: true,
  name: true,
  rank: true,
  organizationId: true,
  archivedAt: true,
  grants: { select: { permission: true, scope: true } },
} satisfies Prisma.RoleSelect;
type RoleAccess = Prisma.RoleGetPayload<{ select: typeof roleAccessSelect }>;
type OverrideRow = { permission: string; effect: 'ALLOW' | 'DENY'; scope: Scope | null };
/** A person's current access assignment. */
interface AccessState {
  roleId: string;
  extraRoleIds: string[];
  roles: RoleAccess[];
  overrides: OverrideRow[];
}
/** People who can be picked as someone's manager or department head. */
export const PICKABLE_STATUSES = ['ACTIVE', 'INVITED'] as const;

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#22c55e'];

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeGateway,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
  ) {}

  private privileged(auth: AuthContext) {
    return hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE);
  }

  async list(auth: AuthContext, q: { q?: string; departmentId?: string; status: string; page: number; pageSize: number }) {
    const privileged = this.privileged(auth);
    const status = privileged ? q.status : 'ACTIVE'; // non-admins only see active colleagues
    const where: Prisma.UserWhereInput = {
      organizationId: auth.organizationId,
      // "All" leaves out archived accounts: they only show when asked for.
      status: status === 'ALL' ? { not: 'ARCHIVED' } : (status as Prisma.EnumUserStatusFilter['equals']),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.q
        ? {
            OR: [
              { firstName: likeContains(q.q) },
              { lastName: likeContains(q.q) },
              { displayName: likeContains(q.q) },
              { email: likeContains(q.q) },
              { designation: likeContains(q.q) },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: employeeSelect,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map((r) => toEmployee(r, { privileged, online: this.realtime.isOnline(r.id) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(auth: AuthContext, id: string) {
    const privileged = this.privileged(auth);
    const row = await this.prisma.user.findFirst({
      where: { id, organizationId: auth.organizationId, ...(privileged ? {} : { status: 'ACTIVE' }) },
      select: { ...employeeSelect, reports: { where: { status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true, designation: true } } },
    });
    if (!row) throw new NotFoundException('Employee not found');
    const { reports, ...rest } = row;
    return { ...toEmployee(rest, { privileged: privileged || id === auth.userId, online: this.realtime.isOnline(id) }), reports };
  }

  /**
   * Ensures the actor may manage the target and may assign `roleId`.
   * - Only a Super Admin may manage a Super Admin.
   * - Otherwise the target's role must rank below the actor's (Super Admins are exempt).
   */
  private async assertRoleAuthority(auth: AuthContext, opts: { targetRank?: number; targetIsSuperAdmin?: boolean; roleId?: string }) {
    const isSuper = auth.isSuperAdmin;
    if (opts.targetIsSuperAdmin && !isSuper) throw new ForbiddenException('Only a Super Admin can manage a Super Admin');
    if (opts.targetRank !== undefined && !isSuper && opts.targetRank >= auth.rank) {
      throw new ForbiddenException('You cannot manage a user with an equal or higher role');
    }
    if (opts.roleId) {
      const role = await this.prisma.role.findFirst({ where: { id: opts.roleId, organizationId: auth.organizationId } });
      if (!role) throw new BadRequestException('Unknown role');
      if (!isSuper && role.rank >= auth.rank) throw new ForbiddenException('You cannot assign a role equal to or above your own');
      return role;
    }
    return null;
  }

  /** Work emails must use one of the organization's allowed domains. */
  private assertCompanyDomain(settings: Prisma.JsonValue, email: string) {
    const domains = parseOrganizationSettings(settings).auth.allowedEmailDomains.map((d) => d.toLowerCase());
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    if (!domains.includes(domain)) throw new BadRequestException(`Email must use a company domain (${domains.join(', ')})`);
  }

  private async assertRefs(auth: AuthContext, input: { departmentId?: string | null; managerId?: string | null }, selfId?: string) {
    if (input.departmentId) {
      const ok = await this.prisma.department.count({ where: { id: input.departmentId, organizationId: auth.organizationId } });
      if (!ok) throw new BadRequestException('Unknown department');
    }
    if (input.managerId) {
      if (input.managerId === selfId) throw new BadRequestException('An employee cannot be their own manager');
      // Suspended, deactivated and archived people can't be picked as a manager.
      const ok = await this.prisma.user.count({ where: { id: input.managerId, organizationId: auth.organizationId, status: { in: [...PICKABLE_STATUSES] } } });
      if (!ok) throw new BadRequestException('Unknown manager');
    }
  }

  /**
   * Creates an account (the wizard's last step): person, main role, optional extra roles and exceptions,
   * and a password the admin hands over. Everything is written in one transaction with the same
   * escalation checks as changing access later.
   */
  async create(auth: AuthContext, input: CreateAccountInput) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    const selfService = parseOrganizationSettings(org.settings).auth.selfServicePassword;
    this.assertCompanyDomain(org.settings, input.email);
    await this.assertRoleAuthority(auth, { roleId: input.roleId });
    await this.assertRefs(auth, input);
    const extraRoleIds = input.extraRoleIds ?? [];
    const overrides = input.overrides ?? [];
    // Giving more than the main role is a sensitive change, like editing access later.
    if (extraRoleIds.length || overrides.length) this.assertRecentAuth(auth);
    const plan = await this.planAccess(auth, null, { roleId: input.roleId, extraRoleIds, overrides });

    if (await this.prisma.user.findUnique({ where: { email: input.email } })) throw new ConflictException('An account with this email already exists');
    if (input.employeeCode && (await this.prisma.user.count({ where: { organizationId: auth.organizationId, employeeCode: input.employeeCode } }))) {
      throw new ConflictException('Employee code already in use');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: auth.organizationId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          roleId: input.roleId,
          departmentId: input.departmentId ?? null,
          managerId: input.managerId ?? null,
          designation: input.designation ?? null,
          employeeCode: input.employeeCode || null,
          joinedAt: toDateOnly(input.joinedAt) ?? null,
          avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
          // The admin hands over a temporary password; the employee chooses their own at first sign-in.
          status: 'ACTIVE',
          passwordHash,
          mustChangePassword: selfService,
        },
        select: employeeSelect,
      });
      if (plan.extraRoleIds.length) await tx.userRole.createMany({ data: plan.extraRoleIds.map((roleId) => ({ userId: created.id, roleId, assignedById: auth.userId })) });
      if (plan.overrides.length) {
        await tx.userPermissionOverride.createMany({
          data: plan.overrides.map((o) => ({ organizationId: auth.organizationId, userId: created.id, permission: o.permission, effect: o.effect, scope: o.scope, grantedById: auth.userId })),
        });
      }
      return created;
    });
    await this.joinDefaultChannels(auth.organizationId, user.id);
    await this.audit.log(auth, 'employee.created', 'user', user.id, {
      email: user.email,
      role: user.role.key,
      ...(plan.extraRoleIds.length ? { extraRoles: plan.extraRoleIds.map((id) => plan.roles.get(id)!.key) } : {}),
      ...(plan.overrides.length ? { overrides: plan.overrides } : {}),
    });
    return { employee: toEmployee(user, { privileged: true }) };
  }

  private async joinDefaultChannels(organizationId: string, userId: string) {
    const defaults = await this.prisma.channel.findMany({ where: { organizationId, isDefault: true }, select: { id: true } });
    await this.prisma.channelMember.createMany({ data: defaults.map((c) => ({ channelId: c.id, userId })), skipDuplicates: true });
  }

  /**
   * Sets a temporary password for an employee (there is no email reset). The admin sees it once to hand over;
   * the employee must choose their own at next sign-in. Signs them out everywhere and activates invited accounts.
   */
  async setPassword(auth: AuthContext, id: string, password: string) {
    if (id === auth.userId) throw new BadRequestException('To change your own password, use your profile');
    const target = await this.loadTarget(auth, id);
    await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    if (target.status === 'DEACTIVATED' || target.status === 'ARCHIVED') throw new BadRequestException('Reactivate this account first');
    const activating = target.status === 'INVITED';
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(password), mustChangePassword: await this.selfServicePassword(auth.organizationId), failedLogins: 0, lockedUntil: null, ...(activating ? { status: 'ACTIVE' } : {}) },
      }),
      this.prisma.session.deleteMany({ where: { userId: id } }),
      this.prisma.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.invitation.updateMany({ where: { userId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    if (activating) await this.joinDefaultChannels(auth.organizationId, id);
    this.realtime.disconnectUser(id);
    await this.audit.log(auth, 'employee.password_set', 'user', id, { activated: activating });
    return this.get(auth, id);
  }

  /** Whether people choose their own passwords (otherwise only admins set them). */
  private async selfServicePassword(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    return parseOrganizationSettings(org.settings).auth.selfServicePassword;
  }

  private async loadTarget(auth: AuthContext, id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: auth.organizationId }, include: { role: true } });
    if (!target) throw new NotFoundException('Employee not found');
    return target;
  }

  async update(auth: AuthContext, id: string, input: UpdateEmployeeInput) {
    const target = await this.loadTarget(auth, id);
    if (id !== auth.userId) await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    if (input.roleId && input.roleId !== target.roleId) {
      if (id === auth.userId) throw new ForbiddenException('You cannot change your own role');
      await this.assertRoleAuthority(auth, { roleId: input.roleId });
      // Same ceiling as the Access section: the new role may not give them more than the caller has.
      const current = await this.loadAccessState(auth.organizationId, id);
      await this.planAccess(auth, current, { roleId: input.roleId, extraRoleIds: current.extraRoleIds, overrides: current.overrides });
    }
    // Only a newly chosen manager has to be someone who can be picked (an existing suspended manager stays).
    await this.assertRefs(auth, { departmentId: input.departmentId, managerId: input.managerId !== target.managerId ? input.managerId : undefined }, id);
    if (input.employeeCode && input.employeeCode !== target.employeeCode) {
      const taken = await this.prisma.user.count({ where: { organizationId: auth.organizationId, employeeCode: input.employeeCode, NOT: { id } } });
      if (taken) throw new ConflictException('Employee code already in use');
    }
    const { joinedAt, birthday, ...rest } = input;
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        employeeCode: input.employeeCode === '' ? null : input.employeeCode,
        joinedAt: toDateOnly(joinedAt),
        birthday: toDateOnly(birthday),
      },
      select: employeeSelect,
    });
    await this.audit.log(auth, 'employee.updated', 'user', id, { fields: Object.keys(input) });
    if (input.roleId && input.roleId !== target.roleId) {
      await this.audit.log(auth, 'employee.role_changed', 'user', id, { from: target.role.key, to: updated.role.key });
    }
    return toEmployee(updated, { privileged: true, online: this.realtime.isOnline(id) });
  }

  async setActive(auth: AuthContext, id: string, active: boolean) {
    if (id === auth.userId) throw new ForbiddenException('You cannot change the status of your own account');
    const target = await this.loadTarget(auth, id);
    await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    if (!active && target.isSuperAdmin) {
      // Removing a Super Admin goes through the protected process (limit and last-admin checks).
      throw new ForbiddenException('Remove their Super Admin authority first (Super Admins page)');
    }
    if (active) {
      if (target.status !== 'DEACTIVATED') throw new BadRequestException('Employee is not deactivated');
      // Accounts that never set a password return to INVITED and need a fresh invite.
      const status = target.passwordHash ? 'ACTIVE' : 'INVITED';
      await this.prisma.user.update({ where: { id }, data: { status, deactivatedAt: null, failedLogins: 0, lockedUntil: null } });
      await this.audit.log(auth, 'employee.reactivated', 'user', id);
    } else {
      if (target.status === 'DEACTIVATED') throw new BadRequestException('Employee is already deactivated');
      if (target.status === 'ARCHIVED') throw new BadRequestException('This account is archived. Restore it first.');
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id }, data: { status: 'DEACTIVATED', deactivatedAt: new Date(), suspendedAt: null, suspensionReason: null } }),
        this.prisma.session.deleteMany({ where: { userId: id } }),
        this.prisma.invitation.updateMany({ where: { userId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      this.realtime.disconnectUser(id);
      await this.audit.log(auth, 'employee.deactivated', 'user', id);
    }
    return this.get(auth, id);
  }

  /** Common checks for changing someone's account status: not yourself, same tenant, rank and Super Admin authority. */
  private async statusTarget(auth: AuthContext, id: string) {
    if (id === auth.userId) throw new ForbiddenException('You cannot change the status of your own account');
    const target = await this.loadTarget(auth, id);
    await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    return target;
  }

  /**
   * Temporarily blocks an account (reversible). They are signed out everywhere and their live connections close.
   * Super Admins lose their authority first through the protected Super Admin process.
   */
  async suspend(auth: AuthContext, id: string, input: SuspendEmployeeInput) {
    const target = await this.statusTarget(auth, id);
    if (target.isSuperAdmin) throw new ForbiddenException('Remove their Super Admin authority first (Super Admins page)');
    if (target.status === 'SUSPENDED') throw new BadRequestException('This account is already suspended');
    if (target.status !== 'ACTIVE' && target.status !== 'INVITED') throw new BadRequestException('Only active accounts can be suspended');
    const reason = input.reason?.trim() || null;
    const [, { count }] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason } }),
      this.prisma.session.deleteMany({ where: { userId: id } }),
    ]);
    this.realtime.disconnectUser(id);
    await this.audit.log(auth, 'employee.suspended', 'user', id, { reason, sessionsRevoked: count, from: target.status });
    return this.get(auth, id);
  }

  /** Lifts a suspension. Accounts that never had a password go back to waiting for one. */
  async unsuspend(auth: AuthContext, id: string) {
    const target = await this.statusTarget(auth, id);
    if (target.status !== 'SUSPENDED') throw new BadRequestException('This account is not suspended');
    const status = target.passwordHash ? 'ACTIVE' : 'INVITED';
    await this.prisma.user.update({ where: { id }, data: { status, suspendedAt: null, suspensionReason: null, failedLogins: 0, lockedUntil: null } });
    await this.audit.log(auth, 'employee.unsuspended', 'user', id, { to: status });
    return this.get(auth, id);
  }

  /** Archives a deactivated account: hidden from lists and pickers, history kept. Reversible with restore. */
  async archive(auth: AuthContext, id: string) {
    const target = await this.statusTarget(auth, id);
    if (target.isSuperAdmin) throw new ForbiddenException('Remove their Super Admin authority first (Super Admins page)');
    if (target.status === 'ARCHIVED') throw new BadRequestException('This account is already archived');
    if (target.status !== 'DEACTIVATED') throw new BadRequestException('Deactivate the account before archiving it');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date() } }),
      // Defence in depth: a deactivated account has no sessions, but make sure.
      this.prisma.session.deleteMany({ where: { userId: id } }),
    ]);
    this.realtime.disconnectUser(id);
    await this.audit.log(auth, 'employee.archived', 'user', id);
    return this.get(auth, id);
  }

  /** Brings an archived account back as deactivated (it can then be reactivated). */
  async restore(auth: AuthContext, id: string) {
    const target = await this.statusTarget(auth, id);
    if (target.status !== 'ARCHIVED') throw new BadRequestException('This account is not archived');
    await this.prisma.user.update({ where: { id }, data: { status: 'DEACTIVATED', archivedAt: null, deactivatedAt: target.deactivatedAt ?? new Date() } });
    await this.audit.log(auth, 'employee.restored', 'user', id);
    return this.get(auth, id);
  }

  // ───────── access: main role, extra roles and exceptions ─────────

  private assertRecentAuth(auth: AuthContext) {
    if (Date.now() - auth.authenticatedAt.getTime() > RECENT_AUTH_DEFAULT_MINUTES * 60_000) {
      throw new ForbiddenException({ statusCode: 403, code: 'REAUTH_REQUIRED', message: 'For your security, confirm it is you to continue' });
    }
  }

  private actor(auth: AuthContext): AccessActor {
    return { isSuperAdmin: auth.isSuperAdmin, rank: auth.rank, grants: auth.grants };
  }

  private async loadAccessState(organizationId: string, id: string): Promise<AccessState> {
    const u = await this.prisma.user.findFirst({
      where: { id, organizationId },
      select: {
        roleId: true,
        role: { select: roleAccessSelect },
        extraRoles: { orderBy: { createdAt: 'asc' }, select: { role: { select: roleAccessSelect } } },
        permissionOverrides: { orderBy: { createdAt: 'asc' }, select: { permission: true, effect: true, scope: true } },
      },
    });
    if (!u) throw new NotFoundException('Employee not found');
    // Extra roles from another tenant are ignored everywhere (defence in depth).
    const extras = u.extraRoles.map((x) => x.role).filter((r) => r.organizationId === organizationId);
    return { roleId: u.roleId, extraRoleIds: extras.map((r) => r.id), roles: [u.role, ...extras], overrides: u.permissionOverrides };
  }

  /**
   * Checks a new access assignment against the escalation rules and returns it normalised.
   * `current` is null for a new account. Unchanged parts are not re-checked, so an admin can keep an
   * exception a Super Admin gave even though they could not give it themselves.
   */
  private async planAccess(auth: AuthContext, current: AccessState | null, next: { roleId: string; extraRoleIds: string[]; overrides: (PermissionOverrideInput | OverrideRow)[] }) {
    const extraRoleIds = [...new Set(next.extraRoleIds)].filter((rid) => rid !== next.roleId);
    const ids = [next.roleId, ...extraRoleIds];
    const rows = await this.prisma.role.findMany({ where: { id: { in: ids }, organizationId: auth.organizationId }, select: roleAccessSelect });
    if (rows.length !== ids.length) throw new BadRequestException('Unknown role');
    const roles = new Map(rows.map((r) => [r.id, r]));
    const actor = this.actor(auth);

    const held = new Set(current ? [current.roleId, ...current.extraRoleIds] : []);
    for (const rid of ids) {
      if (held.has(rid)) continue;
      const role = roles.get(rid)!;
      const why = roleBlockReason(actor, role);
      if (why) throw new ForbiddenException(`You can't give the ${role.name} role. ${why}.`);
    }

    const overrides: OverrideRow[] = next.overrides.map((o) => ({
      permission: o.permission,
      effect: o.effect,
      // DENY removes the permission at every scope; ALLOW defaults to the widest scope the permission supports.
      scope: o.effect === 'DENY' ? null : ((o.scope as Scope | null | undefined) ?? widestScope(o.permission)),
    }));
    const before = new Map((current?.overrides ?? []).map((o) => [o.permission, o]));
    for (const o of overrides) {
      if (o.effect !== 'ALLOW') continue;
      const prev = before.get(o.permission);
      if (prev && prev.effect === 'ALLOW' && prev.scope === o.scope) continue;
      const why = allowBlockReason(actor, o.permission, o.scope!);
      if (why) throw new ForbiddenException(`You can't allow “${CATALOG_BY_KEY[o.permission]?.label ?? o.permission}”. ${why}.`);
    }

    // Ceiling: the change may not leave them with anything wider than the caller holds.
    if (!auth.isSuperAdmin) {
      const was = current ? resolveGrants(current.roles, current.overrides) : {};
      const will = resolveGrants(ids.map((rid) => roles.get(rid)!), overrides);
      const why = gainsBlockReason(actor, accessGains(was, will));
      if (why) throw new ForbiddenException(`This would give them more access than you have. ${why}.`);
    }
    return { roleId: next.roleId, extraRoleIds, overrides, roles };
  }

  /** One person's access, plus whether the caller may change it. */
  async getAccess(auth: AuthContext, id: string) {
    const target = await this.loadTarget(auth, id);
    if (id !== auth.userId) await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    const state = await this.loadAccessState(auth.organizationId, id);
    const overrides = await this.prisma.userPermissionOverride.findMany({
      where: { userId: id, organizationId: auth.organizationId },
      orderBy: { createdAt: 'asc' },
      select: { permission: true, effect: true, scope: true, reason: true, createdAt: true },
    });
    const mfaEnabled = !!(target.mfaEnabledAt && target.mfaSecretEnc);
    const superAdminActive = target.accountType === 'INTERNAL' && target.isSuperAdmin && mfaEnabled && !target.mustChangePassword;
    const grants = resolveGrants(state.roles, state.overrides, { isSuperAdmin: superAdminActive, accountType: target.accountType });
    const readOnlyReason =
      id === auth.userId
        ? 'You can’t change your own access. Ask another administrator.'
        : target.status === 'ARCHIVED'
          ? 'This account is archived. Restore it to change access.'
          : null;
    return {
      userId: id,
      roleId: state.roleId,
      extraRoleIds: state.extraRoleIds,
      overrides,
      grants,
      isSuperAdmin: target.isSuperAdmin,
      superAdminActive,
      editable: !readOnlyReason,
      readOnlyReason,
    };
  }

  /**
   * Replaces one person's main role, extra roles and exceptions in one transaction.
   * Their effective permissions change on their next request. Audited with a diff.
   */
  async updateAccess(auth: AuthContext, id: string, input: UpdateEmployeeAccessInput) {
    if (id === auth.userId) throw new ForbiddenException('You cannot change your own access');
    const target = await this.loadTarget(auth, id);
    await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    if (target.status === 'ARCHIVED') throw new BadRequestException('This account is archived. Restore it first.');
    const current = await this.loadAccessState(auth.organizationId, id);
    const roleId = input.roleId ?? current.roleId;
    if (roleId !== current.roleId) await this.assertRoleAuthority(auth, { roleId });
    const plan = await this.planAccess(auth, current, { roleId, extraRoleIds: input.extraRoleIds ?? [], overrides: input.overrides ?? [] });

    const keyOf = (rid: string) => plan.roles.get(rid)?.key ?? current.roles.find((r) => r.id === rid)?.key ?? rid;
    const oldExtra = new Set(current.extraRoleIds);
    const newExtra = new Set(plan.extraRoleIds);
    const oldOv = new Map(current.overrides.map((o) => [o.permission, o]));
    const newOv = new Map(plan.overrides.map((o) => [o.permission, o]));
    const same = (a: OverrideRow, b: OverrideRow) => a.effect === b.effect && (a.scope ?? null) === (b.scope ?? null);
    const added = plan.extraRoleIds.filter((r) => !oldExtra.has(r));
    const diff = {
      ...(roleId !== current.roleId ? { role: { from: keyOf(current.roleId), to: keyOf(roleId) } } : {}),
      extraRoles: { added: added.map(keyOf), removed: current.extraRoleIds.filter((r) => !newExtra.has(r)).map(keyOf) },
      overrides: {
        added: plan.overrides.filter((o) => !oldOv.has(o.permission)),
        removed: current.overrides.filter((o) => !newOv.has(o.permission)),
        changed: plan.overrides.filter((o) => oldOv.has(o.permission) && !same(oldOv.get(o.permission)!, o)).map((o) => ({ permission: o.permission, from: oldOv.get(o.permission), to: o })),
      },
    };
    const changes = diff.extraRoles.added.length + diff.extraRoles.removed.length + diff.overrides.added.length + diff.overrides.removed.length + diff.overrides.changed.length;
    if (!diff.role && !changes) return this.getAccess(auth, id);

    await this.prisma.$transaction(async (tx) => {
      if (roleId !== current.roleId) await tx.user.update({ where: { id }, data: { roleId } });
      await tx.userRole.deleteMany({ where: { userId: id, roleId: { notIn: plan.extraRoleIds } } });
      if (added.length) await tx.userRole.createMany({ data: added.map((r) => ({ userId: id, roleId: r, assignedById: auth.userId })), skipDuplicates: true });
      await tx.userPermissionOverride.deleteMany({ where: { userId: id, permission: { notIn: plan.overrides.map((o) => o.permission) } } });
      for (const o of plan.overrides) {
        const prev = oldOv.get(o.permission);
        if (prev && same(prev, o)) continue;
        await tx.userPermissionOverride.upsert({
          where: { userId_permission: { userId: id, permission: o.permission } },
          create: { organizationId: auth.organizationId, userId: id, permission: o.permission, effect: o.effect, scope: o.scope, grantedById: auth.userId },
          update: { effect: o.effect, scope: o.scope, grantedById: auth.userId, createdAt: new Date() },
        });
      }
    });
    await this.audit.log(auth, 'employee.access_changed', 'user', id, diff);
    return this.getAccess(auth, id);
  }

  async listSessions(auth: AuthContext, id: string) {
    const target = await this.loadTarget(auth, id);
    if (id !== auth.userId) await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    const rows = await this.prisma.session.findMany({
      where: { userId: id, organizationId: auth.organizationId, mfaPending: false, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, current: r.id === auth.sessionId }));
  }

  async revokeSessions(auth: AuthContext, id: string) {
    if (id === auth.userId) throw new BadRequestException('To sign out your own devices, use your security settings');
    const target = await this.loadTarget(auth, id);
    await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    const { count } = await this.prisma.session.deleteMany({ where: { userId: id, organizationId: auth.organizationId } });
    this.realtime.disconnectUser(id);
    await this.audit.log(auth, 'employee.sessions_revoked', 'user', id, { count });
    return { count };
  }

  /**
   * Changes someone's work email (their sign-in name). Company domain only, unique across FG One,
   * same authority rules as other edits. They are signed out everywhere so every device signs in again.
   */
  async changeEmail(auth: AuthContext, id: string, email: string) {
    if (id === auth.userId) throw new BadRequestException('Ask another administrator to change your own email');
    const target = await this.loadTarget(auth, id);
    await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId }, select: { settings: true } });
    this.assertCompanyDomain(org.settings, email);
    if (email === target.email) throw new BadRequestException('That is already their email');
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException('An account with this email already exists');
    try {
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id }, data: { email } }),
        this.prisma.session.deleteMany({ where: { userId: id } }),
        this.prisma.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } }),
      ]);
    } catch (e) {
      // Two admins racing for the same address.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('An account with this email already exists');
      throw e;
    }
    this.realtime.disconnectUser(id);
    await this.audit.log(auth, 'employee.email_changed', 'user', id, { from: target.email, to: email });
    return this.get(auth, id);
  }

  /**
   * Everything an administrator needs about one person: profile and employment, roles and effective access,
   * account flags, attendance (last 30 days, org time zone), leave, signed-in devices and recent activity.
   * Same authority rules as editing: Super Admins can open anyone, others only people ranked below them.
   * Sections the caller has no permission for (attendance, audit) come back as null.
   */
  async overview(auth: AuthContext, id: string) {
    const target = await this.prisma.user.findFirst({
      where: { id, organizationId: auth.organizationId },
      select: {
        ...employeeSelect,
        failedLogins: true,
        lockedUntil: true,
        deactivatedAt: true,
        suspendedAt: true,
        suspensionReason: true,
        archivedAt: true,
        mustChangePassword: true,
        mfaEnabledAt: true,
        mfaSecretEnc: true,
        passwordHash: true,
        role: { select: { id: true, key: true, name: true, rank: true, archivedAt: true, grants: { select: { permission: true, scope: true } } } },
        extraRoles: { select: { createdAt: true, role: { select: { id: true, key: true, name: true, rank: true, organizationId: true, archivedAt: true, grants: { select: { permission: true, scope: true } } } } } },
        permissionOverrides: { select: { id: true, permission: true, effect: true, scope: true, reason: true, createdAt: true } },
        reports: { where: { status: { notIn: ['DEACTIVATED', 'ARCHIVED'] } }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true, designation: true, status: true } },
      },
    });
    if (!target) throw new NotFoundException('Employee not found');
    if (id !== auth.userId) await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });

    const {
      failedLogins, lockedUntil, deactivatedAt, suspendedAt, suspensionReason, archivedAt, mustChangePassword, mfaEnabledAt, mfaSecretEnc, passwordHash,
      extraRoles, permissionOverrides, reports, role, ...row
    } = target;
    const mfaEnabled = !!(mfaEnabledAt && mfaSecretEnc);
    const extras = extraRoles.filter((x) => x.role.organizationId === auth.organizationId).map((x) => x.role);
    const superAdminActive = row.accountType === 'INTERNAL' && row.isSuperAdmin && mfaEnabled && !mustChangePassword;
    const grants = resolveGrants([role, ...extras], permissionOverrides, { isSuperAdmin: superAdminActive, accountType: row.accountType });
    const publicRole = { id: role.id, key: role.key, name: role.name, rank: role.rank };

    const canAudit = hasPermission(auth.permissions, PERMISSIONS.AUDIT_READ);
    const [attendance, balances, leaveRequests, sessions, activity] = await Promise.all([
      this.attendance.history(auth, id).catch((e) => {
        if (e instanceof ForbiddenException) return null; // no attendance.view for this person
        throw e;
      }),
      this.leave.balances(auth, id),
      this.prisma.leaveRequest.findMany({
        where: { userId: id, organizationId: auth.organizationId },
        orderBy: { startDate: 'desc' },
        take: 20,
        select: {
          id: true, startDate: true, endDate: true, halfDay: true, days: true, reason: true, status: true, decisionNote: true, decidedAt: true, createdAt: true,
          type: { select: { id: true, name: true, code: true, color: true, paid: true } },
          approver: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.listSessions(auth, id),
      canAudit
        ? this.prisma.auditLog.findMany({
            where: { organizationId: auth.organizationId, OR: [{ actorId: id }, { entityType: 'user', entityId: id }] },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true } } },
          })
        : Promise.resolve(null),
    ]);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    return {
      employee: { ...toEmployee({ ...row, role: publicRole }, { privileged: true, online: this.realtime.isOnline(id) }), reports },
      access: {
        role: publicRole,
        extraRoles: extras.map((r) => ({ id: r.id, key: r.key, name: r.name, rank: r.rank, archived: !!r.archivedAt })),
        overrides: permissionOverrides,
        grants,
      },
      account: {
        status: row.status,
        isSuperAdmin: row.isSuperAdmin,
        superAdminActive,
        mfaEnabled,
        mfaEnabledAt: mfaEnabled ? mfaEnabledAt : null,
        mustChangePassword,
        hasPassword: !!passwordHash,
        lastLoginAt: row.lastLoginAt,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        deactivatedAt,
        suspendedAt,
        suspensionReason,
        archivedAt,
        lockedUntil: lockedUntil && lockedUntil > new Date() ? lockedUntil : null,
        failedLogins,
      },
      attendance,
      leave: {
        year: balances.year,
        balances: balances.items,
        requests: leaveRequests.map((r) => ({ ...r, startDate: ymd(r.startDate), endDate: ymd(r.endDate) })),
      },
      sessions,
      activity,
    };
  }
}
