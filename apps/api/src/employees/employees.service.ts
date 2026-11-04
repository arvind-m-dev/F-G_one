import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateEmployeeInput,
  hasPermission,
  parseOrganizationSettings,
  PERMISSIONS,
  resolveGrants,
  UpdateEmployeeInput,
} from '@fg/shared';
import { AttendanceService } from '../attendance/attendance.service';
import { likeContains } from '../common/like';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import type { AuthContext } from '../common/auth-context';
import { toDateOnly } from '../common/dates';
import { env } from '../common/env';
import { newToken, sha256 } from '../common/tokens';
import { LeaveService } from '../leave/leave.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { employeeSelect, toEmployee } from './employee.mapper';

const INVITE_TTL_DAYS = 7;
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
      ...(status !== 'ALL' ? { status: status as Prisma.EnumUserStatusFilter['equals'] } : {}),
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
      const ok = await this.prisma.user.count({ where: { id: input.managerId, organizationId: auth.organizationId, status: { not: 'DEACTIVATED' } } });
      if (!ok) throw new BadRequestException('Unknown manager');
    }
  }

  async create(auth: AuthContext, input: CreateEmployeeInput) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    const selfService = parseOrganizationSettings(org.settings).auth.selfServicePassword;
    this.assertCompanyDomain(org.settings, input.email);
    await this.assertRoleAuthority(auth, { roleId: input.roleId });
    await this.assertRefs(auth, input);

    if (await this.prisma.user.findUnique({ where: { email: input.email } })) throw new ConflictException('An account with this email already exists');
    if (input.employeeCode && (await this.prisma.user.count({ where: { organizationId: auth.organizationId, employeeCode: input.employeeCode } }))) {
      throw new ConflictException('Employee code already in use');
    }

    const user = await this.prisma.user.create({
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
        passwordHash: await hashPassword(input.password),
        mustChangePassword: selfService,
      },
      select: employeeSelect,
    });
    await this.joinDefaultChannels(auth.organizationId, user.id);
    await this.audit.log(auth, 'employee.created', 'user', user.id, { email: user.email, role: user.role.key });
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
    }
    await this.assertRefs(auth, input, id);
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
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id }, data: { status: 'DEACTIVATED', deactivatedAt: new Date() } }),
        this.prisma.session.deleteMany({ where: { userId: id } }),
        this.prisma.invitation.updateMany({ where: { userId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      this.realtime.disconnectUser(id);
      await this.audit.log(auth, 'employee.deactivated', 'user', id);
    }
    return this.get(auth, id);
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
        mustChangePassword: true,
        mfaEnabledAt: true,
        mfaSecretEnc: true,
        passwordHash: true,
        role: { select: { id: true, key: true, name: true, rank: true, archivedAt: true, grants: { select: { permission: true, scope: true } } } },
        extraRoles: { select: { createdAt: true, role: { select: { id: true, key: true, name: true, rank: true, organizationId: true, archivedAt: true, grants: { select: { permission: true, scope: true } } } } } },
        permissionOverrides: { select: { id: true, permission: true, effect: true, scope: true, reason: true, createdAt: true } },
        reports: { where: { status: { not: 'DEACTIVATED' } }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true, designation: true, status: true } },
      },
    });
    if (!target) throw new NotFoundException('Employee not found');
    if (id !== auth.userId) await this.assertRoleAuthority(auth, { targetRank: target.role.rank, targetIsSuperAdmin: target.isSuperAdmin });

    const {
      failedLogins, lockedUntil, deactivatedAt, mustChangePassword, mfaEnabledAt, mfaSecretEnc, passwordHash,
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
