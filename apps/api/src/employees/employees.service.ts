import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateEmployeeInput,
  hasPermission,
  parseOrganizationSettings,
  PERMISSIONS,
  UpdateEmployeeInput,
} from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { toDateOnly } from '../common/dates';
import { env } from '../common/env';
import { newToken, sha256 } from '../common/tokens';
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
              { firstName: { contains: q.q, mode: 'insensitive' } },
              { lastName: { contains: q.q, mode: 'insensitive' } },
              { displayName: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { designation: { contains: q.q, mode: 'insensitive' } },
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

  /** Ensures the actor may manage someone holding `targetRank`, and may assign `roleId`. */
  private async assertRoleAuthority(auth: AuthContext, opts: { targetRank?: number; roleId?: string }) {
    const isSuper = auth.roleKey === 'super_admin';
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
    const domains = parseOrganizationSettings(org.settings).auth.allowedEmailDomains.map((d) => d.toLowerCase());
    const domain = input.email.split('@')[1];
    if (!domains.includes(domain)) throw new BadRequestException(`Email must use a company domain (${domains.join(', ')})`);
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
        status: 'INVITED',
      },
      select: employeeSelect,
    });
    await this.audit.log(auth, 'employee.created', 'user', user.id, { email: user.email, role: user.role.key });
    const invite = await this.issueInvitation(auth, user.id, input.sendInvite);
    return { employee: toEmployee(user, { privileged: true }), inviteUrl: invite.url, inviteExpiresAt: invite.expiresAt };
  }

  /** Creates a single-use invitation. The link is returned to the (authorized) admin so it can be shared even without SMTP. */
  async issueInvitation(auth: AuthContext, userId: string, sendEmail = true) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId: auth.organizationId }, include: { organization: true } });
    if (!user) throw new NotFoundException('Employee not found');
    if (user.status !== 'INVITED') throw new BadRequestException('This employee has already activated their account');
    await this.prisma.invitation.updateMany({ where: { userId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const token = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
    await this.prisma.invitation.create({
      data: { organizationId: auth.organizationId, userId, invitedById: auth.userId, tokenHash: sha256(token), expiresAt },
    });
    const url = `${env().WEB_ORIGIN}/invite/${token}`;
    if (sendEmail) {
      await this.mail.send({
        to: user.email,
        subject: `You're invited to ${user.organization.name} on FG One`,
        text: `Hi ${user.firstName},\n\nYou've been invited to join ${user.organization.name}'s FG One workspace.\nSet your password here (valid for ${INVITE_TTL_DAYS} days):\n\n${url}\n`,
      });
    }
    await this.audit.log(auth, 'employee.invited', 'user', userId, { emailed: sendEmail });
    return { url, expiresAt };
  }

  private async loadTarget(auth: AuthContext, id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: auth.organizationId }, include: { role: true } });
    if (!target) throw new NotFoundException('Employee not found');
    return target;
  }

  async update(auth: AuthContext, id: string, input: UpdateEmployeeInput) {
    const target = await this.loadTarget(auth, id);
    if (id !== auth.userId) await this.assertRoleAuthority(auth, { targetRank: target.role.rank });
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
    await this.assertRoleAuthority(auth, { targetRank: target.role.rank });
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
}
