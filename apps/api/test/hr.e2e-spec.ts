import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp, login, makeOrg, resetDb } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;
let casual: { id: string };
let unpaid: { id: string };

// A fixed future Monday–Friday week keeps day counts deterministic.
const MON = '2030-01-07';
const TUE = '2030-01-08';
const FRI = '2030-01-11';
const SAT = '2030-01-12';
const SUN = '2030-01-13';

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  await prisma.user.update({ where: { id: fg.users.employee.id }, data: { managerId: fg.users.manager.id } });
  casual = await prisma.leaveType.create({ data: { organizationId: fg.org.id, code: 'CL', name: 'Casual leave', annualAllowance: 4 } });
  unpaid = await prisma.leaveType.create({ data: { organizationId: fg.org.id, code: 'UL', name: 'Unpaid leave', annualAllowance: 0, paid: false } });
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('holidays', () => {
  it('only holiday managers create/edit/delete; everyone reads; tenants isolated', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/holidays').send({ name: 'Nope', date: TUE }).expect(403);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const h = await hr.post('/api/holidays').send({ name: 'Founders day', date: TUE, type: 'COMPANY' }).expect(201);
    await hr.post('/api/holidays').send({ name: 'Founders day', date: TUE }).expect(409);
    const list = await emp.get('/api/holidays?year=2030').expect(200);
    expect(list.body.items.map((x: { name: string }) => x.name)).toContain('Founders day');
    const acme = await login(app, 'super_admin@acme.test');
    await acme.patch(`/api/holidays/${h.body.id}`).send({ name: 'Hijacked' }).expect(404);
    expect((await acme.get('/api/holidays?year=2030').expect(200)).body.items).toHaveLength(0);
  });
});

