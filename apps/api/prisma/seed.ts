/**
 * Development seed: Futurist Global with ten departments, a three-level manager tree, about 45 people
 * (including deactivated, suspended and one waiting for a password), 60 days of attendance, a year of leave,
 * holidays for this year and next, announcements with read confirmations, channels, group messages, threads,
 * reactions and notifications. Also creates a second organization ("Acme Test Co") used to verify tenant isolation.
 *
 * Deterministic: every random choice comes from a seeded generator, so two runs on the same day produce the same data.
 * Idempotent per organization: re-running wipes and recreates the seeded orgs.
 * Requires SEED_PASSWORD (never hard-coded). Refuses to run in production.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, organizationSettingsSchema, REACTION_KEYS } from '@fg/shared';
import { ANNOUNCEMENTS, CHANNELS, DEMO_EMAILS, DEPARTMENT_HEADS, DEPARTMENTS, DIRECT, HISTORY, holidaysFor, PEOPLE, type Person, RECENT, REPLIES, WAITING_FOR_PASSWORD } from './seed-data';

export { DEMO_EMAILS, PEOPLE } from './seed-data';
export const prisma = new PrismaClient();

// ─────────────── deterministic randomness ───────────────

/** A small seeded generator (mulberry32). Each area gets its own stream, so changing one area does not reshuffle the others. */
export function rng(label: string) {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    sample: <T>(arr: readonly T[], n: number): T[] => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, n);
    },
  };
}

// ─────────────── dates in the organization's time zone ───────────────

/** The demo organization uses the default attendance time zone (India, no daylight saving). */
export const DEMO_TZ = 'Asia/Kolkata';
const TZ_OFFSET = '+05:30';
export const ymdIn = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: DEMO_TZ }).format(d);
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const dbDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
/** Local wall-clock minutes after midnight on `ymd` (may exceed 24 h for the next morning) → instant. */
const at = (ymd: string, minutes: number) => new Date(Date.parse(`${ymd}T00:00:00${TZ_OFFSET}`) + Math.round(minutes) * 60_000);
const nowLocalMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: DEMO_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
  return h * 60 + m;
};
/** Matches the API: workday start 09:30 plus 15 minutes of grace. */
const LATE_AFTER = 9 * 60 + 45;

type Ids = Record<string, { id: string }>;

/** What the generators need to know about the organization. Built by the seed, or from the database by seed-fill. */
export type SeedContext = {
  organizationId: string;
  today: string;
  /** Email → user id, for people in PEOPLE who exist in this organization. */
  users: Ids;
  people: (Person & { id: string })[];
  /** MANDATORY/COMPANY holiday dates (days off) and SPECIAL_WORKING_DAY dates. */
  daysOff: Set<string>;
  specialWorkingDays: Set<string>;
};

export async function buildContext(organizationId: string): Promise<SeedContext> {
  const rows = await prisma.user.findMany({ where: { organizationId }, select: { id: true, email: true } });
  const users: Ids = Object.fromEntries(rows.map((u) => [u.email, { id: u.id }]));
  const holidays = await prisma.holiday.findMany({ where: { organizationId }, select: { date: true, type: true } });
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    organizationId,
    today: ymdIn(new Date()),
    users,
    people: PEOPLE.filter((p) => users[p.email]).map((p) => ({ ...p, id: users[p.email].id })),
    daysOff: new Set(holidays.filter((h) => h.type === 'MANDATORY' || h.type === 'COMPANY').map((h) => iso(h.date))),
    specialWorkingDays: new Set(holidays.filter((h) => h.type === 'SPECIAL_WORKING_DAY').map((h) => iso(h.date))),
  };
}

const isWorkingDay = (ctx: SeedContext, ymd: string) => ctx.specialWorkingDays.has(ymd) || (dow(ymd) !== 0 && dow(ymd) !== 6 && !ctx.daysOff.has(ymd));
const workingDaysIn = (ctx: SeedContext, from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(ctx, d)) out.push(d);
  return out;
};
/** The day a person stopped working (deactivated or suspended), if any. */
const lastDay = (ctx: SeedContext, p: Person) => (p.status === 'DEACTIVATED' || p.status === 'SUSPENDED' ? addDays(ctx.today, -(p.statusDaysAgo ?? 0) - 1) : null);
const employed = (ctx: SeedContext, p: Person, ymd: string) => p.joined <= ymd && (!lastDay(ctx, p) || ymd <= lastDay(ctx, p)!) && p.status !== 'INVITED';
const fullName = (p: Person) => `${p.first} ${p.last}`;
const personByEmail = new Map(PEOPLE.map((p) => [p.email, p]));
/** Who approves someone's requests: their manager, or HR for people without one. */
const approverOf = (p: Person) => p.manager ?? (p.email === 'hr@futuristglobal.com' ? 'admin@futuristglobal.com' : 'hr@futuristglobal.com');

// ─────────────── holidays ───────────────

