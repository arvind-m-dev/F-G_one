import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, WorkLocation } from '@prisma/client';
import { hasPermission, parseOrganizationSettings, PERMISSIONS, RT } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { addDays, localDate, localMinutes, localWeekday, toDbDate } from '../common/tz';
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

  /** Who the caller may see: everyone (attendance.view_all) or their direct reports (attendance.view_team). */
  private async scope(auth: AuthContext): Promise<Prisma.UserWhereInput> {
    if (hasPermission(auth.permissions, PERMISSIONS.ATTENDANCE_VIEW_ALL)) return { organizationId: auth.organizationId };
    if (hasPermission(auth.permissions, PERMISSIONS.ATTENDANCE_VIEW_TEAM)) return { organizationId: auth.organizationId, managerId: auth.userId };
    throw new ForbiddenException('You do not have permission to view team attendance');
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
    const rows = people.map(({ attendance, ...p }) => ({ person: toPerson(p, this.realtime.isOnline(p.id)), record: this.serialize(attendance[0] ?? null) }));
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
        notCheckedIn: rows.length - recs.length,
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
}
