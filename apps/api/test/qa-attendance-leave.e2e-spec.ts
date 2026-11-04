import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { organizationSettingsSchema, type OrganizationSettings } from '@fg/shared';
import { addDays, localDate, localMinutes, localToUtc, toDbDate } from '../src/common/tz';
import { createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

/**
 * QA coverage for attendance, leave, holidays, approvals and corrections:
 * validation, time zones, concurrency, permissions and tenant isolation.
 * Every test creates its own data; leave dates sit in a fixed future year so results don't depend on today.
 */
const prisma = new PrismaClient();
const TZ = 'Asia/Kolkata';
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let acme: Awaited<ReturnType<typeof makeOrg>>;
let outsider: { id: string; email: string };
let type: { id: string };

// 2031-03-03 is a Monday.
const MON = '2031-03-03';
const TUE = '2031-03-04';
const WED = '2031-03-05';
const FRI = '2031-03-07';
const SAT = '2031-03-08';
const SUN = '2031-03-09';
const NEXT_MON = '2031-03-10';

async function setSettings(patch: { attendance?: Partial<OrganizationSettings['attendance']>; leave?: Partial<OrganizationSettings['leave']> }) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fg.org.id } });
  const s = organizationSettingsSchema.parse(org.settings);
  await prisma.organization.update({
    where: { id: fg.org.id },
    data: {
      settings: {
        ...s,
        // Every day is a working day for attendance tests unless a test says otherwise.
        attendance: { ...s.attendance, timezone: TZ, workdayStart: '00:00', workdayEnd: '23:59', autoCheckOut: { afterWorkdayEndHours: 0, maxShiftHours: 0, idleMinutes: 0 }, ...patch.attendance },
        leave: { ...s.leave, countDaysOffInside: false, allowHalfDay: true, requireManagerApproval: true, yearStartMonth: 1, ...patch.leave },
      },
    },
  });
}

/** Notifications are sent in the background; wait until the expected count arrives. */
async function notificationsFor(userId: string, expected: number, where: Record<string, unknown> = {}) {
  let n = 0;
  for (let i = 0; i < 40; i++) {
    n = await prisma.notification.count({ where: { userId, ...where } });
    if (n >= expected) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  // A short extra wait catches duplicates that would arrive late.
  await new Promise((r) => setTimeout(r, 50));
  return prisma.notification.findMany({ where: { userId, ...where } });
}

async function freshType(allowance = 10) {
  const code = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return prisma.leaveType.create({ data: { organizationId: fg.org.id, code, name: `Type ${code}`, annualAllowance: allowance } });
}

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  acme = await makeOrg(prisma, 'acme', 'acme.test');
  await prisma.user.update({ where: { id: fg.users.employee.id }, data: { managerId: fg.users.manager.id } });
  outsider = await prisma.user.create({
    data: { organizationId: fg.org.id, email: 'outsider@futuristglobal.com', firstName: 'Out', lastName: 'Sider', roleId: fg.roles.employee.id, status: 'ACTIVE', passwordHash: await hash(PASSWORD) },
  });
  ({ app } = await createApp());
});
beforeEach(async () => {
  await prisma.leaveRequest.deleteMany({});
  await prisma.attendanceCorrection.deleteMany({});
  await prisma.attendanceRecord.deleteMany({});
  await prisma.holiday.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.user.update({ where: { id: fg.users.manager.id }, data: { status: 'ACTIVE' } });
  await setSettings({ attendance: { workingDays: [1, 2, 3, 4, 5] } });
  type = await freshType();
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('input validation', () => {
  it('rejects dates that do not exist with 400 instead of a server error', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await emp.get('/api/attendance/me?from=2026-02-30&to=2026-03-01').expect(400);
    await emp.get('/api/attendance/me?to=2026-13-01').expect(400);
    await hr.get('/api/attendance/board?date=2026-04-31').expect(400);
    await hr.get('/api/attendance/export?from=2026-00-10').expect(400);
    await emp.get('/api/leave/calendar?month=2026-13').expect(400);
    await emp.get('/api/leave/calendar?month=2026-00').expect(400);
    await emp.post('/api/leave/preview').send({ typeId: type.id, startDate: '2031-02-29', endDate: '2031-03-01' }).expect(400);
    await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: '2031-02-29', endDate: '2031-03-01' }).expect(400);
    await hr.post('/api/holidays').send({ name: 'Leap', date: '2031-02-29' }).expect(400);
    await emp.post('/api/attendance/corrections').send({ date: '2026-02-30', checkIn: '09:00', checkOut: '18:00', location: 'WFO', reason: 'Forgot to check in' }).expect(400);
    // A real leap day is fine.
    await hr.post('/api/holidays').send({ name: 'Leap day', date: '2032-02-29' }).expect(201);
  });

  it('limits history, export and leave ranges to a year', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await emp.get('/api/attendance/me?from=1990-01-01').expect(400);
    await emp.get('/api/attendance/me?from=2026-01-10&to=2026-01-01').expect(400);
    await hr.get('/api/attendance/export?from=2020-01-01&to=2026-01-01').expect(400);
    await hr.get('/api/attendance/export?from=2026-01-10&to=2026-01-01').expect(400);
    await emp.get('/api/attendance/me?from=2026-01-01&to=2026-12-31').expect(200);
    await emp.post('/api/leave/preview').send({ typeId: type.id, startDate: '2031-01-01', endDate: '2032-06-01' }).expect(400);
  });

  it('refuses a time zone the server does not know', async () => {
    const admin = await login(app, 'super_admin@futuristglobal.com');
    const bad = await admin.patch('/api/organization').send({ settings: { attendance: { timezone: 'Mars/Olympus' } } }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('time zone');
    await admin.patch('/api/organization').send({ settings: { attendance: { timezone: 'Europe/London' } } }).expect(200);
    // Attendance keeps working after a valid change.
    await (await login(app, 'employee@futuristglobal.com')).get('/api/attendance/today').expect(200);
  });
});