export async function seedHolidays(organizationId: string) {
  const year = Number(ymdIn(new Date()).slice(0, 4));
  const rows = [...holidaysFor(year), ...holidaysFor(year + 1)];
  const existing = await prisma.holiday.findMany({ where: { organizationId, date: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year + 1}-12-31`) } }, select: { date: true } });
  const taken = new Set(existing.map((h) => h.date.toISOString().slice(0, 10)));
  const fresh = rows.filter((r) => !taken.has(r.date));
  // Several festivals can share a date (Gandhi Jayanti and Dussehra in 2025); keep the first.
  const seen = new Set<string>();
  const data = fresh.filter((r) => !seen.has(r.date) && seen.add(r.date)).map((r) => ({ organizationId, name: r.name, date: dbDate(r.date), type: r.type }));
  await prisma.holiday.createMany({ data, skipDuplicates: true });
  return data.length;
}

// ─────────────── leave ───────────────

const LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', annualAllowance: 12, color: '#0ea5e9' },
  { code: 'SL', name: 'Sick leave', annualAllowance: 8, color: '#f43f5e' },
  { code: 'EL', name: 'Earned leave', annualAllowance: 15, color: '#10b981' },
  { code: 'UL', name: 'Unpaid leave', annualAllowance: 0, color: '#94a3b8', paid: false },
];

export async function seedLeaveTypes(organizationId: string) {
  const out: Record<string, { id: string; name: string }> = {};
  for (const t of LEAVE_TYPES) out[t.code] = await prisma.leaveType.upsert({ where: { organizationId_code: { organizationId, code: t.code } }, update: {}, create: { ...t, organizationId } });
  return out;
}

type LeaveStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED';
type HalfDay = 'NONE' | 'FIRST_HALF' | 'SECOND_HALF';
export type LeaveRow = { email: string; type: string; from: string; to: string; status: LeaveStatus; reason: string; halfDay: HalfDay; days: number; note?: string };

/** Hand-written rows (day offsets from today) so the demo logins always see the same story. */
const STORY: { email: string; type: string; from: number; to: number; status: LeaveStatus; reason: string; halfDay?: HalfDay; note?: string }[] = [
  { email: 'employee@futuristglobal.com', type: 'CL', from: -50, to: -50, status: 'CANCELLED', reason: 'Bank work — sorted it online' },
  { email: 'employee@futuristglobal.com', type: 'CL', from: -44, to: -44, status: 'REJECTED', reason: 'Long weekend', note: 'Release week — can we move it to the week after?' },
  { email: 'employee@futuristglobal.com', type: 'CL', from: -33, to: -33, status: 'APPROVED', reason: 'Doctor appointment in the morning', halfDay: 'FIRST_HALF' },
  { email: 'employee@futuristglobal.com', type: 'CL', from: -20, to: -20, status: 'APPROVED', reason: 'Family function' },
  { email: 'employee@futuristglobal.com', type: 'SL', from: -9, to: -8, status: 'APPROVED', reason: 'Fever' },
  { email: 'employee@futuristglobal.com', type: 'EL', from: 3, to: 7, status: 'APPROVED', reason: 'Family trip to Kerala' },
  { email: 'employee@futuristglobal.com', type: 'EL', from: 45, to: 47, status: 'PENDING', reason: 'Year-end break' },
  { email: 'vikram.rao@futuristglobal.com', type: 'CL', from: 4, to: 5, status: 'APPROVED', reason: 'House shifting' },
  { email: 'kabir.singh@futuristglobal.com', type: 'EL', from: 6, to: 8, status: 'PENDING', reason: 'Trip to Goa' },
  { email: 'neha.reddy@futuristglobal.com', type: 'SL', from: -2, to: 1, status: 'APPROVED', reason: 'Viral fever' },
  { email: 'meera.nair@futuristglobal.com', type: 'CL', from: 2, to: 2, status: 'PENDING', reason: 'Bank work' },
  { email: 'isha.gupta@futuristglobal.com', type: 'CL', from: 5, to: 6, status: 'APPROVED', reason: "Sister's wedding" },
  { email: 'manager@futuristglobal.com', type: 'EL', from: 10, to: 14, status: 'APPROVED', reason: 'Vacation' },
  { email: 'tara.joshi@futuristglobal.com', type: 'EL', from: 12, to: 16, status: 'APPROVED', reason: 'Vacation' },
  { email: 'hr@futuristglobal.com', type: 'EL', from: -6, to: -4, status: 'APPROVED', reason: 'Personal' },
  { email: 'arjun.patel@futuristglobal.com', type: 'CL', from: -3, to: -3, status: 'REJECTED', reason: 'Release week', note: 'We need you for the release. Please pick another day.' },
  { email: 'omkar.pawar@futuristglobal.com', type: 'SL', from: 0, to: 0, status: 'APPROVED', reason: 'Migraine', halfDay: 'SECOND_HALF' },
  { email: 'ritika.saxena@futuristglobal.com', type: 'EL', from: -1, to: 2, status: 'APPROVED', reason: 'Visiting parents in Lucknow' },
  { email: 'siddharth.agarwal@futuristglobal.com', type: 'CL', from: 9, to: 9, status: 'PENDING', reason: 'Child’s school annual day' },
  { email: 'pranav.hegde@futuristglobal.com', type: 'EL', from: 18, to: 22, status: 'PENDING', reason: 'Wedding in the family' },
  { email: 'yash.tiwari@futuristglobal.com', type: 'UL', from: 15, to: 15, status: 'PENDING', reason: 'University exam' },
];

const REASONS: Record<string, string[]> = {
  CL: ['Personal work', 'Bank and passport office', 'Family function', 'Moving house', 'Parent–teacher meeting', 'Car service and errands', 'Festival at home', 'Friend’s wedding'],
  SL: ['Fever', 'Cold and cough', 'Dentist', 'Back pain', 'Food poisoning', 'Migraine', 'Doctor’s appointment'],
  EL: ['Vacation', 'Trip to the hills', 'Visiting family', 'Wedding in the family', 'Long-planned holiday', 'Trek in Himachal'],
  UL: ['Extended travel', 'Personal reasons', 'Exam preparation'],
};
const REJECT_NOTES = ['Release week — can we move this by a week?', 'Two others from the team are already away then.', 'Quarter close; please pick a date after the 5th.', 'Customer go-live that week. Can we talk about other dates?'];

/**
 * A realistic year of leave: past requests mostly approved (some declined or cancelled), upcoming ones approved or
 * waiting, half days, overlapping absences in the same team, all within each type's annual allowance.
 * Skips anyone missing from the organization and never overlaps a person's own active leave.
 */
export function planLeave(ctx: SeedContext): LeaveRow[] {
  const r = rng(`leave:${ctx.today}`);
  const yearStart = `${ctx.today.slice(0, 4)}-01-01`;
  const used = new Map<string, number>(); // email:type:year → days approved or pending
  const busy = new Map<string, Set<string>>(); // email → dates with pending/approved leave
  const rows: LeaveRow[] = [];
  const allowance = Object.fromEntries(LEAVE_TYPES.map((t) => [t.code, t.annualAllowance]));

  const tryAdd = (row: Omit<LeaveRow, 'days'>) => {
    const p = personByEmail.get(row.email);
    if (!p || !ctx.users[row.email]) return false;
    const dates = row.halfDay === 'NONE' ? workingDaysIn(ctx, row.from, row.to) : isWorkingDay(ctx, row.from) ? [row.from] : [];
    if (!dates.length) return false;
    const days = row.halfDay === 'NONE' ? dates.length : 0.5;
    const set = busy.get(row.email) ?? new Set<string>();
    const active = row.status === 'APPROVED' || row.status === 'PENDING';
    if (active && dates.some((d) => set.has(d))) return false;
    const key = `${row.email}:${row.type}:${row.from.slice(0, 4)}`;
    if (active && allowance[row.type] > 0 && (used.get(key) ?? 0) + days > allowance[row.type]) return false;
    if (active) {
      used.set(key, (used.get(key) ?? 0) + days);
      dates.forEach((d) => set.add(d));
      busy.set(row.email, set);
    }
    rows.push({ ...row, days });
    return true;
  };

  for (const s of STORY) {
    // Move a story row off a weekend or holiday so it always counts at least one working day.
    let shift = 0;
    while (!workingDaysIn(ctx, addDays(ctx.today, s.from + shift), addDays(ctx.today, s.to + shift)).length) shift++;
    tryAdd({ email: s.email, type: s.type, from: addDays(ctx.today, s.from + shift), to: addDays(ctx.today, s.to + shift), status: s.status, reason: s.reason, halfDay: s.halfDay ?? 'NONE', note: s.note });
  }

  for (const p of PEOPLE) {
    // The demo employee's leave is the hand-written story above (the browser tests book leave three weeks ahead).
    if (p.email === 'employee@futuristglobal.com' || p.status === 'INVITED' || !ctx.users[p.email]) continue;
    const from = p.joined > yearStart ? p.joined : yearStart;
    const until = lastDay(ctx, p) ?? addDays(ctx.today, 75);
    if (from >= until) continue;
    const span = (Date.parse(until) - Date.parse(from)) / 86400_000;
    const wanted = Math.max(1, Math.round((span / 365) * r.int(5, 9)));
    for (let n = 0, attempts = 0; n < wanted && attempts < wanted * 6; attempts++) {
      const start = addDays(from, r.int(0, Math.floor(span)));
      const type = r.pick(['CL', 'CL', 'CL', 'SL', 'SL', 'EL', 'EL', 'UL'] as const);
      if (type === 'UL' && !r.chance(0.3)) continue;
      const past = start < ctx.today;
      if (type === 'SL' && !past) continue; // nobody books sick leave in advance
      const half: HalfDay = type !== 'EL' && r.chance(0.25) ? r.pick(['FIRST_HALF', 'SECOND_HALF'] as const) : 'NONE';
      const len = half !== 'NONE' ? 0 : type === 'EL' ? r.int(2, 6) : r.int(0, 1);
      const status: LeaveStatus = past
        ? r.pick(['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const)
        : r.pick(['APPROVED', 'APPROVED', 'PENDING', 'PENDING', 'CANCELLED'] as const);
      const ok = tryAdd({
        email: p.email,
        type,
        from: start,
        to: addDays(start, len),
        status,
        reason: r.pick(REASONS[type]),
        halfDay: half,
        note: status === 'REJECTED' ? r.pick(REJECT_NOTES) : undefined,
      });
      if (ok) n++;
    }
  }
  return rows;
}

export async function seedLeave(ctx: SeedContext, rows = planLeave(ctx)) {
  const lt = await seedLeaveTypes(ctx.organizationId);
  const r = rng(`leave-times:${ctx.today}`);
  const now = Date.now();
  const data: Prisma.LeaveRequestCreateManyInput[] = rows.map((l) => {
    const p = personByEmail.get(l.email)!;
    const approver = ctx.users[approverOf(p)]?.id ?? null;
    // Requested a few days to a few weeks before the leave (sick leave on the day), and decided a day or two later.
    const startMs = Date.parse(`${l.from}T09:00:00${TZ_OFFSET}`);
    const createdAt = new Date(Math.min(now - 3600_000, startMs - (l.type === 'SL' ? r.int(0, 1) : r.int(3, 25)) * 86400_000 + r.int(0, 8) * 3600_000));
    const decidedAt = new Date(Math.min(now - 600_000, createdAt.getTime() + r.int(2, 40) * 3600_000));
    const decided = l.status !== 'PENDING';
    return {
      organizationId: ctx.organizationId,
      userId: ctx.users[l.email].id,
      typeId: lt[l.type].id,
      startDate: dbDate(l.from),
      endDate: dbDate(l.to),
      halfDay: l.halfDay,
      days: l.days,
      reason: l.reason,
      status: l.status,
      approverId: decided && l.status !== 'CANCELLED' ? approver : null,
      decisionNote: l.note ?? null,
      decidedAt: decided ? decidedAt : null,
      createdAt,
      updatedAt: decided ? decidedAt : createdAt,
    };
  });
  await prisma.leaveRequest.createMany({ data });
  return rows;
}

// ─────────────── attendance ───────────────

type Missing = { email: string; date: string };

const CLIENT_SITES = ['At the Contoso office', 'Client workshop at Fabrikam', 'On site with Northwind', 'Customer visit in Bengaluru', 'Trade show booth'];

/**
 * 60 days of attendance history plus today, in the organization's time zone. Weekends, days off and approved
 * full-day leave are skipped; half days start late or end early; a few days are simply missing (some later become
 * correction requests). Night-shift people check in around 21:00 and out the next morning.
 */
export async function seedAttendance(ctx: SeedContext, leave: LeaveRow[], days = 60) {
  const r = rng(`attendance:${ctx.today}`);
  const onLeave = new Map<string, HalfDay>(); // email|date → half day
  for (const l of leave.filter((x) => x.status === 'APPROVED')) {
    for (let d = l.from; d <= l.to; d = addDays(d, 1)) onLeave.set(`${l.email}|${d}`, l.halfDay);
  }
  const records: Prisma.AttendanceRecordCreateManyInput[] = [];
  const breaks: { key: string; startAt: Date; endAt: Date | null; kind?: 'BREAK' | 'AWAY' }[] = [];
  const missing: Missing[] = [];
  const nowMs = Date.now();
  const nowMin = nowLocalMinutes();

  const addDay = (p: Person & { id: string }, ymd: string, isToday: boolean) => {
    const half = onLeave.get(`${p.email}|${ymd}`);
    if (half === 'NONE') return;
    const lateDay = r.chance(p.lateRate ?? 0.1);
    let location: 'WFO' | 'WFH' | 'ON_DUTY' = 'WFO';
    const roll = r.next();
    if (p.style === 'remote') location = roll < 0.9 ? 'WFH' : 'WFO';
    else if (p.style === 'hybrid') location = roll < 0.55 ? 'WFO' : 'WFH';
    else if (p.style === 'field') location = roll < 0.45 ? 'ON_DUTY' : roll < 0.85 ? 'WFO' : 'WFH';
    else location = roll < 0.92 ? 'WFO' : 'WFH';
    let remarks: string | null = location === 'ON_DUTY' ? r.pick(CLIENT_SITES) : null;

    let inMin: number;
    let outMin: number;
    if (p.night) {
      inMin = 20 * 60 + 45 + r.int(0, 40) + (lateDay ? r.int(15, 45) : 0);
      outMin = 24 * 60 + 5 * 60 + 45 + r.int(0, 45);
      remarks = 'Night shift (US support hours)';
    } else if (half === 'FIRST_HALF') {
      inMin = 13 * 60 + 30 + r.int(0, 30);
      outMin = 18 * 60 + 15 + r.int(0, 45);
      remarks = 'Half day: first half on leave';
    } else {
      inMin = lateDay ? LATE_AFTER + r.int(5, 70) : 9 * 60 + r.int(0, 40);
      outMin = half === 'SECOND_HALF' ? 13 * 60 + r.int(0, 30) : 18 * 60 + r.int(0, 75) - (r.chance(0.08) ? r.int(60, 120) : 0);
      if (half === 'SECOND_HALF') remarks = 'Half day: second half on leave';
    }
    const checkInAt = at(ymd, inMin);
    if (checkInAt.getTime() > nowMs) return; // has not started yet today
    const outAt = at(ymd, outMin);
    const closed = outAt.getTime() < nowMs - 5 * 60_000;
    const key = `${p.id}|${ymd}`;
    records.push({
      organizationId: ctx.organizationId,
      userId: p.id,
      date: dbDate(ymd),
      location,
      remarks,
      checkInAt,
      checkOutAt: closed ? outAt : null,
      checkOutRemarks: closed && outMin - inMin < 7 * 60 && !half ? 'Left early for an appointment' : null,
      late: inMin > LATE_AFTER,
      lastActiveAt: closed ? outAt : new Date(nowMs - r.int(1, 10) * 60_000),
      createdAt: checkInAt,
      updatedAt: closed ? outAt : checkInAt,
    });
    // Breaks that have already happened: lunch, sometimes tea, a meal break on the night shift.
    const lunchStart = p.night ? 24 * 60 + 60 + r.int(0, 30) : 13 * 60 + r.int(0, 25);
    const lunchLen = r.int(25, 50);
    if (inMin < lunchStart && outMin > lunchStart + lunchLen && at(ymd, lunchStart + lunchLen).getTime() < nowMs) {
      breaks.push({ key, startAt: at(ymd, lunchStart), endAt: at(ymd, lunchStart + lunchLen) });
    }
    const teaStart = p.night ? 24 * 60 + 3 * 60 + 30 : 16 * 60 + r.int(0, 30);
    if (r.chance(0.35) && inMin < teaStart && outMin > teaStart + 15 && at(ymd, teaStart + 15).getTime() < nowMs) {
      breaks.push({ key, startAt: at(ymd, teaStart), endAt: at(ymd, teaStart + r.int(8, 15)) });
    }
    if (isToday && !closed && ['lunch', 'short_break'].includes(p.presence ?? '')) breaks.push({ key, startAt: new Date(nowMs - 12 * 60_000), endAt: null });
  };

  // History: from `days` ago until yesterday.
  for (let back = days; back >= 1; back--) {
    const ymd = addDays(ctx.today, -back);
    for (const p of ctx.people) {
      if (!employed(ctx, p, ymd)) continue;
      const night = !!p.night;
      // Night shifts run Sunday to Thursday nights (Monday to Friday in US hours).
      if (night ? dow(ymd) === 5 || dow(ymd) === 6 || ctx.daysOff.has(ymd) : !isWorkingDay(ctx, ymd)) continue;
      if (!onLeave.has(`${p.email}|${ymd}`) && r.chance(0.025) && p.email !== 'employee@futuristglobal.com') {
        missing.push({ email: p.email, date: ymd });
        continue;
      }
      addDay(p, ymd, false);
    }
  }

  // Today: most people are in. employee@ checks in during the browser tests; Neha and Zara are not in yet.
  const notToday = new Set(['employee@futuristglobal.com', 'neha.reddy@futuristglobal.com', 'zara.khan@futuristglobal.com', ...r.sample(ctx.people.map((p) => p.email), 2)]);
  if (nowMin > 9 * 60 + 15) {
    for (const p of ctx.people) {
      if (notToday.has(p.email) || !employed(ctx, p, ctx.today)) continue;
      if (p.night ? dow(ctx.today) === 5 || dow(ctx.today) === 6 : !isWorkingDay(ctx, ctx.today)) continue;
      addDay(p, ctx.today, true);
    }
  }

  const created = await prisma.attendanceRecord.createManyAndReturn({ data: records, select: { id: true, userId: true, date: true } });
  const idOf = new Map(created.map((c) => [`${c.userId}|${c.date.toISOString().slice(0, 10)}`, c.id]));
  await prisma.attendanceBreak.createMany({ data: breaks.filter((b) => idOf.has(b.key)).map((b) => ({ recordId: idOf.get(b.key)!, startAt: b.startAt, endAt: b.endAt, kind: b.kind ?? 'BREAK' })) });
  return { records: created.length, breaks: breaks.length, missing };
}

// ─────────────── attendance corrections ───────────────

const CORRECTION_REASONS = [
  'Forgot to check in — was in the office from the morning',
  'Phone battery died, could not check in',
  'Was at a client site without network',
  'App was down for me in the morning',
  'Checked in on the wrong day by mistake',
  'Travelling for the customer workshop',
];

/**
 * Correction requests for some of the missing days: pending ones for managers to review, plus approved (applied to
 * attendance) and declined history. Also the original pending one for Vikram. Never for employee@ (the browser test files one).
 */
export async function seedCorrections(ctx: SeedContext, missing: Missing[]) {
  const r = rng(`corrections:${ctx.today}`);
  const rows: Prisma.AttendanceCorrectionCreateManyInput[] = [];
  const applied: Prisma.AttendanceRecordCreateManyInput[] = [];
  const yesterday = addDays(ctx.today, -1);
  if (ctx.users['vikram.rao@futuristglobal.com']) {
    rows.push({ organizationId: ctx.organizationId, userId: ctx.users['vikram.rao@futuristglobal.com'].id, date: dbDate(yesterday), checkIn: '09:20', checkOut: '18:40', location: 'WFO', reason: 'Forgot to check out — was in the office until 6:40 PM', createdAt: new Date(Date.now() - 5 * 3600_000) });
  }
  // Prefer a couple of Rohan's team for the pending list, then anyone.
  const pool = r.sample(
    // Not for night shifts: a correction holds same-day times, so a shift that ends the next morning cannot be expressed.
    missing.filter((m) => m.email !== 'employee@futuristglobal.com' && m.email !== 'vikram.rao@futuristglobal.com' && !personByEmail.get(m.email)?.night && m.date >= addDays(ctx.today, -30)),
    missing.length,
  );
  pool.sort((a, b) => Number(personByEmail.get(b.email)?.manager === 'manager@futuristglobal.com') - Number(personByEmail.get(a.email)?.manager === 'manager@futuristglobal.com'));
  const statuses: ('PENDING' | 'APPROVED' | 'REJECTED')[] = ['PENDING', 'PENDING', 'PENDING', 'PENDING', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'REJECTED', 'REJECTED'];
  const usedKeys = new Set<string>();
  for (const [i, status] of statuses.entries()) {
    const m = pool[i];
    if (!m || usedKeys.has(`${m.email}|${m.date}`)) continue;
    usedKeys.add(`${m.email}|${m.date}`);
    const p = personByEmail.get(m.email)!;
    const userId = ctx.users[m.email].id;
    const inMin = p.night ? 21 * 60 + r.int(0, 20) : 9 * 60 + r.int(0, 35);
    const outMin = p.night ? 6 * 60 + r.int(0, 20) : 18 * 60 + r.int(0, 50);
    const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const location = p.style === 'remote' ? 'WFH' : p.style === 'field' ? 'ON_DUTY' : 'WFO';
    const reason = r.pick(CORRECTION_REASONS);
    const createdAt = new Date(Date.parse(`${m.date}T20:00:00${TZ_OFFSET}`) + r.int(0, 2) * 86400_000);
    const decidedAt = new Date(Math.min(Date.now() - 3600_000, createdAt.getTime() + r.int(4, 30) * 3600_000));
    const reviewer = ctx.users[approverOf(p)]?.id ?? null;
    rows.push({
      organizationId: ctx.organizationId,
      userId,
      date: dbDate(m.date),
      checkIn: hhmm(inMin),
      checkOut: p.night ? null : hhmm(outMin),
      location,
      reason,
      status,
      reviewerId: status === 'PENDING' ? null : reviewer,
      reviewNote: status === 'REJECTED' ? r.pick(['Badge logs show no entry that day.', 'Please apply leave for this day instead.']) : null,
      decidedAt: status === 'PENDING' ? null : decidedAt,
      createdAt: status === 'PENDING' ? new Date(Math.min(Date.now() - 3600_000, createdAt.getTime())) : createdAt,
    });
    if (status === 'APPROVED') {
      // Approving a correction writes the attendance day (as the API does).
      applied.push({ organizationId: ctx.organizationId, userId, date: dbDate(m.date), location, checkInAt: at(m.date, inMin), checkOutAt: p.night ? null : at(m.date, outMin), late: inMin > LATE_AFTER, remarks: `Corrected: ${reason}`.slice(0, 200), createdAt: decidedAt, updatedAt: decidedAt });
    }
  }
  await prisma.attendanceCorrection.createMany({ data: rows });
  await prisma.attendanceRecord.createMany({ data: applied, skipDuplicates: true });
  return rows.length;
}

// ─────────────── announcements ───────────────

export async function seedAnnouncements(ctx: SeedContext, depts: Ids) {
  const r = rng(`announcements:${ctx.today}`);
  let count = 0;
  let acks = 0;
  for (const a of ANNOUNCEMENTS) {
    if (!ctx.users[a.author] || (a.dept && !depts[a.dept])) continue;
    const publishedAt = new Date(Date.now() - a.hoursAgo * 3600_000);
    const created = await prisma.announcement.create({
      data: {
        organizationId: ctx.organizationId,
        authorId: ctx.users[a.author].id,
        departmentId: a.dept ? depts[a.dept].id : null,
        title: a.title,
        body: a.body,
        category: a.category,
        priority: a.priority ?? 'NORMAL',
        pinned: a.pinned ?? false,
        requireAck: a.requireAck ?? false,
        publishedAt,
        expiresAt: a.expiresInHours !== undefined ? new Date(Date.now() + a.expiresInHours * 3600_000) : null,
        createdAt: publishedAt,
      },
    });
    count++;
    if (a.requireAck && a.ackShare) {
      // Partial confirmations from the audience who were here when it was published. employee@ has not confirmed the
      // insurance one (they have a "please read" notification for it).
      const audience = ctx.people.filter((p) => p.status !== 'INVITED' && p.joined <= ymdIn(publishedAt) && (!a.dept || p.dept === a.dept) && p.email !== a.author);
      const ackers = audience.filter((p) => !(a.title.startsWith('Health insurance') && p.email === 'employee@futuristglobal.com') && r.chance(a.ackShare!));
      await prisma.announcementAck.createMany({
        data: ackers.map((p) => ({ announcementId: created.id, userId: p.id, createdAt: new Date(publishedAt.getTime() + r.int(10, Math.max(20, a.hoursAgo * 50)) * 60_000) })),
      });
      acks += ackers.length;
    }
  }
  return { count, acks };
}

// ─────────────── chat ───────────────

const FORBIDDEN = /general|Rohan Verma|Ananya Iyer/i;

/** Channels, history with threads and reactions, the recent conversations and direct/group messages. */
export async function seedChat(ctx: SeedContext) {
  const r = rng(`chat:${ctx.today}`);
  const now = Date.now();
  const admin = ctx.users['admin@futuristglobal.com']?.id ?? null;
  const active = (p: Person) => p.status !== 'INVITED';
  let messages = 0;
  let reactions = 0;
  let channels = 0;
  const reactionRows: { messageId: string; userId: string; emoji: string; createdAt: Date }[] = [];

  /** Working-hours timestamp `daysAgo` days back (skipping weekends), at a random local time. */
  const workTime = (daysAgo: number) => {
    let ymd = addDays(ctx.today, -daysAgo);
    while (dow(ymd) === 0 || dow(ymd) === 6) ymd = addDays(ymd, -1);
    return at(ymd, 9 * 60 + 30 + r.int(0, 8 * 60 + 30));
  };
  const react = (messageId: string, authorId: string | null, pool: string[], createdAt: Date) => {
    if (!r.chance(0.35)) return;
    const who = r.sample(pool.filter((id) => id !== authorId), r.int(1, 4));
    const emoji = r.pick(REACTION_KEYS);
    for (const userId of who) reactionRows.push({ messageId, userId, emoji: r.chance(0.8) ? emoji : r.pick(REACTION_KEYS), createdAt: new Date(Math.min(now, createdAt.getTime() + r.int(1, 90) * 60_000)) });
  };

  for (const [ci, def] of CHANNELS.entries()) {
    const members = ctx.people.filter((p) => active(p) && def.members(p, PEOPLE.findIndex((x) => x.email === p.email)));
    if (!members.length) continue;
    const memberIds = members.map((m) => m.id);
    // Authors must be able to post: deactivated people only wrote before they left.
    const archivedAt = def.archivedDaysAgo ? new Date(now - def.archivedDaysAgo * 86400_000) : null;
    const ch = await prisma.channel.create({
      data: {
        organizationId: ctx.organizationId,
        type: def.type,
        name: def.name,
        description: def.description,
        topic: def.topic ?? null,
        isDefault: def.isDefault ?? false,
        createdById: def.type === 'PRIVATE' ? members[0].id : admin,
        archivedAt,
        createdAt: new Date(now - (90 + ci) * 86400_000),
        members: {
          create: members.map((m) => ({ userId: m.id, role: m.id === admin || (def.type === 'PRIVATE' && m.id === members[0].id) ? 'ADMIN' : 'MEMBER', joinedAt: new Date(Math.max(Date.parse(m.joined), now - 90 * 86400_000)), lastReadAt: new Date(now - r.int(2, 30) * 3600_000) })),
        },
      },
    });
    channels++;

    // Older history: spread over the last ~4 weeks (or before archiving).
    const lines = HISTORY[def.name] ?? [];
    const top: Prisma.MessageCreateManyInput[] = [];
    const minDays = def.archivedDaysAgo ? def.archivedDaysAgo + 1 : 1;
    lines.forEach((body, i) => {
      if (FORBIDDEN.test(body)) throw new Error(`Seed message would break the browser tests: ${body}`);
      const daysAgo = minDays + Math.round(((lines.length - i) / lines.length) * 26) + r.int(0, 1);
      const createdAt = workTime(daysAgo);
      const eligible = members.filter((m) => employed(ctx, m, ymdIn(createdAt)) && m.joined <= ymdIn(createdAt));
      const author = r.pick(eligible.length ? eligible : members);
      top.push({ organizationId: ctx.organizationId, channelId: ch.id, authorId: author.id, body, createdAt });
    });
    for (const [email, body, minutes] of RECENT[def.name] ?? []) {
      if (!ctx.users[email]) continue;
      top.push({ organizationId: ctx.organizationId, channelId: ch.id, authorId: ctx.users[email].id, body, createdAt: new Date(now - minutes * 60_000) });
    }
    if (!top.length) continue;
    const created = await prisma.message.createManyAndReturn({ data: top, select: { id: true, authorId: true, createdAt: true, body: true } });
    messages += created.length;

    // Threads on about a quarter of the history, reactions here and there.
    const replies: Prisma.MessageCreateManyInput[] = [];
    for (const m of created) {
      const recent = now - m.createdAt.getTime() < 6 * 3600_000;
      // The original seed's reactions on these two messages.
      if (m.body.includes('Kudos') || m.body.includes('Staging deploy')) {
        const reactors = memberIds.filter((id) => id !== m.authorId).slice(0, 4);
        reactors.forEach((userId, i) => reactionRows.push({ messageId: m.id, userId, emoji: i % 2 ? 'party' : 'thumbs-up', createdAt: new Date(m.createdAt.getTime() + 60_000 * (i + 1)) }));
      } else {
        react(m.id, m.authorId, memberIds, m.createdAt);
      }
      if (recent || !r.chance(0.28)) continue;
      const parentAuthor = ctx.people.find((p) => p.id === m.authorId);
      const n = r.int(1, 4);
      for (let k = 0; k < n; k++) {
        const repliers = members.filter((x) => employed(ctx, x, ymdIn(m.createdAt)));
        const author = r.pick(repliers.length ? repliers : members);
        const body = r.pick(REPLIES).replace('{name}', parentAuthor?.first ?? 'there');
        const at2 = new Date(Math.min(now - 60_000, m.createdAt.getTime() + (k + 1) * r.int(4, 90) * 60_000));
        replies.push({ organizationId: ctx.organizationId, channelId: ch.id, authorId: author.id, body, parentId: m.id, createdAt: at2 });
      }
    }
    if (replies.length) {
      const made = await prisma.message.createManyAndReturn({ data: replies, select: { id: true, authorId: true, createdAt: true } });
      messages += made.length;
      for (const m of made) if (r.chance(0.3)) react(m.id, m.authorId, memberIds, m.createdAt);
    }
    const last = created.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    await prisma.channel.update({ where: { id: ch.id }, data: { lastMessageAt: last.createdAt } });
    // People have read the channels they posted in recently; the admin is caught up everywhere.
    if (admin) await prisma.channelMember.updateMany({ where: { channelId: ch.id, userId: admin }, data: { lastReadAt: new Date() } });
  }

  // Direct and group messages.
  for (const dm of DIRECT) {
    const ids = dm.people.map((e) => ctx.users[e]?.id);
    if (ids.some((id) => !id)) continue;
    const sorted = [...(ids as string[])].sort();
    const ch = await prisma.channel.create({
      data: {
        organizationId: ctx.organizationId,
        type: 'DIRECT',
        directKey: sorted.join(':'),
        createdById: ids[0],
        members: { create: sorted.map((userId) => ({ userId, lastReadAt: new Date(now - 600 * 60_000) })) },
      },
    });
    channels++;
    const data = dm.lines.map(([who, body], i) => {
      if (FORBIDDEN.test(body)) throw new Error(`Seed message would break the browser tests: ${body}`);
      return { organizationId: ctx.organizationId, channelId: ch.id, authorId: ids[who]!, body, createdAt: new Date(now - (dm.minutesAgo + (dm.lines.length - 1 - i) * r.int(2, 6)) * 60_000) };
    });
    const made = await prisma.message.createManyAndReturn({ data, select: { id: true, authorId: true, createdAt: true } });
    messages += made.length;
    for (const m of made) if (r.chance(0.2)) react(m.id, m.authorId, ids as string[], m.createdAt);
    await prisma.channel.update({ where: { id: ch.id }, data: { lastMessageAt: made[made.length - 1].createdAt } });
    // Whoever wrote last has read it.
    await prisma.channelMember.updateMany({ where: { channelId: ch.id, userId: made[made.length - 1].authorId! }, data: { lastReadAt: new Date() } });
  }

  // Reactions: one per (message, person, emoji).
  const seen = new Set<string>();
  const unique = reactionRows.filter((x) => !seen.has(`${x.messageId}|${x.userId}|${x.emoji}`) && seen.add(`${x.messageId}|${x.userId}|${x.emoji}`));
  await prisma.messageReaction.createMany({ data: unique, skipDuplicates: true });
  reactions = unique.length;
  return { channels, messages, reactions };
}

// ─────────────── notifications ───────────────

/**
 * Inbox items that match the data: leave and correction requests waiting for each approver, decisions people
 * received, mentions, and the demo employee's unread pair from the original seed.
 */
export async function seedNotifications(ctx: SeedContext) {
  const r = rng(`notifications:${ctx.today}`);
  const { organizationId, users } = ctx;
  const rows: Prisma.NotificationCreateManyInput[] = [];
  const now = Date.now();
  const emp = users['employee@futuristglobal.com'];
  const general = await prisma.channel.findFirst({ where: { organizationId, name: 'general' } });
  if (emp && general && users['manager@futuristglobal.com'] && users['hr@futuristglobal.com']) {
    rows.push(
      { organizationId, userId: emp.id, actorId: users['manager@futuristglobal.com'].id, type: 'mention', title: 'Rohan Verma mentioned you in #general', body: 'Kudos to @Ananya for shipping the new onboarding flow ahead of schedule.', link: `/app/chat/${general.id}`, createdAt: new Date(now - 40 * 60_000) },
      { organizationId, userId: emp.id, actorId: users['hr@futuristglobal.com'].id, type: 'announcement', title: 'Please read: Health insurance top-up enrolment', body: 'Open enrolment for the optional family health insurance top-up closes on the 15th.', link: '/app/announcements', createdAt: new Date(now - 86400_000) },
    );
  }

  const leave = await prisma.leaveRequest.findMany({ where: { organizationId }, include: { type: true, user: true } });
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  for (const l of leave) {
    const p = personByEmail.get(l.user.email);
    if (!p) continue;
    const approver = users[approverOf(p)];
    const span = `${ymd(l.startDate)}${l.endDate.getTime() !== l.startDate.getTime() ? ` to ${ymd(l.endDate)}` : ''}`;
    const fresh = now - l.createdAt.getTime() < 21 * 86400_000;
    if (approver && fresh) {
      rows.push({
        organizationId,
        userId: approver.id,
        actorId: l.userId,
        type: 'leave',
        title: `${l.user.firstName} ${l.user.lastName} requested ${l.days} day${l.days === 1 ? '' : 's'} of ${l.type.name}`,
        body: `${span}${l.reason ? ` · ${l.reason}` : ''}`,
        link: '/app/approvals',
        createdAt: l.createdAt,
        readAt: l.status === 'PENDING' ? null : l.decidedAt,
      });
    }
    if ((l.status === 'APPROVED' || l.status === 'REJECTED') && l.decidedAt && now - l.decidedAt.getTime() < 21 * 86400_000) {
      rows.push({
        organizationId,
        userId: l.userId,
        actorId: l.approverId,
        type: 'leave',
        title: `Your ${l.type.name} (${span}) was ${l.status === 'APPROVED' ? 'approved' : 'declined'}`,
        body: l.decisionNote,
        link: '/app/leave',
        createdAt: l.decidedAt,
        readAt: r.chance(0.7) ? new Date(l.decidedAt.getTime() + 3600_000) : null,
      });
    }
  }

  const corrections = await prisma.attendanceCorrection.findMany({ where: { organizationId }, include: { user: true } });
  for (const c of corrections) {
    const p = personByEmail.get(c.user.email);
    const approver = p && users[approverOf(p)];
    if (!approver) continue;
    rows.push({ organizationId, userId: approver.id, actorId: c.userId, type: 'correction', title: `${c.user.firstName} ${c.user.lastName} asked to correct attendance for ${ymd(c.date)}`, body: c.reason, link: '/app/approvals', createdAt: c.createdAt, readAt: c.status === 'PENDING' ? null : c.decidedAt });
    if (c.status !== 'PENDING' && c.decidedAt) {
      rows.push({ organizationId, userId: c.userId, actorId: c.reviewerId, type: 'correction', title: `Your attendance correction for ${ymd(c.date)} was ${c.status === 'APPROVED' ? 'approved' : 'declined'}`, body: c.reviewNote, link: '/app/attendance', createdAt: c.decidedAt, readAt: new Date(c.decidedAt.getTime() + 2 * 3600_000) });
    }
  }

  // Thread replies → the parent author (read, except the last few days).
  const replies = await prisma.message.findMany({
    where: { organizationId, parentId: { not: null }, createdAt: { gte: new Date(now - 10 * 86400_000) } },
    include: { parent: { select: { authorId: true } }, author: { select: { firstName: true, lastName: true } }, channel: { select: { id: true, name: true, type: true } } },
    take: 60,
    orderBy: { createdAt: 'desc' },
  });
  for (const m of replies) {
    if (!m.parent?.authorId || m.parent.authorId === m.authorId || !m.author) continue;
    rows.push({
      organizationId,
      userId: m.parent.authorId,
      actorId: m.authorId,
      type: 'thread',
      title: `${m.author.firstName} ${m.author.lastName} replied to your message in ${m.channel.type === 'DIRECT' ? 'a direct message' : `#${m.channel.name}`}`,
      body: m.body.slice(0, 160),
      link: `/app/chat/${m.channelId}?thread=${m.parentId}`,
      groupKey: `thread:${m.parentId}`,
      createdAt: m.createdAt,
      readAt: now - m.createdAt.getTime() > 2 * 86400_000 ? new Date(m.createdAt.getTime() + 3600_000) : null,
    });
  }
  // Mentions in channel history.
  const mentions = await prisma.message.findMany({ where: { organizationId, body: { contains: '@' }, channel: { type: { not: 'DIRECT' } } }, include: { author: true, channel: true } });
  for (const m of mentions) {
    for (const token of m.body.match(/@([A-Za-z][\w.-]*)/g) ?? []) {
      const who = ctx.people.find((p) => p.first.toLowerCase() === token.slice(1).toLowerCase() && p.status !== 'INVITED');
      if (!who || who.id === m.authorId || !m.author || who.email === 'employee@futuristglobal.com') continue;
      rows.push({ organizationId, userId: who.id, actorId: m.authorId, type: 'mention', title: `${m.author.firstName} ${m.author.lastName} mentioned you in #${m.channel.name}`, body: m.body.slice(0, 160), link: `/app/chat/${m.channelId}`, createdAt: m.createdAt, readAt: now - m.createdAt.getTime() > 86400_000 ? new Date(m.createdAt.getTime() + 1800_000) : null });
    }
  }
  // Recent announcements → a few people who have not confirmed yet.
  const anns = await prisma.announcement.findMany({ where: { organizationId, requireAck: true, publishedAt: { gte: new Date(now - 10 * 86400_000) } }, include: { acks: true } });
  for (const a of anns) {
    if (a.title.startsWith('Health insurance')) continue; // employee@'s copy is above
    const acked = new Set(a.acks.map((x) => x.userId));
    for (const p of ctx.people.filter((x) => x.status !== 'INVITED' && !acked.has(x.id) && x.id !== a.authorId && x.email !== 'employee@futuristglobal.com').slice(0, 12)) {
      rows.push({ organizationId, userId: p.id, actorId: a.authorId, type: 'announcement', title: `Please read: ${a.title}`, body: a.body.slice(0, 160), link: `/app/announcements?open=${a.id}`, createdAt: a.publishedAt });
    }
  }
  await prisma.notification.createMany({ data: rows.map((x) => ({ ...x, updatedAt: x.createdAt })) });
  return rows.length;
}

