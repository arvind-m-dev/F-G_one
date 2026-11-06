import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, WorkLocation } from '@prisma/client';
import { daysBetween, MAX_RANGE_DAYS, parseOrganizationSettings, RT, type CorrectionInput } from '@fg/shared';
import { userScopeWhere } from '../common/authz';
import { approversFor, assertCanDecide, deciderScope } from '../common/approvals';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { addDays, localDate, localMinutes, localToUtc, toDbDate } from '../common/tz';
import { countWorkingDays } from '../common/workdays';
import { personSelect, toPerson } from '../employees/employee.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const recordInclude = { breaks: { orderBy: { startAt: 'asc' } } } satisfies Prisma.AttendanceRecordInclude;
type RecordRow = Prisma.AttendanceRecordGetPayload<{ include: typeof recordInclude }>;
type Policy = ReturnType<typeof parseOrganizationSettings>['attendance'];
export type AutoCheckOutReason = 'workday_end' | 'max_shift' | 'idle';

/** An open shift older than this is stale: it no longer blocks a new check-in. */
const SHIFT_WINDOW_MS = 24 * 3600_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
const AUTO_REASON_TEXT: Record<AutoCheckOutReason, string> = {
  workday_end: 'the workday had ended',
  max_shift: 'the shift reached its maximum length',
  idle: 'there was no activity in FG One',
};

export type AttendanceState = 'not_checked_in' | 'working' | 'on_break' | 'checked_out';

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * Attendance is a daily record (check-in → breaks → check-out) in the organization's time zone.
 * The record belongs to the day the shift started, so night shifts can check out after midnight.
 * With `multipleSessions`, checking in again reopens the day's record and the gap is stored as an AWAY interval.
 * It is deliberately independent from presence/status. All transitions are validated here,
 * so the UI only reflects server-confirmed state.
 */