describe('leave requests', () => {
  it('runs request → preview breakdown → manager approval → balance → cancel', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/holidays').send({ name: 'QA holiday', date: WED, type: 'MANDATORY' }).expect(201);
    const emp = await login(app, 'employee@futuristglobal.com');
    const p = await emp.post('/api/leave/preview').send({ typeId: type.id, startDate: MON, endDate: SUN }).expect(200);
    expect(p.body).toMatchObject({ days: 4, calendarDays: 7, workingDays: 4, weekends: 2, sandwichDays: 0 });
    expect(p.body.holidays).toEqual([{ date: WED, name: 'QA holiday' }]);

    const req = await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: SUN, reason: 'Family trip' }).expect(201);
    expect(req.body).toMatchObject({ status: 'PENDING', days: 4 });
    expect(await notificationsFor(fg.users.manager.id, 1, { type: 'leave' })).toHaveLength(1);

    const mgr = await login(app, 'manager@futuristglobal.com');
    const queue = await mgr.get('/api/leave/requests?scope=approvals&status=PENDING').expect(200);
    expect(queue.body.map((r: { id: string }) => r.id)).toContain(req.body.id);
    await mgr.post(`/api/leave/requests/${req.body.id}/decision`).send({ decision: 'APPROVED', note: 'Enjoy' }).expect(200);
    await mgr.post(`/api/leave/requests/${req.body.id}/decision`).send({ decision: 'REJECTED' }).expect(409);

    const mine = await emp.get('/api/leave/requests?scope=mine').expect(200);
    expect(mine.body[0]).toMatchObject({ status: 'APPROVED', decisionNote: 'Enjoy' });
    await emp.post(`/api/leave/requests/${req.body.id}/cancel`).expect(200);
    await emp.post(`/api/leave/requests/${req.body.id}/cancel`).expect(400);
  });

  it('applies the sandwich rule only to days off inside the leave, never to half days', async () => {
    await setSettings({ leave: { countDaysOffInside: true } });
    const emp = await login(app, 'employee@futuristglobal.com');
    const inside = await emp.post('/api/leave/preview').send({ typeId: type.id, startDate: FRI, endDate: NEXT_MON }).expect(200);
    expect(inside.body).toMatchObject({ days: 4, sandwichDays: 2 });
    // Days off at the edges are never counted.
    const edges = await emp.post('/api/leave/preview').send({ typeId: type.id, startDate: SAT, endDate: NEXT_MON }).expect(200);
    expect(edges.body).toMatchObject({ days: 1, sandwichDays: 0 });
    const half = await emp.post('/api/leave/preview').send({ typeId: type.id, startDate: FRI, endDate: FRI, halfDay: 'SECOND_HALF' }).expect(200);
    expect(half.body.days).toBe(0.5);
  });

  it('checks half days, weekends, overlap and balance', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: TUE, halfDay: 'FIRST_HALF' }).expect(400);
    await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: SAT, endDate: SUN }).expect(400);
    await setSettings({ leave: { allowHalfDay: false } });
    await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: MON, halfDay: 'FIRST_HALF' }).expect(400);
    await setSettings({});
    await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: MON, halfDay: 'FIRST_HALF' }).expect(201);
    await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: TUE }).expect(409);
    const small = await freshType(2);
    const over = await emp.post('/api/leave/requests').send({ typeId: small.id, startDate: WED, endDate: NEXT_MON }).expect(400);
    expect(over.body.message).toContain('2 day(s) left');
  });

  it('checks the balance of the leave year the leave falls in', async () => {
    const small = await freshType(2);
    // Two days already used in 2031; 2032 starts fresh.
    await prisma.leaveRequest.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, typeId: small.id, startDate: toDbDate('2031-01-06'), endDate: toDbDate('2031-01-07'), days: 2, status: 'APPROVED' } });
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/leave/requests').send({ typeId: small.id, startDate: MON, endDate: MON }).expect(400);
    // 2032-01-05 is a Monday in the next leave year.
    await emp.post('/api/leave/requests').send({ typeId: small.id, startDate: '2032-01-05', endDate: '2032-01-06' }).expect(201);
    // Balances can be read for the leave year of any date (the request dialog shows the year the leave falls in).
    const y2032 = await emp.get('/api/leave/balances?at=2032-03-01').expect(200);
    expect(y2032.body.year).toEqual({ start: '2032-01-01', end: '2032-12-31' });
    expect(y2032.body.items.find((b: { type: { id: string } }) => b.type.id === small.id)).toMatchObject({ used: 0, pending: 2, remaining: 0 });
    const y2031 = await emp.get('/api/leave/balances?at=2031-12-31').expect(200);
    expect(y2031.body.items.find((b: { type: { id: string } }) => b.type.id === small.id)).toMatchObject({ used: 2, pending: 0 });
    await emp.get('/api/leave/balances?at=2031-02-30').expect(400);
    // With an April leave year, January 2032 belongs to the April 2031 year; fill that one.
    await prisma.leaveRequest.deleteMany({});
    await setSettings({ leave: { yearStartMonth: 4 } });
    await prisma.leaveRequest.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, typeId: small.id, startDate: toDbDate('2031-06-02'), endDate: toDbDate('2031-06-03'), days: 2, status: 'APPROVED' } });
    await emp.post('/api/leave/requests').send({ typeId: small.id, startDate: '2032-01-05', endDate: '2032-01-05' }).expect(400);
    await emp.post('/api/leave/requests').send({ typeId: small.id, startDate: '2032-04-05', endDate: '2032-04-05' }).expect(201);
  });

  it('accepts only one of two identical requests sent at the same time', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const body = { typeId: type.id, startDate: MON, endDate: FRI };
    const results = await Promise.all([emp.post('/api/leave/requests').send(body), emp.post('/api/leave/requests').send(body), emp.post('/api/leave/requests').send(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await prisma.leaveRequest.count({ where: { userId: fg.users.employee.id } })).toBe(1);
  });

  it('applies only one of two decisions made at the same time', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const req = await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: MON }).expect(201);
    const mgr = await login(app, 'manager@futuristglobal.com');
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const [a, b] = await Promise.all([
      mgr.post(`/api/leave/requests/${req.body.id}/decision`).send({ decision: 'APPROVED' }),
      hr.post(`/api/leave/requests/${req.body.id}/decision`).send({ decision: 'REJECTED' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stored = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.body.id } });
    expect(stored.status).toBe(a.status === 200 ? 'APPROVED' : 'REJECTED');
    expect(await notificationsFor(fg.users.employee.id, 1, { type: 'leave' })).toHaveLength(1);
  });

  it('blocks self-approval, approving outside your team, and other tenants', async () => {
    const out = await login(app, 'outsider@futuristglobal.com');
    const req = await out.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: MON }).expect(201);
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post(`/api/leave/requests/${req.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    await out.post(`/api/leave/requests/${req.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post(`/api/leave/requests/${req.body.id}/cancel`).expect(404);
    await emp.get(`/api/leave/balances?userId=${outsider.id}`).expect(403);

    const other = await login(app, 'super_admin@acme.test');
    await other.post(`/api/leave/requests/${req.body.id}/decision`).send({ decision: 'APPROVED' }).expect(404);
    await other.post(`/api/leave/requests/${req.body.id}/cancel`).expect(404);
    await other.get(`/api/leave/balances?userId=${outsider.id}`).expect(404);
    await other.post('/api/leave/requests/record').send({ userId: outsider.id, typeId: type.id, startDate: TUE, endDate: TUE }).expect(404);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.get(`/api/leave/balances?userId=${acme.users.employee.id}`).expect(404);
    await hr.post('/api/leave/requests/record').send({ userId: acme.users.employee.id, typeId: type.id, startDate: TUE, endDate: TUE }).expect(404);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.body.id } })).status).toBe('PENDING');
  });

  it('records leave on behalf with the same checks and tells the employee and manager', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const r = await hr.post('/api/leave/requests/record').send({ userId: fg.users.employee.id, typeId: type.id, startDate: MON, endDate: TUE, reason: 'Was unwell' }).expect(201);
    expect(r.body).toMatchObject({ status: 'APPROVED', days: 2 });
    await hr.post('/api/leave/requests/record').send({ userId: fg.users.employee.id, typeId: type.id, startDate: TUE, endDate: WED }).expect(409);
    await hr.post('/api/leave/requests/record').send({ userId: fg.users.hr_admin.id, typeId: type.id, startDate: WED, endDate: WED }).expect(400);
    expect(await notificationsFor(fg.users.employee.id, 1, { type: 'leave' })).toHaveLength(1);
    expect(await notificationsFor(fg.users.manager.id, 1, { type: 'leave' })).toHaveLength(1);
    await (await login(app, 'manager@futuristglobal.com')).post('/api/leave/requests/record').send({ userId: fg.users.employee.id, typeId: type.id, startDate: FRI, endDate: FRI }).expect(403);
  });

  it('tells the manager when a pending request is cancelled', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const req = await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: MON }).expect(201);
    await notificationsFor(fg.users.manager.id, 1);
    await prisma.notification.deleteMany({});
    await emp.post(`/api/leave/requests/${req.body.id}/cancel`).expect(200);
    const n = await notificationsFor(fg.users.manager.id, 1);
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain('cancelled');
  });

  it('sends requests to HR when the manager is deactivated', async () => {
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { status: 'DEACTIVATED' } });
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/leave/requests').send({ typeId: type.id, startDate: MON, endDate: MON }).expect(201);
    expect(await notificationsFor(fg.users.hr_admin.id, 1, { type: 'leave' })).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: fg.users.manager.id } })).toBe(0);
  });

  it('cannot cancel leave that has started', async () => {
    const today = localDate(TZ);
    const started = await prisma.leaveRequest.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, typeId: type.id, startDate: toDbDate(today), endDate: toDbDate(addDays(today, 2)), days: 3, status: 'APPROVED' } });
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post(`/api/leave/requests/${started.id}/cancel`).expect(400);
  });
});

