import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { organizationSettingsSchema, type OrganizationSettings } from '@fg/shared';
import { addDays, localDate, localToUtc, toDbDate } from '../src/common/tz';
import { createApp, login, makeOrg, resetDb } from './helpers';

const prisma = new PrismaClient();
const TZ = 'Asia/Kolkata';
const H = 3600_000;
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;

// Every day is a working day and the workday spans the whole day, so results don't depend on when the suite runs.
const BASE: Partial<OrganizationSettings['attendance']> = { timezone: TZ, workingDays: [0, 1, 2, 3, 4, 5, 6], workdayStart: '00:00', workdayEnd: '23:59', multipleSessions: false, checkInMode: 'prompt', autoCheckOut: { afterWorkdayEndHours: 0, maxShiftHours: 0, idleMinutes: 0 } };

async function setAttendance(patch: Partial<OrganizationSettings['attendance']>) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fg.org.id } });
  const s = organizationSettingsSchema.parse(org.settings);
  await prisma.organization.update({ where: { id: fg.org.id }, data: { settings: { ...s, attendance: { ...s.attendance, ...BASE, ...patch } } } });
}
const openShift = (data: { date: string; checkInAt: Date; lastActiveAt?: Date }) =>
  prisma.attendanceRecord.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, location: 'WFO', date: toDbDate(data.date), checkInAt: data.checkInAt, lastActiveAt: data.lastActiveAt ?? null } });

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  await makeOrg(prisma, 'acme', 'acme.test');
  ({ app } = await createApp());
});
beforeEach(async () => {
  await prisma.attendanceRecord.deleteMany({});
  await setAttendance({});
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('attendance sessions', () => {
  it('a night shift that started yesterday can take a break and check out after midnight', async () => {
    const yesterday = addDays(localDate(TZ), -1);
    const r = await openShift({ date: yesterday, checkInAt: new Date(Date.now() - 3 * H) });
    const emp = await login(app, 'employee@futuristglobal.com');
    const t = await emp.get('/api/attendance/today').expect(200);
    expect(t.body.record).toMatchObject({ id: r.id, date: yesterday, state: 'working' });
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(409);
    await emp.post('/api/attendance/break/start').expect(200);
    const out = await emp.post('/api/attendance/check-out').send({}).expect(200);
    expect(out.body.record).toMatchObject({ id: r.id, state: 'checked_out' });
    // The finished night shift doesn't stop the next shift, which belongs to today.
    const next = await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(200);
    expect(next.body.record).toMatchObject({ date: localDate(TZ), state: 'working' });
  });

  it("yesterday's day shift doesn't show as today's", async () => {
    const yesterday = addDays(localDate(TZ), -1);
    await prisma.attendanceRecord.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, location: 'WFO', date: toDbDate(yesterday), checkInAt: localToUtc(yesterday, '09:00', TZ), checkOutAt: localToUtc(yesterday, '18:00', TZ) } });
    const emp = await login(app, 'employee@futuristglobal.com');
    expect((await emp.get('/api/attendance/today').expect(200)).body.record).toBeNull();
  });

  it('an open shift older than 24 hours no longer blocks checking in', async () => {
    await openShift({ date: addDays(localDate(TZ), -3), checkInAt: new Date(Date.now() - 72 * H) });
    const emp = await login(app, 'employee@futuristglobal.com');
    const t = await emp.post('/api/attendance/check-in').send({ location: 'WFH' }).expect(200);
    expect(t.body.record).toMatchObject({ date: localDate(TZ), location: 'WFH', state: 'working' });
  });

  it('allows one check-in a day unless split shifts are on', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(200);
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(409);
    await emp.post('/api/attendance/check-out').send({}).expect(200);
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(409);

    await setAttendance({ multipleSessions: true });
    const again = await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(200);
    expect(again.body.record.state).toBe('working');
    expect(again.body.record.breaks.map((b: { kind: string }) => b.kind)).toEqual(['AWAY']);
    expect(again.body.record.breakMinutes).toBe(0);
    expect(await prisma.attendanceRecord.count({ where: { userId: fg.users.employee.id } })).toBe(1);
  });
});