@Injectable()
export class AttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AttendanceService.name);
  private sweep?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Auto check-out also runs lazily on every read; the timer covers people who never come back.
    if (process.env.NODE_ENV === 'test') return;
    this.sweep = setInterval(() => void this.sweepAll(), SWEEP_INTERVAL_MS);
    this.sweep.unref?.();
  }

  onModuleDestroy() {
    if (this.sweep) clearInterval(this.sweep);
  }

  private async sweepAll() {
    try {
      const orgs = await this.prisma.organization.findMany({ where: { attendance: { some: { checkOutAt: null } } }, select: { id: true, settings: true } });
      for (const o of orgs) await this.autoClose(o.id, parseOrganizationSettings(o.settings).attendance);
    } catch (e) {
      this.log.error(`Auto check-out sweep failed: ${(e as Error).message}`);
    }
  }

  private async policy(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return parseOrganizationSettings(org.settings).attendance;
  }

  serialize(r: RecordRow | null, now = new Date()) {
    if (!r) return null;
    const span = (b: RecordRow['breaks'][number]) => minutesBetween(b.startAt, b.endAt ?? r.checkOutAt ?? now);
    const breakMinutes = r.breaks.reduce((n, b) => n + (b.kind === 'BREAK' ? span(b) : 0), 0);
    const awayMinutes = r.breaks.reduce((n, b) => n + (b.kind === 'AWAY' ? span(b) : 0), 0);
    const end = r.checkOutAt ?? now;
    const state: AttendanceState = r.checkOutAt ? 'checked_out' : r.breaks.some((b) => b.kind === 'BREAK' && !b.endAt) ? 'on_break' : 'working';
    return {
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      location: r.location,
      remarks: r.remarks,
      checkInAt: r.checkInAt,
      checkOutAt: r.checkOutAt,
      checkOutRemarks: r.checkOutRemarks,
      late: r.late,
      autoCheckedIn: r.autoCheckedIn,
      autoCheckOutReason: (r.autoCheckOutReason as AutoCheckOutReason | null) ?? null,
      state,
      breaks: r.breaks.map((b) => ({ id: b.id, kind: b.kind, startAt: b.startAt, endAt: b.endAt })),
      breakMinutes,
      awayMinutes,
      workedMinutes: Math.max(0, minutesBetween(r.checkInAt, end) - breakMinutes - awayMinutes),
    };
  }

  private changed(auth: AuthContext) {
    this.realtime.toUser(auth.userId, RT.ATTENDANCE_CHANGED, { userId: auth.userId });
    this.realtime.server?.to(`org:${auth.organizationId}`).emit(RT.ATTENDANCE_CHANGED, { userId: auth.userId });
  }

  /**
   * The shift that matters now: an open one (started within 24h, may be yesterday's night shift),
   * else today's record, else an earlier shift that ended today (a night shift you just finished).
   */
  private async currentRecord(auth: AuthContext, tz: string) {
    const where = { userId: auth.userId, organizationId: auth.organizationId };
    const today = localDate(tz);
    const open = await this.prisma.attendanceRecord.findFirst({ where: { ...where, checkOutAt: null, checkInAt: { gte: new Date(Date.now() - SHIFT_WINDOW_MS) } }, include: recordInclude, orderBy: { checkInAt: 'desc' } });
    if (open) return open;
    const todays = await this.prisma.attendanceRecord.findUnique({ where: { userId_date: { userId: auth.userId, date: toDbDate(today) } }, include: recordInclude });
    if (todays) return todays;
    return this.prisma.attendanceRecord.findFirst({ where: { ...where, date: { lt: toDbDate(today) }, checkOutAt: { gte: localToUtc(today, '00:00', tz) } }, include: recordInclude, orderBy: { checkOutAt: 'desc' } });
  }

  /** Start of the latest session: the day's first check-in, or the last time you checked in again. */
  private sessionStart(r: RecordRow) {
    return r.breaks.reduce((t, b) => (b.kind === 'AWAY' && b.endAt && b.endAt > t ? b.endAt : t), r.checkInAt);
  }

  /** Working dates in a range (weekly pattern, holidays and special working days applied). */
  private async workingDates(organizationId: string, from: string, to: string) {
    return new Set((await countWorkingDays(this.prisma, organizationId, from, to)).dates);
  }

  /** Serialized record plus `dayOff`: worked on a weekly day off or a holiday. */
  private withDayOff(r: RecordRow | null, working: Set<string>) {
    const s = this.serialize(r);
    return s ? { ...s, dayOff: !working.has(s.date) } : null;
  }

  /** Working day (weekly pattern, holidays, special working days) and whether the person is on full-day leave. */
  private async dayStatus(auth: AuthContext, date: string) {
    const [{ days }, leave] = await Promise.all([
      countWorkingDays(this.prisma, auth.organizationId, date, date),
      this.prisma.leaveRequest.count({ where: { userId: auth.userId, organizationId: auth.organizationId, status: 'APPROVED', halfDay: 'NONE', startDate: { lte: toDbDate(date) }, endDate: { gte: toDbDate(date) } } }),
    ]);
    return { isWorkingDay: days > 0, onLeave: leave > 0 };
  }

  async today(auth: AuthContext) {
    const policy = await this.policy(auth.organizationId);
    await this.autoClose(auth.organizationId, policy, auth.userId);
    const date = localDate(policy.timezone);
    const [record, day] = await Promise.all([this.currentRecord(auth, policy.timezone), this.dayStatus(auth, date)]);
    const recordDate = record?.date.toISOString().slice(0, 10);
    const working = recordDate ? await this.workingDates(auth.organizationId, recordDate, recordDate) : new Set<string>();
    return {
      date,
      isWorkingDay: day.isWorkingDay,
      onLeave: day.onLeave,
      policy: {
        workdayStart: policy.workdayStart,
        workdayEnd: policy.workdayEnd,
        graceMinutes: policy.graceMinutes,
        timezone: policy.timezone,
        allowedLocations: policy.allowedLocations,
        breaksEnabled: policy.breaksEnabled,
        multipleSessions: policy.multipleSessions,
        checkInMode: policy.checkInMode,
        autoCheckOut: policy.autoCheckOut,
      },
      record: this.withDayOff(record, working),
    };
  }

  async checkIn(auth: AuthContext, location: WorkLocation, remarks?: string | null, auto = false) {
    const policy = await this.policy(auth.organizationId);
    if (!policy.allowedLocations.includes(location)) throw new BadRequestException('That work location is not enabled for your company');
    await this.autoClose(auth.organizationId, policy, auth.userId);
    const now = new Date();
    const date = localDate(policy.timezone, now);
    const current = await this.currentRecord(auth, policy.timezone);
    if (current && !current.checkOutAt) throw new ConflictException('You are already checked in');
    if (current && current.date.toISOString().slice(0, 10) === date) {
      // Checked out earlier today. Reopen when split shifts are allowed, or when the system closed the shift for you.
      if (!policy.multipleSessions && !current.autoCheckOutReason) throw new ConflictException('You have already checked in today');
      await this.prisma.$transaction(async (tx) => {
        // Reopen only the check-out we read, so a double tap doesn't store the gap twice.
        const res = await tx.attendanceRecord.updateMany({ where: { id: current.id, checkOutAt: current.checkOutAt }, data: { checkOutAt: null, checkOutRemarks: null, autoCheckOutReason: null, lastActiveAt: now } });
        if (!res.count) throw new ConflictException('You are already checked in');
        await tx.attendanceBreak.create({ data: { recordId: current.id, kind: 'AWAY', startAt: current.checkOutAt!, endAt: now } });
      });
    } else {
      const late = localMinutes(policy.timezone, now) > hhmm(policy.workdayStart) + policy.graceMinutes;
      try {
        await this.prisma.attendanceRecord.create({
          data: { organizationId: auth.organizationId, userId: auth.userId, date: toDbDate(date), location, remarks: remarks || null, checkInAt: now, late, autoCheckedIn: auto, lastActiveAt: now },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You have already checked in today');
        throw e;
      }
    }
    this.changed(auth);
    return this.today(auth);
  }

  /**
   * Checks you in when the company uses automatic check-in: on a working day, not on leave,
   * from two hours before the workday starts until it ends, and only if you haven't checked in today.
   */
  async autoCheckIn(auth: AuthContext) {
    const policy = await this.policy(auth.organizationId);
    if (policy.checkInMode !== 'auto') return { checkedIn: false, today: await this.today(auth) };
    const date = localDate(policy.timezone);
    const mins = localMinutes(policy.timezone);
    const [day, current] = await Promise.all([this.dayStatus(auth, date), this.currentRecord(auth, policy.timezone)]);
    const inWindow = mins >= hhmm(policy.workdayStart) - 120 && mins < hhmm(policy.workdayEnd);
    const alreadyToday = current && (!current.checkOutAt || current.date.toISOString().slice(0, 10) === date);
    if (!day.isWorkingDay || day.onLeave || !inWindow || alreadyToday) return { checkedIn: false, today: await this.today(auth) };
    const location = policy.allowedLocations.includes(policy.autoCheckInLocation) ? policy.autoCheckInLocation : policy.allowedLocations[0]!;
    try {
      return { checkedIn: true, today: await this.checkIn(auth, location, 'Checked in automatically', true) };
    } catch (e) {
      if (e instanceof ConflictException) return { checkedIn: false, today: await this.today(auth) };
      throw e;
    }
  }

  /** Activity heartbeat from the portal, used by the idle auto check-out rule. Written at most once a minute. */
  async activity(auth: AuthContext) {
    const policy = await this.policy(auth.organizationId);
    await this.autoClose(auth.organizationId, policy, auth.userId);
    const now = Date.now();
    await this.prisma.attendanceRecord.updateMany({
      where: { userId: auth.userId, organizationId: auth.organizationId, checkOutAt: null, checkInAt: { gte: new Date(now - SHIFT_WINDOW_MS) }, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: new Date(now - 60_000) } }] },
      data: { lastActiveAt: new Date(now) },
    });
    return { ok: true };
  }

  /** When an open shift should be closed by the enabled rules: the rule that fires first wins. */
  private autoCheckOutAt(r: RecordRow, policy: Policy): { fireAt: Date; at: Date; reason: AutoCheckOutReason } | null {
    const { afterWorkdayEndHours, maxShiftHours, idleMinutes } = policy.autoCheckOut;
    const rules: { fireAt: Date; at: Date; reason: AutoCheckOutReason }[] = [];
    // Rules measure the current session, so checking in again after an automatic check-out isn't closed straight away.
    const start = this.sessionStart(r);
    if (maxShiftHours) {
      const at = new Date(start.getTime() + maxShiftHours * 3600_000);
      rules.push({ fireAt: at, at, reason: 'max_shift' });
    }
    if (afterWorkdayEndHours) {
      const end = localToUtc(r.date.toISOString().slice(0, 10), policy.workdayEnd, policy.timezone);
      // Night shifts start after the workday ends; only the shift-length rule applies to them.
      if (start < end) {
        const at = new Date(end.getTime() + afterWorkdayEndHours * 3600_000);
        rules.push({ fireAt: at, at, reason: 'workday_end' });
      }
    }
    if (idleMinutes && !r.breaks.some((b) => b.kind === 'BREAK' && !b.endAt)) {
      // Closed at the last moment we saw activity, once the idle limit has passed. Returning from a
      // break is activity too, so count the latest break end; otherwise a break longer than the idle
      // limit would auto-close the shift the instant the person comes back.
      const breakEnds = r.breaks.map((b) => b.endAt).filter((d): d is Date => !!d);
      const last = [start, ...(r.lastActiveAt ? [r.lastActiveAt] : []), ...breakEnds].reduce((a, b) => (b > a ? b : a));
      rules.push({ fireAt: new Date(last.getTime() + idleMinutes * 60_000), at: last, reason: 'idle' });
    }
    if (!rules.length) return null;
    return rules.reduce((a, b) => (b.fireAt < a.fireAt ? b : a));
  }

  /** Closes open shifts that hit an enabled auto check-out rule. Runs lazily on reads and on a timer. */
  async autoClose(organizationId: string, policy: Policy, userId?: string) {
    const { afterWorkdayEndHours, maxShiftHours, idleMinutes } = policy.autoCheckOut;
    if (!afterWorkdayEndHours && !maxShiftHours && !idleMinutes) return 0;
    const now = new Date();
    const open = await this.prisma.attendanceRecord.findMany({ where: { organizationId, checkOutAt: null, ...(userId ? { userId } : {}) }, include: recordInclude });
    let closed = 0;
    for (const r of open) {
      const rule = this.autoCheckOutAt(r, policy);
      if (!rule || rule.fireAt > now) continue;
      const start = this.sessionStart(r);
      const at = rule.at < start ? start : rule.at;
      const done = await this.prisma.$transaction(async (tx) => {
        const res = await tx.attendanceRecord.updateMany({ where: { id: r.id, checkOutAt: null }, data: { checkOutAt: at, autoCheckOutReason: rule.reason } });
        if (!res.count) return false;
        for (const b of r.breaks.filter((x) => !x.endAt)) await tx.attendanceBreak.update({ where: { id: b.id }, data: { endAt: b.startAt > at ? b.startAt : at } });
        return true;
      });
      if (!done) continue;
      closed++;
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: policy.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
      void this.notifications.notify({
        organizationId,
        userIds: [r.userId],
        type: 'correction',
        title: `You were checked out automatically at ${time}`,
        body: `Because ${AUTO_REASON_TEXT[rule.reason]}. If you were still working, check in again or request a correction.`,
        link: '/app/attendance',
      });
      this.changed({ userId: r.userId, organizationId } as AuthContext);
    }
    return closed;
  }

  private async openRecord(auth: AuthContext) {
    const policy = await this.policy(auth.organizationId);
    await this.autoClose(auth.organizationId, policy, auth.userId);
    const r = await this.currentRecord(auth, policy.timezone);
    if (!r) throw new BadRequestException('Check in first');
    if (r.checkOutAt) throw new BadRequestException(policy.multipleSessions || r.autoCheckOutReason ? 'You are checked out. Check in again first' : 'You have already checked out today');
    return { r, policy };
  }

  async startBreak(auth: AuthContext) {
    const { r, policy } = await this.openRecord(auth);
    if (!policy.breaksEnabled) throw new BadRequestException('Breaks are not tracked for your company');
    // Two taps (or two tabs) at once must not open two breaks: check again while holding the record's row lock.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AttendanceRecord" WHERE id = ${r.id} FOR UPDATE`;
      const [open, rec] = await Promise.all([tx.attendanceBreak.count({ where: { recordId: r.id, endAt: null } }), tx.attendanceRecord.findUniqueOrThrow({ where: { id: r.id }, select: { checkOutAt: true } })]);
      if (rec.checkOutAt) throw new BadRequestException('You are checked out');
      if (open) throw new ConflictException('You are already on a break');
      await tx.attendanceBreak.create({ data: { recordId: r.id, startAt: new Date() } });
    });
    this.changed(auth);
    return this.today(auth);
  }

  async endBreak(auth: AuthContext) {
    const { r } = await this.openRecord(auth);
    const open = r.breaks.find((b) => !b.endAt);
    if (!open) throw new BadRequestException('You are not on a break');
    const res = await this.prisma.attendanceBreak.updateMany({ where: { id: open.id, endAt: null }, data: { endAt: new Date() } });
    if (!res.count) throw new BadRequestException('You are not on a break');
    this.changed(auth);
    return this.today(auth);
  }

  async checkOut(auth: AuthContext, remarks?: string | null) {
    const { r } = await this.openRecord(auth);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Only the first of two simultaneous check-outs counts; the second would move the time.
      const res = await tx.attendanceRecord.updateMany({ where: { id: r.id, checkOutAt: null }, data: { checkOutAt: now, checkOutRemarks: remarks || null } });
      if (!res.count) throw new ConflictException('You have already checked out');
      await tx.attendanceBreak.updateMany({ where: { recordId: r.id, endAt: null }, data: { endAt: now } });
    });
    this.changed(auth);
    return this.today(auth);
  }

  async history(auth: AuthContext, userId: string, from?: string, to?: string) {
    if (userId !== auth.userId) await this.assertCanView(auth, userId);
    const policy = await this.policy(auth.organizationId);
    await this.autoClose(auth.organizationId, policy, userId);
    const { start, end } = this.range(policy, from, to);
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { userId, organizationId: auth.organizationId, date: { gte: toDbDate(start), lte: toDbDate(end) } },
      include: recordInclude,
      orderBy: { date: 'desc' },
    });
    const working = await this.workingDates(auth.organizationId, start, end);
    const items = rows.map((r) => this.withDayOff(r, working)!);
    return {
      from: start,
      to: end,
      timezone: policy.timezone,
      items,
      summary: {
        daysPresent: items.length,
        late: items.filter((i) => i.late).length,
        autoCheckedOut: items.filter((i) => i.autoCheckOutReason).length,
        dayOffWorked: items.filter((i) => i.dayOff).length,
        office: items.filter((i) => i.location === 'WFO').length,
        home: items.filter((i) => i.location === 'WFH').length,
        clientSite: items.filter((i) => i.location === 'ON_DUTY').length,
        workedMinutes: items.reduce((n, i) => n + i.workedMinutes, 0),
      },
    };
  }

  /** A date range in the organization's time zone (default: the last 30 days), at most MAX_RANGE_DAYS long. */
  private range(policy: Policy, from?: string, to?: string) {
    const end = to ?? localDate(policy.timezone);
    const start = from ?? addDays(end, -29);
    if (start > end) throw new BadRequestException('"from" must be on or before "to"');
    if (daysBetween(start, end) >= MAX_RANGE_DAYS) throw new BadRequestException(`Choose at most ${MAX_RANGE_DAYS} days`);
    return { start, end };
  }

  /** Who the caller may see, from the `attendance.view` grant: ORG = everyone, TEAM = direct reports. */
  private async scope(auth: AuthContext): Promise<Prisma.UserWhereInput> {
    return userScopeWhere(auth, 'attendance.view', 'You do not have permission to view team attendance');
  }

  private async assertCanView(auth: AuthContext, userId: string) {
    const scope = await this.scope(auth);
    // Someone outside the organization (or an id that doesn't exist) is not found.
    const exists = await this.prisma.user.count({ where: { id: userId, organizationId: auth.organizationId } });
    if (!exists) throw new NotFoundException('Employee not found');
    const ok = await this.prisma.user.count({ where: { ...scope, id: userId } });
    if (!ok) throw new ForbiddenException('You cannot view this person’s attendance');
  }

  async board(auth: AuthContext, date?: string) {
    const scope = await this.scope(auth);
    const policy = await this.policy(auth.organizationId);
    await this.autoClose(auth.organizationId, policy);
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
    const working = await this.workingDates(auth.organizationId, day, day);
    const rows = people.map(({ attendance, ...p }) => ({ person: toPerson(p, this.realtime.isOnline(p.id)), record: this.withDayOff(attendance[0] ?? null, working), leave: leaveBy.get(p.id) ?? null }));
    const recs = rows.map((r) => r.record).filter(Boolean) as NonNullable<ReturnType<AttendanceService['serialize']>>[];
    return {
      date: day,
      timezone: policy.timezone,
      isToday: day === localDate(policy.timezone),
      isWorkingDay: working.has(day),
      totals: {
        employees: rows.length,
        checkedIn: recs.length,
        office: recs.filter((r) => r.location === 'WFO').length,
        home: recs.filter((r) => r.location === 'WFH').length,
        clientSite: recs.filter((r) => r.location === 'ON_DUTY').length,
        onBreak: recs.filter((r) => r.state === 'on_break').length,
        checkedOut: recs.filter((r) => r.state === 'checked_out').length,
        // Nobody is expected to check in on a day off.
        notCheckedIn: working.has(day) ? rows.filter((r) => !r.record && !r.leave).length : 0,
        onLeave: rows.filter((r) => r.leave).length,
        late: recs.filter((r) => r.late).length,
      },
      rows,
    };
  }

  async exportCsv(auth: AuthContext, from?: string, to?: string) {
    const scope = await this.scope(auth);
    const policy = await this.policy(auth.organizationId);
    await this.autoClose(auth.organizationId, policy);
    const { start, end } = this.range(policy, from, to);
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
      if (/^[=+\-@\t\r＝＋－＠]/.test(s)) s = `'${s}`;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Employee', 'Email', 'Employee code', 'Department', 'Location', 'Check in', 'Check out', 'Break (min)', 'Worked (min)', 'Late', 'Checked in automatically', 'Checked out automatically', 'Remarks'];
    const lines = rows.map((r) => {
      const s = this.serialize(r)!;
      return [s.date, `${r.user.firstName} ${r.user.lastName}`, r.user.email, r.user.employeeCode, r.user.department?.name, s.location, fmt(r.checkInAt), fmt(r.checkOutAt), s.breakMinutes, s.workedMinutes, s.late ? 'yes' : 'no', s.autoCheckedIn ? 'yes' : 'no', s.autoCheckOutReason ? AUTO_REASON_TEXT[s.autoCheckOutReason] : 'no', [r.remarks, r.checkOutRemarks].filter(Boolean).join(' | ')]
        .map(cell)
        .join(',');
    });
    await this.audit.log(auth, 'attendance.exported', 'attendance', null, { from: start, to: end, rows: rows.length });
    return { filename: `attendance-${start}-to-${end}.csv`, csv: [header.join(','), ...lines].join('\n') };
  }

  // ───────── corrections ─────────

  async requestCorrection(auth: AuthContext, body: CorrectionInput) {
    const policy = await this.policy(auth.organizationId);
    const today = localDate(policy.timezone);
    if (body.date > today) throw new BadRequestException('You can only correct today or past days');
    if (body.date < addDays(today, -60)) throw new BadRequestException('Corrections are limited to the last 60 days');
    if (body.date === today) {
      const nowHm = localMinutes(policy.timezone);
      if (hhmm(body.checkIn) > nowHm || (body.checkOut && hhmm(body.checkOut) > nowHm)) throw new BadRequestException('Those times are later than now');
    } else if (!body.checkOut) {
      // A past day without an end would leave an open shift that never finishes.
      throw new BadRequestException('Add the time you finished for a past day');
    }
    const c = await this.prisma.$transaction(async (tx) => {
      // One pending correction per day, also when the form is sent twice at once.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`correction:${auth.userId}:${body.date}`}))`;
      const dup = await tx.attendanceCorrection.count({ where: { userId: auth.userId, date: toDbDate(body.date), status: 'PENDING' } });
      if (dup) throw new ConflictException('You already have a pending correction for that day');
      return tx.attendanceCorrection.create({
        data: { organizationId: auth.organizationId, userId: auth.userId, date: toDbDate(body.date), checkIn: body.checkIn, checkOut: body.checkOut ?? null, location: body.location, reason: body.reason },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
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
      // Only one of two simultaneous decisions applies.
      const res = await tx.attendanceCorrection.updateMany({ where: { id, status: 'PENDING' }, data: { status: decision, reviewerId: auth.userId, reviewNote: note || null, decidedAt: new Date() } });
      if (!res.count) throw new ConflictException('This correction was already decided');
      if (decision === 'APPROVED') {
        const checkInAt = localToUtc(day, c.checkIn, policy.timezone);
        const checkOutAt = c.checkOut ? localToUtc(day, c.checkOut, policy.timezone) : null;
        const [h, m] = c.checkIn.split(':').map(Number);
        const late = h! * 60 + m! > hhmm(policy.workdayStart) + policy.graceMinutes;
        const remarks = `Corrected: ${c.reason}`.slice(0, 200);
        const rec = await tx.attendanceRecord.upsert({
          where: { userId_date: { userId: c.userId, date: c.date } },
          // A correction with no finish time fixes only the check-in; keep any existing check-out
          // rather than erasing it with null.
          update: { checkInAt, location: c.location, late, remarks, autoCheckOutReason: null, ...(c.checkOut ? { checkOutAt } : {}) },
          create: { organizationId: auth.organizationId, userId: c.userId, date: c.date, checkInAt, checkOutAt, location: c.location, late, remarks },
        });
        // Breaks recorded outside the corrected hours no longer apply; ones that overlap an edge are trimmed to it.
        await tx.attendanceBreak.deleteMany({ where: { recordId: rec.id, OR: [{ endAt: { lte: checkInAt } }, ...(checkOutAt ? [{ startAt: { gte: checkOutAt } }] : [])] } });
        await tx.attendanceBreak.updateMany({ where: { recordId: rec.id, startAt: { lt: checkInAt } }, data: { startAt: checkInAt } });
        if (checkOutAt) await tx.attendanceBreak.updateMany({ where: { recordId: rec.id, OR: [{ endAt: null }, { endAt: { gt: checkOutAt } }] }, data: { endAt: checkOutAt } });
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