// ─────────────── audit history ───────────────

/** A short audit trail so the admin audit page has realistic history: accounts created, deactivated and suspended. */
async function seedAudit(ctx: SeedContext) {
  const hr = ctx.users['hr@futuristglobal.com']?.id ?? null;
  const rows: Prisma.AuditLogCreateManyInput[] = [];
  for (const p of ctx.people) {
    if (p.joined >= addDays(ctx.today, -90)) rows.push({ organizationId: ctx.organizationId, actorId: hr, action: 'employee.created', entityType: 'user', entityId: p.id, metadata: { email: p.email, role: p.role }, createdAt: new Date(Date.parse(`${p.joined}T10:30:00${TZ_OFFSET}`) - 3 * 86400_000) });
    if (p.status === 'DEACTIVATED') rows.push({ organizationId: ctx.organizationId, actorId: hr, action: 'employee.deactivated', entityType: 'user', entityId: p.id, metadata: {}, createdAt: new Date(Date.now() - (p.statusDaysAgo ?? 0) * 86400_000) });
    if (p.status === 'SUSPENDED') rows.push({ organizationId: ctx.organizationId, actorId: hr, action: 'employee.updated', entityType: 'user', entityId: p.id, metadata: { fields: ['status'], status: 'SUSPENDED' }, createdAt: new Date(Date.now() - (p.statusDaysAgo ?? 0) * 86400_000) });
  }
  await prisma.auditLog.createMany({ data: rows });
  return rows.length;
}