describe('attendance', () => {
  it('checks in with a mode and note, takes one break even when tapped twice, and checks out once', async () => {
    await setSettings({ attendance: { workingDays: [0, 1, 2, 3, 4, 5, 6] } });
    const emp = await login(app, 'employee@futuristglobal.com');
    const inRes = await emp.post('/api/attendance/check-in').send({ location: 'WFH', remarks: 'Client call from home' }).expect(200);
    expect(inRes.body.record).toMatchObject({ location: 'WFH', remarks: 'Client call from home', state: 'working', date: localDate(TZ) });
    const breaks = await Promise.all([emp.post('/api/attendance/break/start'), emp.post('/api/attendance/break/start')]);
    expect(breaks.map((b) => b.status).sort()).toEqual([200, 409]);
    const rec = await prisma.attendanceRecord.findFirstOrThrow({ where: { userId: fg.users.employee.id }, include: { breaks: true } });
    expect(rec.breaks.filter((b) => !b.endAt)).toHaveLength(1);
    await emp.post('/api/attendance/break/end').expect(200);
    await emp.post('/api/attendance/break/end').expect(400);
    const outs = await Promise.all([emp.post('/api/attendance/check-out').send({ remarks: 'Done' }), emp.post('/api/attendance/check-out').send({ remarks: 'Done' })]);
    expect(outs.filter((o) => o.status === 200)).toHaveLength(1);
    expect([400, 409]).toContain(outs.find((o) => o.status !== 200)!.status);
    const after = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: rec.id } });
    expect(after.checkOutRemarks).toBe('Done');
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(409);
  });

  it('reopens a split shift once even when check-in is tapped twice', async () => {
    await setSettings({ attendance: { workingDays: [0, 1, 2, 3, 4, 5, 6], multipleSessions: true } });
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(200);
    await emp.post('/api/attendance/check-out').send({}).expect(200);
    const again = await Promise.all([emp.post('/api/attendance/check-in').send({ location: 'WFO' }), emp.post('/api/attendance/check-in').send({ location: 'WFO' })]);
    expect(again.map((a) => a.status).sort()).toEqual([200, 409]);
    const rec = await prisma.attendanceRecord.findFirstOrThrow({ where: { userId: fg.users.employee.id }, include: { breaks: true } });
    expect(rec.breaks.filter((b) => b.kind === 'AWAY')).toHaveLength(1);
  });

  it('marks history days off correctly across a full year', async () => {
    const day = '2026-06-01'; // a Monday
    await prisma.attendanceRecord.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, location: 'WFO', date: toDbDate(day), checkInAt: localToUtc(day, '09:00', TZ), checkOutAt: localToUtc(day, '18:00', TZ) } });
    const emp = await login(app, 'employee@futuristglobal.com');
    const h = await emp.get('/api/attendance/me?from=2025-07-01&to=2026-06-30').expect(200);
    expect(h.body.items).toHaveLength(1);
    expect(h.body.items[0]).toMatchObject({ date: day, dayOff: false, workedMinutes: 540 });
  });

  it("hides other tenants' people (404) and checks team scope (403)", async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.get(`/api/attendance/users/${fg.users.manager.id}`).expect(403);
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.get(`/api/attendance/users/${fg.users.employee.id}`).expect(200);
    await mgr.get(`/api/attendance/users/${outsider.id}`).expect(403);
    await mgr.get(`/api/attendance/users/${acme.users.employee.id}`).expect(404);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.get(`/api/attendance/users/${acme.users.employee.id}`).expect(404);
    await hr.get('/api/attendance/users/does-not-exist').expect(404);
    const board = await mgr.get('/api/attendance/board').expect(200);
    expect(board.body.rows.map((r: { person: { id: string } }) => r.person.id)).toEqual([fg.users.employee.id]);
  });

  it('exports CSV that spreadsheets cannot run as formulas', async () => {
    const day = addDays(localDate(TZ), -1);
    await prisma.user.update({ where: { id: outsider.id }, data: { firstName: '+SUM(1,2)', lastName: 'Sider' } });
    await prisma.attendanceRecord.createMany({
      data: [
        { organizationId: fg.org.id, userId: fg.users.employee.id, location: 'WFO', date: toDbDate(day), checkInAt: localToUtc(day, '09:00', TZ), checkOutAt: localToUtc(day, '18:00', TZ), remarks: '=HYPERLINK("http://x","y")', checkOutRemarks: 'line\rbreak' },
        { organizationId: fg.org.id, userId: outsider.id, location: 'WFH', date: toDbDate(day), checkInAt: localToUtc(day, '10:00', TZ), remarks: '＝1+1' },
        { organizationId: acme.org.id, userId: acme.users.employee.id, location: 'WFO', date: toDbDate(day), checkInAt: localToUtc(day, '09:00', TZ), remarks: 'acme-secret' },
      ],
    });
    try {
      const hr = await login(app, 'hr_admin@futuristglobal.com');
      const res = await hr.get(`/api/attendance/export?from=${day}&to=${day}`).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const csv = res.text;
      expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")`);
      expect(csv).toContain("'+SUM(1,2) Sider");
      expect(csv).toContain("'＝1+1");
      expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
      expect(csv).toContain('line\rbreak"');
      expect(csv).not.toContain('acme-secret');
      // 09:00–18:00 in the organization's time zone.
      expect(csv).toContain(',09:00,18:00,');
      const mgr = await login(app, 'manager@futuristglobal.com');
      const team = await mgr.get(`/api/attendance/export?from=${day}&to=${day}`).expect(200);
      expect(team.text).not.toContain('Sider');
      await (await login(app, 'employee@futuristglobal.com')).get('/api/attendance/export').expect(403);
    } finally {
      await prisma.user.update({ where: { id: outsider.id }, data: { firstName: 'Out' } });
    }
  });
});

