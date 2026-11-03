import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, parseOrganizationSettings, PERMISSIONS, type LeaveRequestInput, type LeaveTypeInput } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import { approversFor, assertCanDecide, deciderScope, hrUsers } from '../common/approvals';
import type { AuthContext } from '../common/auth-context';
import { localDate, toDbDate } from '../common/tz';
import { countWorkingDays } from '../common/workdays';
import { personSelect, toPerson } from '../employees/employee.mapper';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const requestInclude = {
  type: { select: { id: true, name: true, code: true, color: true, paid: true } },
  user: { select: personSelect },
  approver: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeaveRequestInclude;
type RequestRow = Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private serialize(r: RequestRow, viewerCanSeeReason: boolean) {
    return {
      id: r.id,
      type: r.type,
      person: toPerson(r.user),
      startDate: ymd(r.startDate),
      endDate: ymd(r.endDate),
      halfDay: r.halfDay,
      days: r.days,
      reason: viewerCanSeeReason ? r.reason : null,
      status: r.status,
      approver: r.approver,
      decisionNote: viewerCanSeeReason ? r.decisionNote : null,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
  }

  private async settings(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return parseOrganizationSettings(org.settings);
  }

  /** Leave year containing today, from the policy's start month. */
  private async leaveYear(organizationId: string) {
    const s = await this.settings(organizationId);
    const today = localDate(s.attendance.timezone);
    const [y, m] = today.split('-').map(Number);
    const startYear = m! >= s.leave.yearStartMonth ? y! : y! - 1;
    const start = `${startYear}-${String(s.leave.yearStartMonth).padStart(2, '0')}-01`;
    const endD = new Date(Date.UTC(startYear + 1, s.leave.yearStartMonth - 1, 1) - 86400_000);
    return { start, end: ymd(endD) };
  }

  // ───── types ─────
  listTypes(auth: AuthContext, includeInactive = false) {
    return this.prisma.leaveType.findMany({ where: { organizationId: auth.organizationId, ...(includeInactive ? {} : { active: true }) }, orderBy: { name: 'asc' } });
  }

  async createType(auth: AuthContext, body: LeaveTypeInput) {
    try {
      const t = await this.prisma.leaveType.create({ data: { ...body, description: body.description ?? null, organizationId: auth.organizationId } });
      await this.audit.log(auth, 'leave_type.created', 'leave_type', t.id, { name: t.name });
      return t;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A leave type with that code exists');
      throw e;
    }
  }

  async updateType(auth: AuthContext, id: string, body: Partial<LeaveTypeInput>) {
    const t = await this.prisma.leaveType.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!t) throw new NotFoundException('Leave type not found');
    const u = await this.prisma.leaveType.update({ where: { id }, data: body });
    await this.audit.log(auth, 'leave_type.updated', 'leave_type', id, { fields: Object.keys(body) });
    return u;
  }

  // ───── balances ─────
  async balances(auth: AuthContext, userId: string) {
    if (userId !== auth.userId && !hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE)) {
      const report = await this.prisma.user.count({ where: { id: userId, organizationId: auth.organizationId, managerId: auth.userId } });
      if (!report) throw new ForbiddenException('You cannot view this person’s leave');
    }
    const year = await this.leaveYear(auth.organizationId);
    const [types, used] = await Promise.all([
      this.listTypes(auth),
      this.prisma.leaveRequest.groupBy({
        by: ['typeId', 'status'],
        where: { userId, organizationId: auth.organizationId, status: { in: ['APPROVED', 'PENDING'] }, startDate: { gte: toDbDate(year.start), lte: toDbDate(year.end) } },
        _sum: { days: true },
      }),
    ]);
    return {
      year,
      items: types.map((t) => {
        const approved = used.find((u) => u.typeId === t.id && u.status === 'APPROVED')?._sum.days ?? 0;
        const pending = used.find((u) => u.typeId === t.id && u.status === 'PENDING')?._sum.days ?? 0;
        return { type: t, allowance: t.annualAllowance, used: approved, pending, remaining: t.annualAllowance > 0 ? Math.max(0, t.annualAllowance - approved - pending) : null };
      }),
    };
  }

  // ───── requests ─────
  async preview(auth: AuthContext, body: LeaveRequestInput) {
    const { days } = await countWorkingDays(this.prisma, auth.organizationId, body.startDate, body.endDate);
    return { days: body.halfDay !== 'NONE' ? (days ? 0.5 : 0) : days };
  }

  async create(auth: AuthContext, body: LeaveRequestInput) {
    const s = await this.settings(auth.organizationId);
    const type = await this.prisma.leaveType.findFirst({ where: { id: body.typeId, organizationId: auth.organizationId, active: true } });
    if (!type) throw new BadRequestException('Choose a valid leave type');
    if (body.halfDay !== 'NONE' && !s.leave.allowHalfDay) throw new BadRequestException('Half-day leave is not enabled');
    const { days: working } = await countWorkingDays(this.prisma, auth.organizationId, body.startDate, body.endDate);
    const days = body.halfDay !== 'NONE' ? (working ? 0.5 : 0) : working;
    if (!days) throw new BadRequestException('Those dates are weekends or holidays — no leave needed');

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { userId: auth.userId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: toDbDate(body.endDate) }, endDate: { gte: toDbDate(body.startDate) } },
    });
    if (overlap) throw new ConflictException('You already have leave requested for some of these dates');

    if (type.annualAllowance > 0) {
      const bal = (await this.balances(auth, auth.userId)).items.find((b) => b.type.id === type.id);
      if (bal && bal.remaining !== null && days > bal.remaining) throw new BadRequestException(`Not enough ${type.name} balance: ${bal.remaining} day(s) left, ${days} requested`);
    }

    const r = await this.prisma.leaveRequest.create({
      data: { organizationId: auth.organizationId, userId: auth.userId, typeId: type.id, startDate: toDbDate(body.startDate), endDate: toDbDate(body.endDate), halfDay: body.halfDay, days, reason: body.reason || null },
      include: requestInclude,
    });
    await this.audit.log(auth, 'leave.requested', 'leave_request', r.id, { type: type.code, days });
    const approvers = s.leave.requireManagerApproval ? await approversFor(this.prisma, auth.organizationId, auth.userId) : await hrUsers(this.prisma, auth.organizationId, auth.userId);
    void this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: approvers,
      actorId: auth.userId,
      type: 'leave',
      title: `${r.user.firstName} ${r.user.lastName} requested ${days} day${days === 1 ? '' : 's'} of ${type.name}`,
      body: `${body.startDate}${body.endDate !== body.startDate ? ` to ${body.endDate}` : ''}${r.reason ? ` · ${r.reason}` : ''}`,
      link: '/app/approvals',
    });
    return this.serialize(r, true);
  }

  async list(auth: AuthContext, scope: 'mine' | 'approvals' | 'all', status: string) {
    let where: Prisma.LeaveRequestWhereInput;
    if (scope === 'mine') where = { userId: auth.userId, organizationId: auth.organizationId };
    else if (scope === 'all') {
      if (!hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE)) throw new ForbiddenException('HR only');
      where = { organizationId: auth.organizationId };
    } else {
      const s = deciderScope(auth, 'leave');
      if (!s) throw new ForbiddenException('You do not approve leave');
      where = s;
    }
    if (status !== 'ALL') where = { ...where, status: status as Prisma.EnumLeaveStatusFilter['equals'] };
    const rows = await this.prisma.leaveRequest.findMany({ where, include: requestInclude, orderBy: [{ status: 'asc' }, { startDate: 'desc' }], take: 200 });
    return rows.map((r) => this.serialize(r, true));
  }

  async decide(auth: AuthContext, id: string, decision: 'APPROVED' | 'REJECTED', note?: string | null) {
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, organizationId: auth.organizationId }, include: requestInclude });
    if (!r) throw new NotFoundException('Request not found');
    await assertCanDecide(this.prisma, auth, r.userId, 'leave');
    if (r.status !== 'PENDING') throw new ConflictException(`This request is already ${r.status.toLowerCase()}`);
    const u = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: decision, approverId: auth.userId, decisionNote: note || null, decidedAt: new Date() },
      include: requestInclude,
    });
    await this.audit.log(auth, decision === 'APPROVED' ? 'leave.approved' : 'leave.rejected', 'leave_request', id, { userId: r.userId, days: r.days });
    void this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: [r.userId],
      actorId: auth.userId,
      type: 'leave',
      title: `Your ${r.type.name} (${ymd(r.startDate)}${r.endDate.getTime() !== r.startDate.getTime() ? ` to ${ymd(r.endDate)}` : ''}) was ${decision === 'APPROVED' ? 'approved' : 'declined'}`,
      body: note || null,
      link: '/app/leave',
    });
    return this.serialize(u, true);
  }

  async cancel(auth: AuthContext, id: string) {
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, organizationId: auth.organizationId, userId: auth.userId }, include: requestInclude });
    if (!r) throw new NotFoundException('Request not found');
    const s = await this.settings(auth.organizationId);
    const today = localDate(s.attendance.timezone);
    if (r.status === 'PENDING' || (r.status === 'APPROVED' && ymd(r.startDate) > today)) {
      const u = await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' }, include: requestInclude });
      await this.audit.log(auth, 'leave.cancelled', 'leave_request', id, { wasApproved: r.status === 'APPROVED' });
      if (r.approverId) void this.notifications.notify({ organizationId: auth.organizationId, userIds: [r.approverId], actorId: auth.userId, type: 'leave', title: `${r.user.firstName} cancelled their ${r.type.name}`, body: `${ymd(r.startDate)} to ${ymd(r.endDate)}`, link: '/app/leave?tab=team' });
      return this.serialize(u, true);
    }
    throw new BadRequestException('Only pending or upcoming leave can be cancelled');
  }

  /** Who is away in a month. Employees see approved leave in their department; managers also their reports; HR everyone. */
  async calendar(auth: AuthContext, month?: string) {
    const s = await this.settings(auth.organizationId);
    const m = month ?? localDate(s.attendance.timezone).slice(0, 7);
    const [y, mm] = m.split('-').map(Number);
    const start = `${m}-01`;
    const end = ymd(new Date(Date.UTC(y!, mm!, 0)));
    const isHr = hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { departmentId: true } });
    const people: Prisma.UserWhereInput = isHr
      ? {}
      : { OR: [{ id: auth.userId }, { managerId: auth.userId }, ...(me.departmentId ? [{ departmentId: me.departmentId }] : [])] };
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        organizationId: auth.organizationId,
        status: { in: isHr ? ['APPROVED', 'PENDING'] : ['APPROVED'] },
        startDate: { lte: toDbDate(end) },
        endDate: { gte: toDbDate(start) },
        user: people,
      },
      include: requestInclude,
      orderBy: { startDate: 'asc' },
    });
    const holidays = await this.prisma.holiday.findMany({ where: { organizationId: auth.organizationId, date: { gte: toDbDate(start), lte: toDbDate(end) } }, orderBy: { date: 'asc' } });
    return {
      month: m,
      workingDays: s.attendance.workingDays,
      leaves: rows.map((r) => this.serialize(r, isHr || r.userId === auth.userId)),
      holidays: holidays.map((h) => ({ id: h.id, name: h.name, date: ymd(h.date), type: h.type })),
    };
  }
}