// ─────────────── organization ───────────────

/**
 * Work hub demo: two projects and personal tasks, dated relative to today so the planner always has
 * something to say. Ananya (employee@) carries three large tasks while Kabir has small ones, so
 * Team load proposes a handover, and one "more time" request is waiting for the manager.
 */
async function seedWork(ctx: SeedContext) {
  const id = (email: string) => ctx.users[`${email}@futuristglobal.com`]!.id;
  const day = (n: number) => new Date(`${addDays(ctx.today, n)}T00:00:00.000Z`);
  const ago = (days: number, hour = 11) => new Date(Date.now() - days * 86400_000 - (new Date().getHours() - hour) * 3600_000);
  type T = { title: string; who?: string; size?: 'XS' | 'S' | 'M' | 'L' | 'XL'; status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'; kind?: 'TASK' | 'BUG' | 'ENHANCEMENT'; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; due?: number; start?: number; doneAgo?: number; description?: string; links?: { label: string; url: string }[]; comments?: [string, string][] };
  const projects: { key: string; name: string; description: string; color: string; lead: string; members: string[]; target: number; tasks: T[] }[] = [
    {
      key: 'FG',
      name: 'FG One web app',
      description: 'The internal workspace: chat, attendance, leave and the new Work hub.',
      color: '#6366F1',
      lead: 'manager',
      members: ['employee', 'kabir.singh', 'meera.nair', 'vikram.rao', 'nisha.arora'],
      target: 45,
      tasks: [
        { title: 'Rich message composer', who: 'employee', size: 'L', status: 'IN_PROGRESS', kind: 'ENHANCEMENT', priority: 'HIGH', due: 6, start: -3, description: 'Bold, lists and inline code in the chat composer. Keep Enter-to-send working.', links: [{ label: 'Pull request', url: 'https://github.com/futurist-global/fg-one/pull/41' }], comments: [['manager', 'Keep the first version small: bold, italic, lists.'], ['employee', 'Agreed. Code blocks can follow in a second pull request.']] },
        { title: 'Link previews in chat', who: 'employee', size: 'L', kind: 'ENHANCEMENT', due: 9, description: 'Fetch titles and images on the server so private addresses can never be reached.' },
        { title: 'Notification settings redesign', who: 'employee', size: 'L', due: 11 },
        { title: 'Unread count is wrong after reconnect', who: 'kabir.singh', size: 'S', kind: 'BUG', priority: 'URGENT', status: 'IN_PROGRESS', due: 1, links: [{ label: 'Pull request', url: 'https://github.com/futurist-global/fg-one/pull/44' }] },
        { title: 'Add request ids to API logs', who: 'kabir.singh', size: 'XS', due: 4 },
        { title: 'Tidy seed script output', who: 'kabir.singh', size: 'XS', priority: 'LOW', due: 8 },
        { title: 'Build Docker images in CI', who: 'meera.nair', size: 'M', status: 'IN_REVIEW', due: 2, links: [{ label: 'Pull request', url: 'https://github.com/futurist-global/fg-one/pull/39' }] },
        { title: 'Move presence to Redis', who: 'meera.nair', size: 'L', due: 14, description: 'Presence resets when the API restarts. Use the Socket.IO Redis adapter.' },
        { title: 'Attendance export times are off by one hour', who: 'vikram.rao', size: 'S', kind: 'BUG', priority: 'HIGH', due: -1 },
        { title: 'Roles editor screens', who: 'nisha.arora', size: 'XL', kind: 'ENHANCEMENT', status: 'IN_PROGRESS', due: 20, start: -5 },
        { title: 'Keyboard shortcuts help', size: 'S', kind: 'ENHANCEMENT' },
        { title: 'Dark mode contrast pass', who: 'nisha.arora', size: 'M', status: 'BACKLOG', priority: 'LOW' },
        { title: 'Calendar module: first sketch', size: 'L', status: 'BACKLOG', kind: 'ENHANCEMENT' },
        { title: 'Two-step verification screens', who: 'employee', size: 'M', status: 'DONE', doneAgo: 0, due: 0 },
        { title: 'Leave calendar on phones', who: 'vikram.rao', size: 'M', status: 'DONE', doneAgo: 1, due: -1, kind: 'BUG' },
        { title: 'Session list in settings', who: 'kabir.singh', size: 'S', status: 'DONE', doneAgo: 3, due: -2 },
      ],
    },
    {
      key: 'MOB',
      name: 'Mobile app',
      description: 'Check-in, leave and chat on phones.',
      color: '#10B981',
      lead: 'siddharth.agarwal',
      members: ['neha.reddy', 'vikram.rao', 'omkar.pawar'],
      target: 75,
      tasks: [
        { title: 'Check in from the phone', who: 'neha.reddy', size: 'L', status: 'IN_PROGRESS', kind: 'ENHANCEMENT', priority: 'HIGH', due: 12, start: -2 },
        { title: 'Push notifications', who: 'neha.reddy', size: 'L', due: 25 },
        { title: 'Release pipeline for test builds', who: 'omkar.pawar', size: 'M', due: 7 },
        { title: 'Offline message queue', who: 'vikram.rao', size: 'L', kind: 'ENHANCEMENT', due: 18 },
        { title: 'App icon and splash screen', size: 'S' },
      ],
    },
  ];
  let tasks = 0;
  let moreTimeTask: { id: string; dueDate: Date | null } | null = null;
  for (const p of projects) {
    const memberIds = [...new Set([p.lead, ...p.members])].map(id);
    const project = await prisma.project.create({
      data: { organizationId: ctx.organizationId, key: p.key, name: p.name, description: p.description, color: p.color, leadId: id(p.lead), createdById: id(p.lead), startDate: day(-30), targetDate: day(p.target), taskSeq: p.tasks.length, members: { create: memberIds.map((userId) => ({ userId })) } },
    });
    for (const [i, t] of p.tasks.entries()) {
      const status = t.status ?? 'TODO';
      const createdAt = ago(14 - Math.min(i, 10));
      const task = await prisma.task.create({
        data: {
          organizationId: ctx.organizationId, projectId: project.id, number: i + 1, title: t.title, description: t.description ?? null, kind: t.kind ?? 'TASK', status, priority: t.priority ?? 'MEDIUM', size: t.size ?? 'M',
          assigneeId: t.who ? id(t.who) : null, createdById: id(p.lead), startDate: t.start !== undefined ? day(t.start) : null, dueDate: t.due !== undefined ? day(t.due) : null,
          completedAt: status === 'DONE' ? ago(t.doneAgo ?? 0) : null, position: i + 1, links: t.links ?? [], createdAt,
          activity: {
            create: [
              { organizationId: ctx.organizationId, actorId: id(p.lead), kind: 'created', data: { status: 'TODO' }, createdAt },
              ...(status === 'IN_PROGRESS' || status === 'IN_REVIEW' || status === 'DONE' ? [{ organizationId: ctx.organizationId, actorId: t.who ? id(t.who) : id(p.lead), kind: 'status', data: { from: 'TODO', to: 'IN_PROGRESS' }, createdAt: ago(status === 'DONE' ? (t.doneAgo ?? 0) + 2 : i % 2, 10) }] : []),
              ...(status === 'IN_REVIEW' ? [{ organizationId: ctx.organizationId, actorId: id(t.who!), kind: 'status', data: { from: 'IN_PROGRESS', to: 'IN_REVIEW' }, createdAt: ago(0, 9) }] : []),
              ...(status === 'DONE' ? [{ organizationId: ctx.organizationId, actorId: id(t.who!), kind: 'status', data: { from: 'IN_PROGRESS', to: 'DONE' }, createdAt: ago(t.doneAgo ?? 0) }] : []),
            ],
          },
          comments: { create: (t.comments ?? []).map(([who, body], n) => ({ organizationId: ctx.organizationId, authorId: id(who), body, createdAt: ago(2 - n) })) },
        },
      });
      tasks++;
      if (t.title === 'Link previews in chat') moreTimeTask = task;
    }
  }
  // Personal tasks: seen by their owner and the owner's manager.
  const personal: (T & { who: string; by?: string })[] = [
    { title: 'Prepare the sprint demo', who: 'employee', size: 'S', due: 2, by: 'manager' },
    { title: 'Renew AWS certification', who: 'employee', size: 'M', status: 'BACKLOG' },
    { title: 'Write the quarterly engineering update', who: 'manager', size: 'M', due: 5 },
    { title: 'Interview: frontend engineer', who: 'manager', size: 'XS', due: 1, priority: 'HIGH' },
    { title: 'Read the security handbook', who: 'kabir.singh', size: 'XS', by: 'manager' },
  ];
  for (const [i, t] of personal.entries()) {
    await prisma.task.create({
      data: { organizationId: ctx.organizationId, title: t.title, status: t.status ?? 'TODO', priority: t.priority ?? 'MEDIUM', size: t.size ?? 'M', assigneeId: id(t.who), createdById: id(t.by ?? t.who), dueDate: t.due !== undefined ? day(t.due) : null, position: 100 + i, activity: { create: [{ organizationId: ctx.organizationId, actorId: id(t.by ?? t.who), kind: 'created', data: { status: 'TODO' } }] } },
    });
    tasks++;
  }
  // Ananya has more than fits and has asked for a later date; Rohan (her lead) has not decided yet.
  let requests = 0;
  if (moreTimeTask) {
    await prisma.workRequest.create({
      data: {
        organizationId: ctx.organizationId, taskId: moreTimeTask.id, requesterId: id('employee'), kind: 'MOVE_DATE', reason: 'The composer is taking longer than planned and I am on leave next week.',
        previousDueDate: moreTimeTask.dueDate, proposedDueDate: day(16), rationale: 'More work is due in the next two weeks than there are working days available. At the current pace this task finishes after its due date.', createdAt: ago(0, 10),
      },
    });
    await prisma.taskActivity.create({ data: { organizationId: ctx.organizationId, taskId: moreTimeTask.id, actorId: id('employee'), kind: 'request', data: { kind: 'MOVE_DATE', to: addDays(ctx.today, 16) }, createdAt: ago(0, 10) } });
    requests = 1;
  }
  return { projects: projects.length, tasks, workRequests: requests };
}

async function seedOrg(opts: { name: string; slug: string; domain: string; password: string; minimal?: boolean }) {
  await prisma.organization.deleteMany({ where: { slug: opts.slug } });
  const settings = organizationSettingsSchema.parse({ auth: { allowedEmailDomains: [opts.domain] } });
  const org = await prisma.organization.create({
    data: { name: opts.name, slug: opts.slug, primaryColor: '#6366F1', secondaryColor: '#8B5CF6', settings },
  });

  const roles: Ids = {};
  for (const r of DEFAULT_ROLE_DEFINITIONS) {
    roles[r.key] = await prisma.role.create({ data: { organizationId: org.id, key: r.key, name: r.name, description: r.description, grants: { create: DEFAULT_ROLE_GRANTS[r.key] }, rank: r.rank, isSystem: true } });
  }
  const passwordHash = await hash(opts.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  if (opts.minimal) {
    await prisma.user.create({
      data: { organizationId: org.id, email: `admin@${opts.domain}`, firstName: 'Other', lastName: 'Admin', roleId: roles.administrator.id, isSuperAdmin: true, status: 'ACTIVE', passwordHash },
    });
    return { org };
  }

  const depts: Ids = {};
  for (const d of DEPARTMENTS) depts[d.name] = await prisma.department.create({ data: { ...d, organizationId: org.id } });

  const r = rng('people');
  const now = Date.now();
  const created = await prisma.user.createManyAndReturn({
    data: PEOPLE.map((p, i) => ({
      organizationId: org.id,
      email: p.email,
      firstName: p.first,
      lastName: p.last,
      designation: p.title,
      roleId: roles[p.role].id,
      isSuperAdmin: p.superAdmin === true,
      departmentId: depts[p.dept].id,
      joinedAt: new Date(`${p.joined}T00:00:00Z`),
      birthday: p.birthday ? new Date(`${p.birthday}T00:00:00Z`) : null,
      employeeCode: `FG${1001 + i}`,
      avatarColor: p.color,
      status: p.status ?? 'ACTIVE',
      deactivatedAt: p.status === 'DEACTIVATED' ? new Date(now - (p.statusDaysAgo ?? 0) * 86400_000) : null,
      suspendedAt: p.status === 'SUSPENDED' ? new Date(now - (p.statusDaysAgo ?? 0) * 86400_000) : null,
      suspensionReason: p.status === 'SUSPENDED' ? 'Pending a policy review' : null,
      passwordHash,
      presence: p.status ? 'offline' : (p.presence ?? 'available'),
      statusText: p.status ? null : (p.statusText ?? null),
      phone: p.phone ?? `+91 98${String(100 + i * 7).padStart(3, '0')} ${String(40000 + i * 1373).slice(0, 5)}`,
      pronouns: p.pronouns ?? null,
      lastLoginAt: p.status ? new Date(now - ((p.statusDaysAgo ?? 0) + 1) * 86400_000) : new Date(now - r.int(5, 60 * 24) * 60_000),
      createdAt: new Date(Math.min(now, Date.parse(`${p.joined}T00:00:00Z`) - 3 * 86400_000)),
    })),
    select: { id: true, email: true },
  });
  const users: Ids = Object.fromEntries(created.map((u) => [u.email, { id: u.id }]));
  for (const p of PEOPLE) if (p.manager) await prisma.user.update({ where: { id: users[p.email].id }, data: { managerId: users[p.manager].id } });
  // An account created without a password yet: shown as "waiting for a password" in the admin overview.
  const w = WAITING_FOR_PASSWORD;
  await prisma.user.create({
    data: { organizationId: org.id, email: w.email, firstName: w.first, lastName: w.last, designation: w.title, roleId: roles.employee.id, departmentId: depts[w.dept].id, managerId: users[w.manager].id, status: 'INVITED', avatarColor: w.color, joinedAt: new Date(now + 6 * 86400_000) },
  });
  for (const [dept, email] of Object.entries(DEPARTMENT_HEADS)) await prisma.department.update({ where: { id: depts[dept].id }, data: { headId: users[email].id } });

  const holidays = await seedHolidays(org.id);
  const ctx = await buildContext(org.id);
  const leave = await seedLeave(ctx);
  const attendance = await seedAttendance(ctx, leave);
  const corrections = await seedCorrections(ctx, attendance.missing);
  const announcements = await seedAnnouncements(ctx, depts);
  const chat = await seedChat(ctx);
  const notifications = await seedNotifications(ctx);
  const audit = await seedAudit(ctx);
  const work = await seedWork(ctx);
  const counts = {
    people: PEOPLE.length + 1,
    active: PEOPLE.filter((p) => !p.status).length,
    deactivated: PEOPLE.filter((p) => p.status === 'DEACTIVATED').length,
    suspended: PEOPLE.filter((p) => p.status === 'SUSPENDED').length,
    waitingForPassword: 1,
    departments: DEPARTMENTS.length,
    holidays,
    leaveRequests: leave.length,
    attendanceDays: attendance.records,
    breaks: attendance.breaks,
    corrections,
    announcements: announcements.count,
    confirmations: announcements.acks,
    ...chat,
    notifications,
    auditEntries: audit,
    ...work,
  };
  return { org, counts };
}

/** Email of the Super Admin that browser tests sign in as. Created only when SEED_E2E_TOTP is set. */
export const E2E_SUPER_ADMIN_EMAIL = 'e2e.superadmin@futuristglobal.com';

/**
 * Browser tests need a Super Admin whose authority is active, which needs two-step verification.
 * The demo Super Admin (admin@) has none, and Super Admins cannot turn it off again, so tests use this
 * extra account instead. Its authenticator secret comes from SEED_E2E_TOTP (base32, the same value the
 * tests get as E2E_TOTP_SECRET). Never set it for a shared or production database.
 */
async function seedE2eSuperAdmin(organizationId: string, password: string, secret: string) {
  if (!/^[A-Z2-7]{16,64}$/.test(secret)) throw new Error('SEED_E2E_TOTP must be a base32 secret (16-64 characters A-Z and 2-7)');
  const { encryptSecret } = await import('../src/auth/mfa');
  const role = await prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId, key: 'administrator' } } });
  const dept = await prisma.department.findFirst({ where: { organizationId, name: 'Management' } });
  await prisma.user.create({
    data: {
      organizationId,
      email: E2E_SUPER_ADMIN_EMAIL,
      firstName: 'Esha',
      lastName: 'Kapoor',
      designation: 'IT Security (automated tests)',
      roleId: role.id,
      departmentId: dept?.id ?? null,
      isSuperAdmin: true,
      status: 'ACTIVE',
      passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      mfaSecretEnc: encryptSecret(secret),
      mfaEnabledAt: new Date(),
      avatarColor: '#0ea5e9',
      joinedAt: new Date(Date.now() - 400 * 86400_000),
    },
  });
  console.log(`  e2e Super Admin: ${E2E_SUPER_ADMIN_EMAIL} (two-step verification on, secret from SEED_E2E_TOTP)`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) throw new Error('Set SEED_PASSWORD (10+ chars) in apps/api/.env before seeding');
  // NODE_ENV alone is not enough: a dev machine whose DATABASE_URL points at a hosted database
  // (e.g. Neon) would delete and recreate the real org. Refuse a non-local host unless told plainly.
  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname;
    } catch {
      return '';
    }
  })();
  console.log(`Seeding database at host: ${dbHost || '(unknown)'}`);
  const isLocalHost = ['localhost', '127.0.0.1', '::1', ''].includes(dbHost);
  if (!isLocalHost && process.env.SEED_ALLOW_REMOTE !== 'yes') {
    throw new Error(`Refusing to seed a non-local database (${dbHost}); seeding DELETES and recreates the demo orgs. Set SEED_ALLOW_REMOTE=yes only if you are certain.`);
  }
  const started = Date.now();
  const fg = await seedOrg({ name: 'Futurist Global', slug: process.env.DEFAULT_ORG_SLUG || 'futurist-global', domain: 'futuristglobal.com', password });
  await seedOrg({ name: 'Acme Test Co', slug: 'acme-test', domain: 'acme.test', password, minimal: true });
  if (process.env.SEED_E2E_TOTP) await seedE2eSuperAdmin(fg.org.id, password, process.env.SEED_E2E_TOTP);
  console.log(`Seeded Futurist Global and Acme Test Co in ${((Date.now() - started) / 1000).toFixed(1)} s:`);
  console.log(Object.entries(fg.counts ?? {}).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
  console.log(`  Sign in with ${DEMO_EMAILS.join(' / ')} using SEED_PASSWORD.`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