describe('attendance corrections', () => {
  it('rejects future times, open-ended past days, and duplicate requests sent at once', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const today = localDate(TZ);
    const yesterday = addDays(today, -1);
    await emp.post('/api/attendance/corrections').send({ date: addDays(today, 1), checkIn: '09:00', checkOut: '18:00', location: 'WFO', reason: 'Tomorrow please' }).expect(400);
    await emp.post('/api/attendance/corrections').send({ date: addDays(today, -61), checkIn: '09:00', checkOut: '18:00', location: 'WFO', reason: 'Too long ago' }).expect(400);
    await emp.post('/api/attendance/corrections').send({ date: yesterday, checkIn: '09:00', location: 'WFO', reason: 'Forgot to check out' }).expect(400);
    if (localMinutes(TZ) < 23 * 60 + 58) await emp.post('/api/attendance/corrections').send({ date: today, checkIn: '23:59', location: 'WFO', reason: 'Not yet started' }).expect(400);
    if (localMinutes(TZ) > 1) await emp.post('/api/attendance/corrections').send({ date: today, checkIn: '00:00', checkOut: '23:59', location: 'WFO', reason: 'Ends in the future' }).expect(localMinutes(TZ) < 23 * 60 + 59 ? 400 : 201);
    await prisma.attendanceCorrection.deleteMany({});
    const body = { date: yesterday, checkIn: '09:00', checkOut: '18:00', location: 'WFO', reason: 'Forgot to check in' };
    const both = await Promise.all([emp.post('/api/attendance/corrections').send(body), emp.post('/api/attendance/corrections').send(body)]);
    expect(both.map((b) => b.status).sort()).toEqual([201, 409]);
    expect(await prisma.attendanceCorrection.count({ where: { userId: fg.users.employee.id, status: 'PENDING' } })).toBe(1);
  });

  it('applies an approved correction in the organization time zone and trims breaks outside it', async () => {
    const day = addDays(localDate(TZ), -2);
    const rec = await prisma.attendanceRecord.create({
      data: {
        organizationId: fg.org.id, userId: fg.users.employee.id, location: 'WFH', date: toDbDate(day), checkInAt: localToUtc(day, '08:00', TZ), checkOutAt: localToUtc(day, '20:00', TZ),
        breaks: { create: [{ startAt: localToUtc(day, '08:15', TZ), endAt: localToUtc(day, '08:45', TZ) }, { startAt: localToUtc(day, '13:00', TZ), endAt: localToUtc(day, '13:30', TZ) }, { startAt: localToUtc(day, '17:45', TZ), endAt: localToUtc(day, '18:30', TZ) }] },
      },
    });
    const emp = await login(app, 'employee@futuristglobal.com');
    const c = await emp.post('/api/attendance/corrections').send({ date: day, checkIn: '09:00', checkOut: '18:00', location: 'WFO', reason: 'Wrong times recorded' }).expect(201);
    await emp.post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    const out = await login(app, 'outsider@futuristglobal.com');
    await out.post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    await (await login(app, 'super_admin@acme.test')).post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'APPROVED' }).expect(404);

    const mgr = await login(app, 'manager@futuristglobal.com');
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const [a, b] = await Promise.all([
      mgr.post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'APPROVED' }),
      hr.post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'REJECTED' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const approved = a.status === 200;
    const after = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: rec.id }, include: { breaks: { orderBy: { startAt: 'asc' } } } });
    if (approved) {
      expect(after.checkInAt.toISOString()).toBe(localToUtc(day, '09:00', TZ).toISOString());
      expect(after.checkOutAt!.toISOString()).toBe(localToUtc(day, '18:00', TZ).toISOString());
      expect(after.location).toBe('WFO');
      expect(after.breaks).toHaveLength(2);
      expect(after.breaks[1]!.endAt!.toISOString()).toBe(localToUtc(day, '18:00', TZ).toISOString());
      const h = await emp.get(`/api/attendance/me?from=${day}&to=${day}`).expect(200);
      expect(h.body.items[0]).toMatchObject({ breakMinutes: 45, workedMinutes: 9 * 60 - 45 });
    } else {
      expect(after.checkInAt.toISOString()).toBe(localToUtc(day, '08:00', TZ).toISOString());
    }
  });
});