describe('automatic check-out', () => {
  it('closes a shift at its maximum length, notifies, and lets the person check in again', async () => {
    await setAttendance({ autoCheckOut: { afterWorkdayEndHours: 0, maxShiftHours: 8, idleMinutes: 0 } });
    const checkInAt = new Date(Date.now() - 10 * H);
    await openShift({ date: localDate(TZ), checkInAt });
    const emp = await login(app, 'employee@futuristglobal.com');
    const t = await emp.get('/api/attendance/today').expect(200);
    expect(t.body.record).toMatchObject({ state: 'checked_out', autoCheckOutReason: 'max_shift' });
    expect(new Date(t.body.record.checkOutAt).getTime()).toBe(checkInAt.getTime() + 8 * H);
    await new Promise((res) => setTimeout(res, 300));
    const notes = await emp.get('/api/notifications').expect(200);
    expect(notes.body.items.some((n: { title: string }) => n.title.startsWith('You were checked out automatically'))).toBe(true);
    // Split shifts are off, but a shift the system closed can be resumed.
    const again = await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(200);
    expect(again.body.record).toMatchObject({ state: 'working', autoCheckOutReason: null });
  });

  it('closes at the last activity after the idle limit, and the heartbeat keeps a shift open', async () => {
    await setAttendance({ autoCheckOut: { afterWorkdayEndHours: 0, maxShiftHours: 0, idleMinutes: 30 } });
    const lastActiveAt = new Date(Date.now() - 2 * H);
    await openShift({ date: localDate(TZ), checkInAt: new Date(Date.now() - 3 * H), lastActiveAt });
    const emp = await login(app, 'employee@futuristglobal.com');
    const t = await emp.get('/api/attendance/today').expect(200);
    expect(t.body.record).toMatchObject({ state: 'checked_out', autoCheckOutReason: 'idle' });
    expect(new Date(t.body.record.checkOutAt).getTime()).toBe(lastActiveAt.getTime());

    await prisma.attendanceRecord.deleteMany({});
    const r = await openShift({ date: localDate(TZ), checkInAt: new Date(Date.now() - H), lastActiveAt: new Date(Date.now() - 10 * 60_000) });
    await emp.post('/api/attendance/activity').expect(200);
    const after = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.checkOutAt).toBeNull();
    expect(after.lastActiveAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it('closes day shifts after the workday ends but leaves night shifts to the shift-length rule', async () => {
    await setAttendance({ workdayStart: '09:00', workdayEnd: '18:00', autoCheckOut: { afterWorkdayEndHours: 1, maxShiftHours: 0, idleMinutes: 0 } });
    const day = '2026-01-05';
    const dayShift = await openShift({ date: day, checkInAt: localToUtc(day, '10:00', TZ) });
    const nightShift = await prisma.attendanceRecord.create({ data: { organizationId: fg.org.id, userId: fg.users.manager.id, location: 'WFO', date: toDbDate(day), checkInAt: localToUtc(day, '20:00', TZ) } });
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.get(`/api/attendance/board?date=${day}`).expect(200);
    const closed = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: dayShift.id } });
    expect(closed).toMatchObject({ autoCheckOutReason: 'workday_end', checkOutAt: localToUtc(day, '19:00', TZ) });
    expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: nightShift.id } })).checkOutAt).toBeNull();
  });
});

describe('automatic check-in', () => {
  it('checks in only when the company turned it on, once per day', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const off = await emp.post('/api/attendance/auto-check-in').expect(200);
    expect(off.body).toMatchObject({ checkedIn: false, today: { record: null } });

    await setAttendance({ checkInMode: 'auto', autoCheckInLocation: 'WFH' });
    const on = await emp.post('/api/attendance/auto-check-in').expect(200);
    expect(on.body.checkedIn).toBe(true);
    expect(on.body.today.record).toMatchObject({ location: 'WFH', autoCheckedIn: true, state: 'working' });
    await emp.post('/api/attendance/check-out').send({}).expect(200);
    const again = await emp.post('/api/attendance/auto-check-in').expect(200);
    expect(again.body.checkedIn).toBe(false);
  });

  it('does not check in someone on approved full-day leave', async () => {
    await setAttendance({ checkInMode: 'auto' });
    const type = await prisma.leaveType.create({ data: { organizationId: fg.org.id, code: 'CL', name: 'Casual leave', annualAllowance: 12 } });
    const today = toDbDate(localDate(TZ));
    await prisma.leaveRequest.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, typeId: type.id, startDate: today, endDate: today, days: 1, status: 'APPROVED' } });
    const emp = await login(app, 'employee@futuristglobal.com');
    const res = await emp.post('/api/attendance/auto-check-in').expect(200);
    expect(res.body).toMatchObject({ checkedIn: false, today: { onLeave: true, record: null } });
  });
});
