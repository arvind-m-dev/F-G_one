import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkLocation } from '@prisma/client';
import { hasPermission, parseOrganizationSettings, PERMISSIONS, RT, type CorrectionInput } from '@fg/shared';
import { userScopeWhere } from '../common/authz';
import { approversFor, assertCanDecide, deciderScope } from '../common/approvals';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { addDays, localDate, localMinutes, localToUtc, localWeekday, toDbDate } from '../common/tz';
import { personSelect, toPerson } from '../employees/employee.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const recordInclude = { breaks: { orderBy: { startAt: 'asc' } } } satisfies Prisma.AttendanceRecordInclude;
type RecordRow = Prisma.AttendanceRecordGetPayload<{ include: typeof recordInclude }>;

export type AttendanceState = 'not_checked_in' | 'working' | 'on_break' | 'checked_out';

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * Attendance is a daily record (check-in → breaks → check-out) in the organization's time zone.
 * It is deliberately independent from presence/status. All transitions are validated here,
 * so the UI only reflects server-confirmed state.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async policy(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return parseOrganizationSettings(org.settings).attendance;
  }

  serialize(r: RecordRow | null, now = new Date()) {
    if (!r) return null;
    const breakMinutes = r.breaks.reduce((n, b) => n + minutesBetween(b.startAt, b.endAt ?? r.checkOutAt ?? now), 0);
    const end = r.checkOutAt ?? now;
    const state: AttendanceState = r.checkOutAt ? 'checked_out' : r.breaks.some((b) => !b.endAt) ? 'on_break' : 'working';
    return {
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      location: r.location,
      remarks: r.remarks,
      checkInAt: r.checkInAt,
      checkOutAt: r.checkOutAt,
      checkOutRemarks: r.checkOutRemarks,
      late: r.late,
      state,
      breaks: r.breaks.map((b) => ({ id: b.id, startAt: b.startAt, endAt: b.endAt })),
      breakMinutes,
      workedMinutes: Math.max(0, minutesBetween(r.checkInAt, end) - breakMinutes),
    };
  }

  private changed(auth: AuthContext) {
    this.realtime.toUser(auth.userId, RT.ATTENDANCE_CHANGED, { userId: auth.userId });
    this.realtime.server?.to(`org:${auth.organizationId}`).emit(RT.ATTENDANCE_CHANGED, { userId: auth.userId });
  }

  private async todayRecord(auth: AuthContext, tz: string) {
    return this.prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId: auth.userId, date: toDbDate(localDate(tz)) } },
      include: recordInclude,
    });
  }

  async today(auth: AuthContext) {
    const policy = await this.policy(auth.organizationId);
    const record = await this.todayRecord(auth, policy.timezone);
    return {
      date: localDate(policy.timezone),
      isWorkingDay: policy.workingDays.includes(localWeekday(policy.timezone)),
      policy: {
        workdayStart: policy.workdayStart,
        workdayEnd: policy.workdayEnd,
        graceMinutes: policy.graceMinutes,
        timezone: policy.timezone,
        allowedLocations: policy.allowedLocations,
        breaksEnabled: policy.breaksEnabled,
      },
      record: this.serialize(record),
    };
  }

  async checkIn(auth: AuthContext, location: WorkLocation, remarks?: string | null) {
    const policy = await this.policy(auth.organizationId);
    if (!policy.allowedLocations.includes(location)) throw new BadRequestException('That work location is not enabled for your company');
    const now = new Date();
    const date = localDate(policy.timezone, now);
    const late = localMinutes(policy.timezone, now) > hhmm(policy.workdayStart) + policy.graceMinutes;
    try {
      await this.prisma.attendanceRecord.create({
        data: { organizationId: auth.organizationId, userId: auth.userId, date: toDbDate(date), location, remarks: remarks || null, checkInAt: now, late },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You have already checked in today');
      throw e;
    }
    this.changed(auth);
    return this.today(auth);
  }

  private async openRecord(auth: AuthContext) {
    const policy = await this.policy(auth.organizationId);
    const r = await this.todayRecord(auth, policy.timezone);
    if (!r) throw new BadRequestException('Check in first');
    if (r.checkOutAt) throw new BadRequestException('You have already checked out today');
    return { r, policy };
  }

  async startBreak(auth: AuthContext) {
    const { r, policy } = await this.openRecord(auth);
    if (!policy.breaksEnabled) throw new BadRequestException('Breaks are not tracked for your company');
    if (r.breaks.some((b) => !b.endAt)) throw new ConflictException('You are already on a break');
    await this.prisma.attendanceBreak.create({ data: { recordId: r.id, startAt: new Date() } });
    this.changed(auth);
    return this.today(auth);
  }

  async endBreak(auth: AuthContext) {
    const { r } = await this.openRecord(auth);
    const open = r.breaks.find((b) => !b.endAt);
    if (!open) throw new BadRequestException('You are not on a break');
    await this.prisma.attendanceBreak.update({ where: { id: open.id }, data: { endAt: new Date() } });
    this.changed(auth);
    return this.today(auth);
  }

  async checkOut(auth: AuthContext, remarks?: string | null) {
    const { r } = await this.openRecord(auth);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.attendanceBreak.updateMany({ where: { recordId: r.id, endAt: null }, data: { endAt: now } }),
      this.prisma.attendanceRecord.update({ where: { id: r.id }, data: { checkOutAt: now, checkOutRemarks: remarks || null } }),
    ]);
    this.changed(auth);
    return this.today(auth);
  }

  async history(auth: AuthContext, userId: string, from?: string, to?: string) {
    if (userId !== auth.userId) await this.assertCanView(auth, userId);
    const policy = await this.policy(auth.organizationId);
    const end = to ?? localDate(policy.timezone);
    const start = from ?? addDays(end, -29);
    if (start > end) throw new BadRequestException('"from" must be before "to"');
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { userId, organizationId: auth.organizationId, date: { gte: toDbDate(start), lte: toDbDate(end) } },
      include: recordInclude,
      orderBy: { date: 'desc' },
    });
    const items = rows.map((r) => this.serialize(r)!);
    return {
      from: start,
      to: end,
      timezone: policy.timezone,
      items,
      summary: {
        daysPresent: items.length,
        late: items.filter((i) => i.late).length,
        office: items.filter((i) => i.location === 'WFO').length,
        home: items.filter((i) => i.location === 'WFH').length,
        clientSite: items.filter((i) => i.location === 'ON_DUTY').length,
        workedMinutes: items.reduce((n, i) => n + i.workedMinutes, 0),
      },
    };
  }

  /** Who the caller may see, from the `attendance.view` grant: ORG = everyone, TEAM = direct reports. */
  private async scope(auth: AuthContext): Promise<Prisma.UserWhereInput> {
    return userScopeWhere(auth, 'attendance.view', 'You do not have permission to view team attendance');
  }

  private async assertCanView(auth: AuthContext, userId: string) {
    const scope = await this.scope(auth);
    const ok = await this.prisma.user.count({ where: { ...scope, id: userId } });
    if (!ok) throw new ForbiddenException('You cannot view this person’s attendance');
  }

  async board(auth: AuthContext, date?: string) {
    const scope = await this.scope(auth);
    const policy = await this.policy(auth.organizationId);
    const day = date ?? localDate(policy.timezone);
    const people = await this.prisma.user.findMany({
      where: { ...scope, status: 'ACTIVE' },
      select: { ...personSelect, attendance: { where: { date: toDbDate(day) }, include: recordInclude } },
      orderBy: [{ firstName: 'asc' }],
    });
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { organizationId: auth.organizationId, status: 'APPROVED', startDate: { lte: toDbDate(day) }, endDate: { gte: toDbDate(day) }, userId: { in: people.map((p) => p.id) } },
      select: { userId: true, halfDay: true, type: { select: { name: true, color: true } } },
    });
    const leaveBy = new Map(leaves.map((l) => [l.userId, { type: l.type.name, color: l.type.color, halfDay: l.halfDay !== 'NONE' }]));
    const rows = people.map(({ attendance, ...p }) => ({ person: toPerson(p, this.realtime.isOnline(p.id)), record: this.serialize(attendance[0] ?? null), leave: leaveBy.get(p.id) ?? null }));
    const recs = rows.map((r) => r.record).filter(Boolean) as NonNullable<ReturnType<AttendanceService['serialize']>>[];
    return {
      date: day,
      timezone: policy.timezone,
      isToday: day === localDate(policy.timezone),
      totals: {
        employees: rows.length,
        checkedIn: recs.length,
        office: recs.filter((r) => r.location === 'WFO').length,
        home: recs.filter((r) => r.location === 'WFH').length,
        clientSite: recs.filter((r) => r.location === 'ON_DUTY').length,
        onBreak: recs.filter((r) => r.state === 'on_break').length,
        checkedOut: recs.filter((r) => r.state === 'checked_out').length,
        notCheckedIn: rows.filter((r) => !r.record && !r.leave).length,
        onLeave: rows.filter((r) => r.leave).length,
        late: recs.filter((r) => r.late).length,
      },
      rows,
    };
  }

  async exportCsv(auth: AuthContext, from?: string, to?: string) {
    const scope = await this.scope(auth);
    const policy = await this.policy(auth.organizationId);
    const end = to ?? localDate(policy.timezone);
    const start = from ?? addDays(end, -29);
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { organizationId: auth.organizationId, user: scope, date: { gte: toDbDate(start), lte: toDbDate(end) } },
      include: { ...recordInclude, user: { select: { firstName: true, lastName: true, email: true, employeeCode: true, department: { select: { name: true } } } } },
      orderBy: [{ date: 'desc' }, { user: { firstName: 'asc' } }],
    });
    const fmt = (d: Date | null) =>
      d ? new Intl.DateTimeFormat('en-GB', { timeZone: policy.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d) : '';
    // Prefix values that spreadsheet apps would treat as formulas.
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Employee', 'Email', 'Employee code', 'Department', 'Location', 'Check in', 'Check out', 'Break (min)', 'Worked (min)', 'Late', 'Remarks'];
    const lines = rows.map((r) => {
      const s = this.serialize(r)!;
      return [s.date, `${r.user.firstName} ${r.user.lastName}`, r.user.email, r.user.employeeCode, r.user.department?.name, s.location, fmt(r.checkInAt), fmt(r.checkOutAt), s.breakMinutes, s.workedMinutes, s.late ? 'yes' : 'no', [r.remarks, r.checkOutRemarks].filter(Boolean).join(' | ')]
        .map(cell)
        .join(',');
    });
    await this.audit.log(auth, 'attendance.exported', 'attendance', null, { from: start, to: end, rows: rows.length });
    return { filename: `attendance-${start}-to-${end}.csv`, csv: [header.join(','), ...lines].join('\n') };
  }

  // ───────── corrections ─────────

  async requestCorrection(auth: AuthContext, body: CorrectionInput) {
    const policy = await this.policy(auth.organizationId);
    if (body.date > localDate(policy.timezone)) throw new BadRequestException('You can only correct today or past days');
    if (body.date < addDays(localDate(policy.timezone), -60)) throw new BadRequestException('Corrections are limited to the last 60 days');
    const dup = await this.prisma.attendanceCorrection.count({ where: { userId: auth.userId, date: toDbDate(body.date), status: 'PENDING' } });
    if (dup) throw new ConflictException('You already have a pending correction for that day');
    const c = await this.prisma.attendanceCorrection.create({
      data: { organizationId: auth.organizationId, userId: auth.userId, date: toDbDate(body.date), checkIn: body.checkIn, checkOut: body.checkOut ?? null, location: body.location, reason: body.reason },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.log(auth, 'attendance.correction_requested', 'attendance_correction', c.id, { date: body.date });
    void this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: await approversFor(this.prisma, auth.organizationId, auth.userId),
      actorId: auth.userId,
      type: 'correction',
      title: `${c.user.firstName} ${c.user.lastName} asked to correct attendance for ${body.date}`,
      body: body.reason,
      link: '/app/approvals',
    });
    return this.serializeCorrection({ ...c, user: undefined } as never);
  }

  private serializeCorrection(c: { id: string; date: Date; checkIn: string; checkOut: string | null; location: string; reason: string; status: string; reviewNote: string | null; decidedAt: Date | null; createdAt: Date; user?: Parameters<typeof toPerson>[0]; reviewer?: { firstName: string; lastName: string } | null }) {
    return {
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      checkIn: c.checkIn,
      checkOut: c.checkOut,
      location: c.location,
      reason: c.reason,
      status: c.status,
      reviewNote: c.reviewNote,
      decidedAt: c.decidedAt,
      createdAt: c.createdAt,
      person: c.user ? toPerson(c.user) : undefined,
      reviewer: c.reviewer ?? null,
    };
  }

  async listCorrections(auth: AuthContext, scope: 'mine' | 'approvals') {
    let where: Prisma.AttendanceCorrectionWhereInput = { userId: auth.userId, organizationId: auth.organizationId };
    if (scope === 'approvals') {
      const s = deciderScope(auth, 'attendance');
      if (!s) throw new ForbiddenException('You do not review attendance');
      where = { ...s, status: 'PENDING' };
    }
    const rows = await this.prisma.attendanceCorrection.findMany({
      where,
      include: { user: { select: personSelect }, reviewer: { select: { firstName: true, lastName: true } } },
      orderBy: [{ status: 'asc' }, { date: 'desc' }],
      take: 100,
    });
    return rows.map((r) => this.serializeCorrection(r));
  }

  async decideCorrection(auth: AuthContext, id: string, decision: 'APPROVED' | 'REJECTED', note?: string | null) {
    const c = await this.prisma.attendanceCorrection.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!c) throw new NotFoundException('Correction not found');
    await assertCanDecide(this.prisma, auth, c.userId, 'attendance');
    if (c.status !== 'PENDING') throw new ConflictException(`Already ${c.status.toLowerCase()}`);
    const policy = await this.policy(auth.organizationId);
    const day = c.date.toISOString().slice(0, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceCorrection.update({ where: { id }, data: { status: decision, reviewerId: auth.userId, reviewNote: note || null, decidedAt: new Date() } });
      if (decision === 'APPROVED') {
        const checkInAt = localToUtc(day, c.checkIn, policy.timezone);
        const checkOutAt = c.checkOut ? localToUtc(day, c.checkOut, policy.timezone) : null;
        const [h, m] = c.checkIn.split(':').map(Number);
        const late = h! * 60 + m! > hhmm(policy.workdayStart) + policy.graceMinutes;
        const remarks = `Corrected: ${c.reason}`.slice(0, 200);
        await tx.attendanceRecord.upsert({
          where: { userId_date: { userId: c.userId, date: c.date } },
          update: { checkInAt, checkOutAt, location: c.location, late, remarks },
          create: { organizationId: auth.organizationId, userId: c.userId, date: c.date, checkInAt, checkOutAt, location: c.location, late, remarks },
        });
      }
    });
    await this.audit.log(auth, decision === 'APPROVED' ? 'attendance.corrected' : 'attendance.correction_rejected', 'attendance_correction', id, { userId: c.userId, date: day, checkIn: c.checkIn, checkOut: c.checkOut });
    void this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: [c.userId],
      actorId: auth.userId,
      type: 'correction',
      title: `Your attendance correction for ${day} was ${decision === 'APPROVED' ? 'approved' : 'declined'}`,
      body: note || null,
      link: '/app/attendance',
    });
    this.realtime.toUser(c.userId, RT.ATTENDANCE_CHANGED, { userId: c.userId });
    return { ok: true };
  }
}