describe('holidays and dashboard', () => {
  it('returns 409 when an edit collides with another holiday, and 404 across tenants', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/holidays').send({ name: 'Day one', date: MON }).expect(201);
    const two = await hr.post('/api/holidays').send({ name: 'Day one', date: TUE }).expect(201);
    await hr.patch(`/api/holidays/${two.body.id}`).send({ date: MON }).expect(409);
    await hr.patch(`/api/holidays/${two.body.id}`).send({ date: '2031-02-30' }).expect(400);
    await (await login(app, 'super_admin@acme.test')).delete(`/api/holidays/${two.body.id}`).expect(404);
    await (await login(app, 'employee@futuristglobal.com')).delete(`/api/holidays/${two.body.id}`).expect(403);
  });

  it("uses the organization's calendar day for the holiday year and upcoming holidays", async () => {
    // Pacific/Kiritimati is UTC+14, so its date is often a day ahead of UTC.
    await setSettings({ attendance: { timezone: 'Pacific/Kiritimati' } });
    const orgToday = localDate('Pacific/Kiritimati');
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/holidays').send({ name: 'Yesterday there', date: addDays(orgToday, -1) }).expect(201);
    await hr.post('/api/holidays').send({ name: 'Today there', date: orgToday }).expect(201);
    const emp = await login(app, 'employee@futuristglobal.com');
    const dash = await emp.get('/api/dashboard').expect(200);
    expect(dash.body.workday.timezone).toBe('Pacific/Kiritimati');
    const names = dash.body.holidays.map((h: { name: string }) => h.name);
    expect(names).toContain('Today there');
    expect(names).not.toContain('Yesterday there');
    const list = await emp.get('/api/holidays').expect(200);
    expect(list.body.year).toBe(Number(orgToday.slice(0, 4)));
  });
});