describe('leave', () => {
  it('counts working days excluding weekends and company holidays', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    // Mon–Sun with Tue as a company holiday → Mon, Wed, Thu, Fri = 4
    const p = await emp.post('/api/leave/preview').send({ typeId: casual.id, startDate: MON, endDate: SUN }).expect(200);
    expect(p.body.days).toBe(4);
    const half = await emp.post('/api/leave/preview').send({ typeId: casual.id, startDate: MON, endDate: MON, halfDay: 'FIRST_HALF' }).expect(200);
    expect(half.body.days).toBe(0.5);
    await emp.post('/api/leave/preview').send({ typeId: casual.id, startDate: FRI, endDate: MON }).expect(400); // end before start
  });

  it('rejects weekend-only, over-balance and overlapping requests', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/leave/requests').send({ typeId: casual.id, startDate: SAT, endDate: SUN }).expect(400);
    // 2030 is outside the current leave year, so balance applies to this year's requests only; use unpaid for future-year tests
    const r = await emp.post('/api/leave/requests').send({ typeId: unpaid.id, startDate: MON, endDate: FRI, reason: 'Trip' }).expect(201);
    expect(r.body).toMatchObject({ days: 4, status: 'PENDING' });
    await emp.post('/api/leave/requests').send({ typeId: unpaid.id, startDate: FRI, endDate: FRI }).expect(409);
    await emp.post(`/api/leave/requests/${r.body.id}/cancel`).expect(200);

    // balance (current leave year)
    const y = new Date().getUTCFullYear();
    const today = new Date();
    const dates: string[] = [];
    for (let i = 1; dates.length < 6 && i < 60; i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i));
      if (d.getUTCFullYear() !== y) break;
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
    }
    if (dates.length >= 5) {
      await emp.post('/api/leave/requests').send({ typeId: casual.id, startDate: dates[0], endDate: dates[4] }).expect(400); // 5 > 4 allowance
    }
  });

  it('manager approves direct reports only; HR approves anyone; nobody approves themselves; tenants isolated', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const r = await emp.post('/api/leave/requests').send({ typeId: unpaid.id, startDate: MON, endDate: MON }).expect(201);
    const mgr = await login(app, 'manager@futuristglobal.com');
    const pending = await mgr.get('/api/leave/requests?scope=approvals&status=PENDING').expect(200);
    expect(pending.body.map((x: { id: string }) => x.id)).toContain(r.body.id);
    expect((await mgr.get('/api/approvals/count').expect(200)).body.leave).toBe(1);

    await emp.post(`/api/leave/requests/${r.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    const acme = await login(app, 'super_admin@acme.test');
    await acme.post(`/api/leave/requests/${r.body.id}/decision`).send({ decision: 'APPROVED' }).expect(404);

    const ok = await mgr.post(`/api/leave/requests/${r.body.id}/decision`).send({ decision: 'APPROVED', note: 'Enjoy' }).expect(200);
    expect(ok.body.status).toBe('APPROVED');
    await mgr.post(`/api/leave/requests/${r.body.id}/decision`).send({ decision: 'REJECTED' }).expect(409);

    // manager's own request cannot be approved by a peer manager without HR rights
    const own = await mgr.post('/api/leave/requests').send({ typeId: unpaid.id, startDate: FRI, endDate: FRI }).expect(201);
    await mgr.post(`/api/leave/requests/${own.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/leave/requests/${own.body.id}/decision`).send({ decision: 'REJECTED' }).expect(200);

    // employee notified
    await new Promise((res) => setTimeout(res, 300));
    const notes = await emp.get('/api/notifications').expect(200);
    expect(notes.body.items.some((n: { type: string; title: string }) => n.type === 'leave' && n.title.includes('approved'))).toBe(true);
  });

  it('calendar hides reasons from colleagues', async () => {
    const dept = await prisma.department.create({ data: { organizationId: fg.org.id, name: 'Eng' } });
    await prisma.user.updateMany({ where: { id: { in: [fg.users.employee.id, fg.users.hr_admin.id] } }, data: { departmentId: dept.id } });
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const cal = await hr.get('/api/leave/calendar?month=2030-01').expect(200);
    const empLeave = cal.body.leaves.find((l: { person: { id: string }; status: string }) => l.person.id === fg.users.employee.id && l.status === 'APPROVED');
    expect(empLeave).toBeDefined();
    // A department colleague (no HR rights) sees the leave but not the reason
    await prisma.user.update({ where: { id: fg.users.super_admin.id }, data: { departmentId: dept.id } });
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { departmentId: dept.id, managerId: null } });
    await prisma.user.update({ where: { id: fg.users.employee.id }, data: { managerId: null } });
    const peer = await login(app, 'manager@futuristglobal.com');
    const seen = await peer.get('/api/leave/calendar?month=2030-01').expect(200);
    const l = seen.body.leaves.find((x: { id: string }) => x.id === empLeave.id);
    expect(l).toBeDefined();
    expect(l.reason).toBeNull();
    expect(seen.body.leaves.every((x: { status: string }) => x.status === 'APPROVED')).toBe(true);
    await prisma.user.update({ where: { id: fg.users.employee.id }, data: { managerId: fg.users.manager.id } });
  });

  it('attendance board marks people on approved leave', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const b = await hr.get(`/api/attendance/board?date=${MON}`).expect(200);
    const row = b.body.rows.find((r: { person: { id: string } }) => r.person.id === fg.users.employee.id);
    expect(row.leave).toMatchObject({ type: 'Unpaid leave' });
    expect(b.body.totals.onLeave).toBe(1);
  });
});

describe('attendance corrections', () => {
  it('employee requests; manager approves; record is created in org time zone and audited', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    await emp.post('/api/attendance/corrections').send({ date: '2099-01-01', checkIn: '09:00', location: 'WFO', reason: 'future day' }).expect(400);
    await emp.post('/api/attendance/corrections').send({ date: yesterday, checkIn: '10:00', checkOut: '09:00', location: 'WFO', reason: 'bad times' }).expect(400);
    const c = await emp.post('/api/attendance/corrections').send({ date: yesterday, checkIn: '09:15', checkOut: '18:30', location: 'WFH', reason: 'Forgot to check in' }).expect(201);
    await emp.post('/api/attendance/corrections').send({ date: yesterday, checkIn: '09:15', location: 'WFH', reason: 'Again please' }).expect(409);

    const other = await login(app, 'super_admin@acme.test');
    await other.post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'APPROVED' }).expect(404);
    await emp.post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);

    const mgr = await login(app, 'manager@futuristglobal.com');
    const list = await mgr.get('/api/attendance/corrections?scope=approvals').expect(200);
    expect(list.body.map((x: { id: string }) => x.id)).toContain(c.body.id);
    await mgr.post(`/api/attendance/corrections/${c.body.id}/decision`).send({ decision: 'APPROVED' }).expect(200);

    const rec = await prisma.attendanceRecord.findUniqueOrThrow({ where: { userId_date: { userId: fg.users.employee.id, date: new Date(`${yesterday}T00:00:00Z`) } } });
    // 09:15 in Asia/Kolkata (UTC+5:30) is 03:45 UTC
    expect(rec.checkInAt.toISOString().slice(11, 16)).toBe('03:45');
    expect(rec.location).toBe('WFH');
    expect(await prisma.auditLog.count({ where: { action: 'attendance.corrected' } })).toBe(1);
  });
});

describe('recording leave on someone’s behalf', () => {
  const DAY = '2030-02-04'; // a Monday

  it('HR records approved leave for an employee; they and their manager are notified; audited', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/leave/requests/record').send({ userId: fg.users.manager.id, typeId: casual.id, startDate: DAY, endDate: DAY }).expect(403);

    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const r = await hr.post('/api/leave/requests/record').send({ userId: fg.users.employee.id, typeId: casual.id, startDate: DAY, endDate: DAY, reason: 'Forgot to apply' }).expect(201);
    expect(r.body).toMatchObject({ status: 'APPROVED', days: 1 });
    await hr.post('/api/leave/requests/record').send({ userId: fg.users.employee.id, typeId: casual.id, startDate: DAY, endDate: DAY }).expect(409);
    await hr.post('/api/leave/requests/record').send({ userId: fg.users.hr_admin.id, typeId: casual.id, startDate: DAY, endDate: DAY }).expect(400);
    await hr.post('/api/leave/requests/record').send({ userId: other.users.employee.id, typeId: casual.id, startDate: DAY, endDate: DAY }).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'leave.recorded' } })).toBe(1);

    await new Promise((res) => setTimeout(res, 300));
    const mine = await emp.get('/api/notifications').expect(200);
    expect(mine.body.items.some((n: { title: string; link: string }) => n.title.includes('recorded 1 day of Casual leave for you') && n.link === '/app/leave')).toBe(true);
    const mgr = await login(app, 'manager@futuristglobal.com');
    const theirs = await mgr.get('/api/notifications').expect(200);
    expect(theirs.body.items.some((n: { title: string; link: string }) => n.title.includes('recorded Casual leave for') && n.link === '/app/leave?tab=team')).toBe(true);
  });

  it('approves leave for the only admin, who has nobody to approve it', async () => {
    await prisma.user.updateMany({ where: { organizationId: other.org.id, id: { not: other.users.super_admin.id } }, data: { status: 'DEACTIVATED' } });
    const t = await prisma.leaveType.create({ data: { organizationId: other.org.id, code: 'CL', name: 'Casual leave', annualAllowance: 4 } });
    const admin = await login(app, 'super_admin@acme.test');
    const r = await admin.post('/api/leave/requests').send({ typeId: t.id, startDate: DAY, endDate: DAY }).expect(201);
    expect(r.body.status).toBe('APPROVED');
  });
});

describe('working on a day off', () => {
  it('flags attendance on a weekend or company holiday, and nobody is "not checked in" on a day off', async () => {
    const at = (d: string) => new Date(`${d}T04:00:00Z`);
    for (const d of [SAT, TUE, MON]) await prisma.attendanceRecord.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, location: 'WFO', date: new Date(`${d}T00:00:00Z`), checkInAt: at(d), checkOutAt: new Date(at(d).getTime() + 4 * 3600_000) } });
    const emp = await login(app, 'employee@futuristglobal.com');
    const h = await emp.get(`/api/attendance/me?from=${MON}&to=${SUN}`).expect(200);
    const byDate = Object.fromEntries(h.body.items.map((i: { date: string; dayOff: boolean }) => [i.date, i.dayOff]));
    expect(byDate).toEqual({ [SAT]: true, [TUE]: true, [MON]: false }); // TUE is the company holiday created above
    expect(h.body.summary.dayOffWorked).toBe(2);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const b = await hr.get(`/api/attendance/board?date=${SUN}`).expect(200);
    expect(b.body).toMatchObject({ isWorkingDay: false, totals: { notCheckedIn: 0 } });
  });
});

describe('leave day breakdown', () => {
  const NEXT_MON = '2030-01-14';
  const setSandwich = async (on: boolean) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: fg.org.id } });
    const s = org.settings as { leave?: Record<string, unknown> };
    await prisma.organization.update({ where: { id: fg.org.id }, data: { settings: { ...s, leave: { ...(s.leave ?? {}), countDaysOffInside: on } } } });
  };

  it('splits a range into leave days, weekly days off and holidays; the sandwich rule counts days off inside', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    // Mon 7 → Mon 14: Tue is the company holiday, Sat/Sun are days off
    const p = await emp.post('/api/leave/preview').send({ typeId: casual.id, startDate: MON, endDate: NEXT_MON }).expect(200);
    expect(p.body).toEqual({ days: 5, calendarDays: 8, workingDays: 5, weekends: 2, holidays: [{ date: TUE, name: 'Founders day' }], sandwichDays: 0 });

    await setSandwich(true);
    const s = await emp.post('/api/leave/preview').send({ typeId: casual.id, startDate: MON, endDate: NEXT_MON }).expect(200);
    expect(s.body).toMatchObject({ days: 8, sandwichDays: 3 });
    // Days off at the edges are never counted: Sat → Mon is just Monday
    const edge = await emp.post('/api/leave/preview').send({ typeId: casual.id, startDate: SAT, endDate: NEXT_MON }).expect(200);
    expect(edge.body).toMatchObject({ days: 1, sandwichDays: 0 });
    await setSandwich(false);
  });
});
