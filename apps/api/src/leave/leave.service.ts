import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasPermission, parseOrganizationSettings, PERMISSIONS, type LeaveRequestInput, type RecordLeaveInput, type LeaveTypeInput } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import { approversFor, assertCanDecide, deciderScope, hrUsers } from '../common/approvals';
import type { AuthContext } from '../common/auth-context';
import { addDays, localDate, toDbDate } from '../common/tz';
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
type Db = Prisma.TransactionClient;
type Settings = ReturnType<typeof parseOrganizationSettings>;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Serializes leave changes for one person, so two requests sent at once can't both pass the overlap and balance checks. */
const lockPerson = (tx: Db, userId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${userId}`}))`;

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

  private async settings(organizationId: string, db: Db = this.prisma) {
    const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return parseOrganizationSettings(org.settings);
  }

  /** Leave year containing a date (default: today in the organization's time zone), from the policy's start month. */
  private leaveYear(s: Settings, at = localDate(s.attendance.timezone)) {
    const [y, m] = at.split('-').map(Number);
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
  async balances(auth: AuthContext, userId: string, at?: string) {
    if (userId !== auth.userId) {
      // Other tenants' people (and ids that don't exist) are not found, never an empty balance.
      const person = await this.prisma.user.findFirst({ where: { id: userId, organizationId: auth.organizationId }, select: { managerId: true } });
      if (!person) throw new NotFoundException('Employee not found');
      if (!hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE) && person.managerId !== auth.userId) throw new ForbiddenException('You cannot view this person’s leave');
    }
    return this.computeBalances(this.prisma, auth.organizationId, userId, this.leaveYear(await this.settings(auth.organizationId), at));
  }

  /** Allowance, approved and pending days per active type in one leave year. */
  private async computeBalances(db: Db, organizationId: string, userId: string, year: { start: string; end: string }) {
    const [types, used] = await Promise.all([
      db.leaveType.findMany({ where: { organizationId, active: true }, orderBy: { name: 'asc' } }),
      db.leaveRequest.groupBy({
        by: ['typeId', 'status'],
        where: { userId, organizationId, status: { in: ['APPROVED', 'PENDING'] }, startDate: { gte: toDbDate(year.start), lte: toDbDate(year.end) } },
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
    return this.breakdown(auth.organizationId, body, await this.settings(auth.organizationId));
  }

  /**
   * How a date range splits into leave days, weekly days off and holidays.
   * With `countDaysOffInside` (sandwich rule), days off between the first and last leave day also count as leave.
   */
  private async breakdown(organizationId: string, body: LeaveRequestInput, s: Settings, db: Db = this.prisma) {
    const { dates } = await countWorkingDays(db, organizationId, body.startDate, body.endDate);
    const working = new Set(dates);
    const offHolidays = await db.holiday.findMany({
      where: { organizationId, type: { in: ['MANDATORY', 'COMPANY'] }, date: { gte: toDbDate(body.startDate), lte: toDbDate(body.endDate) } },
      orderBy: { date: 'asc' },
    });
    const holidayName = new Map(offHolidays.map((h) => [ymd(h.date), h.name]));
    const holidays: { date: string; name: string }[] = [];
    let calendarDays = 0;
    let weekends = 0;
    let sandwichDays = 0;
    for (let d = body.startDate; d <= body.endDate && calendarDays < 400; d = addDays(d, 1)) {
      calendarDays++;
      if (working.has(d)) continue;
      if (holidayName.has(d)) holidays.push({ date: d, name: holidayName.get(d)! });
      else weekends++;
      if (s.leave.countDaysOffInside && body.halfDay === 'NONE' && dates.length > 1 && d > dates[0]! && d < dates[dates.length - 1]!) sandwichDays++;
    }
    const days = body.halfDay !== 'NONE' ? (dates.length ? 0.5 : 0) : dates.length + sandwichDays;
    return { days, calendarDays, workingDays: dates.length, weekends, holidays, sandwichDays };
  }

  /**
   * Type, half-day, working-day, overlap and balance checks shared by requesting and recording leave.
   * Runs inside the caller's transaction, after `lockPerson`.
   */
  private async validateLeave(db: Db, organizationId: string, userId: string, body: LeaveRequestInput, self: boolean) {
    const s = await this.settings(organizationId, db);
    const type = await db.leaveType.findFirst({ where: { id: body.typeId, organizationId, active: true } });
    if (!type) throw new BadRequestException('Choose a valid leave type');
    if (body.halfDay !== 'NONE' && !s.leave.allowHalfDay) throw new BadRequestException('Half-day leave is not enabled');
    const { days } = await this.breakdown(organizationId, body, s, db);
    if (!days) throw new BadRequestException('Those dates are weekends or holidays — no leave needed');

    const overlap = await db.leaveRequest.findFirst({
      where: { userId, organizationId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: toDbDate(body.endDate) }, endDate: { gte: toDbDate(body.startDate) } },
    });
    if (overlap) throw new ConflictException(self ? 'You already have leave requested for some of these dates' : 'They already have leave on some of these dates');

    if (type.annualAllowance > 0) {
      // The balance of the leave year the request starts in, which is not always the current one.
      const bal = (await this.computeBalances(db, organizationId, userId, this.leaveYear(s, body.startDate))).items.find((b) => b.type.id === type.id);
      if (bal && bal.remaining !== null && days > bal.remaining) throw new BadRequestException(`Not enough ${type.name} balance: ${bal.remaining} day(s) left, ${days} requested`);
    }
    return { s, type, days };
  }

  async create(auth: AuthContext, body: LeaveRequestInput) {
    const { r, type, days, approvers, selfApproved } = await this.prisma.$transaction(async (tx) => {
      await lockPerson(tx, auth.userId);
      const { s, type, days } = await this.validateLeave(tx, auth.organizationId, auth.userId, body, true);
      const approvers = s.leave.requireManagerApproval ? await approversFor(tx, auth.organizationId, auth.userId) : await hrUsers(tx, auth.organizationId, auth.userId);
      // Nobody else can approve (e.g. the only admin, with no manager): approve it so it doesn't wait forever.
      const selfApproved = approvers.length === 0;
      const r = await tx.leaveRequest.create({
        data: {
          organizationId: auth.organizationId, userId: auth.userId, typeId: type.id, startDate: toDbDate(body.startDate), endDate: toDbDate(body.endDate), halfDay: body.halfDay, days, reason: body.reason || null,
          ...(selfApproved ? { status: 'APPROVED' as const, decidedAt: new Date(), decisionNote: 'Approved automatically: nobody else can approve this request' } : {}),
        },
        include: requestInclude,
      });
      return { r, type, days, approvers, selfApproved };
    });
    await this.audit.log(auth, 'leave.requested', 'leave_request', r.id, { type: type.code, days, selfApproved });
    if (selfApproved) return this.serialize(r, true);
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

  /** HR records leave for someone (e.g. they forgot to apply). Approved straight away, audited, and the person is told. */
  async record(auth: AuthContext, body: RecordLeaveInput) {
    if (body.userId === auth.userId) throw new BadRequestException('Use Request time off for your own leave');
    const person = await this.prisma.user.findFirst({ where: { id: body.userId, organizationId: auth.organizationId }, select: { id: true, managerId: true } });
    if (!person) throw new NotFoundException('Employee not found');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { firstName: true, lastName: true } });
    const { r, type, days } = await this.prisma.$transaction(async (tx) => {
      await lockPerson(tx, person.id);
      const { type, days } = await this.validateLeave(tx, auth.organizationId, person.id, body, false);
      const r = await tx.leaveRequest.create({
        data: {
          organizationId: auth.organizationId, userId: person.id, typeId: type.id, startDate: toDbDate(body.startDate), endDate: toDbDate(body.endDate), halfDay: body.halfDay, days, reason: body.reason || null,
          status: 'APPROVED', approverId: auth.userId, decidedAt: new Date(), decisionNote: `Recorded by ${actor.firstName} ${actor.lastName}`,
        },
        include: requestInclude,
      });
      return { r, type, days };
    });
    await this.audit.log(auth, 'leave.recorded', 'leave_request', r.id, { userId: person.id, type: type.code, days });
    const dates = `${body.startDate}${body.endDate !== body.startDate ? ` to ${body.endDate}` : ''}`;
    void this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: [person.id],
      actorId: auth.userId,
      type: 'leave',
      title: `${actor.firstName} ${actor.lastName} recorded ${days} day${days === 1 ? '' : 's'} of ${type.name} for you`,
      body: dates,
      link: '/app/leave',
    });
    if (person.managerId && person.managerId !== auth.userId)
      void this.notifications.notify({
        organizationId: auth.organizationId,
        userIds: [person.managerId],
        actorId: auth.userId,
        type: 'leave',
        title: `${actor.firstName} ${actor.lastName} recorded ${type.name} for ${r.user.firstName} ${r.user.lastName}`,
        body: dates,
        link: '/app/leave?tab=team',
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

  /** Counts for the HR leave page: requests by status, plus who is out today and soon (organization time zone). */
  async summary(auth: AuthContext) {
    if (!hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE)) throw new ForbiddenException('HR only');
    const organizationId = auth.organizationId;
    const today = localDate((await this.settings(organizationId)).attendance.timezone);
    const weekEnd = addDays(today, 7);
    const [byStatus, outToday, startingSoon] = await Promise.all([
      this.prisma.leaveRequest.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
      this.prisma.leaveRequest.count({ where: { organizationId, status: 'APPROVED', startDate: { lte: toDbDate(today) }, endDate: { gte: toDbDate(today) } } }),
      this.prisma.leaveRequest.count({ where: { organizationId, status: 'APPROVED', startDate: { gt: toDbDate(today), lte: toDbDate(weekEnd) } } }),
    ]);
    const n = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
    return {
      date: today,
      pending: n('PENDING'),
      approved: n('APPROVED'),
      declined: n('REJECTED'),
      cancelled: n('CANCELLED'),
      outToday,
      startingSoon,
    };
  }

  async decide(auth: AuthContext, id: string, decision: 'APPROVED' | 'REJECTED', note?: string | null) {
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, organizationId: auth.organizationId }, include: requestInclude });
    if (!r) throw new NotFoundException('Request not found');
    await assertCanDecide(this.prisma, auth, r.userId, 'leave');
    if (r.status !== 'PENDING') throw new ConflictException(`This request is already ${r.status.toLowerCase()}`);
    // Only one decision wins when two approvers act at once, or the person cancels meanwhile.
    const res = await this.prisma.leaveRequest.updateMany({
      where: { id, organizationId: auth.organizationId, status: 'PENDING' },
      data: { status: decision, approverId: auth.userId, decisionNote: note || null, decidedAt: new Date() },
    });
    if (!res.count) throw new ConflictException('This request was already decided or cancelled');
    const u = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
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
      const res = await this.prisma.leaveRequest.updateMany({ where: { id, status: r.status }, data: { status: 'CANCELLED' } });
      if (!res.count) throw new ConflictException('This request changed meanwhile. Refresh and try again');
      const u = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
      await this.audit.log(auth, 'leave.cancelled', 'leave_request', id, { wasApproved: r.status === 'APPROVED' });
      // Tell whoever approved it, or for a pending request the people it was waiting on.
      const tell = r.approverId ? [r.approverId] : await approversFor(this.prisma, auth.organizationId, auth.userId);
      if (tell.length)
        void this.notifications.notify({ organizationId: auth.organizationId, userIds: tell, actorId: auth.userId, type: 'leave', title: `${r.user.firstName} cancelled their ${r.type.name}`, body: `${ymd(r.startDate)} to ${ymd(r.endDate)}`, link: r.approverId ? '/app/leave?tab=team' : '/app/approvals' });
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
        // Archived people are hidden from everyday views; their history stays on their record.
        user: { ...people, status: { not: 'ARCHIVED' } },
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
