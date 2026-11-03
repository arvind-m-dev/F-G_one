import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp, login, makeOrg, resetDb } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  // manager → employee reporting line for team views
  await prisma.user.update({ where: { id: fg.users.employee.id }, data: { managerId: fg.users.manager.id } });
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('attendance', () => {
  it('enforces the check-in → break → check-out lifecycle', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    let t = await emp.get('/api/attendance/today').expect(200);
    expect(t.body.record).toBeNull();
    await emp.post('/api/attendance/break/start').expect(400); // must check in first
    await emp.post('/api/attendance/check-out').send({}).expect(400);
    await emp.post('/api/attendance/check-in').send({ location: 'MOON' }).expect(400);

    t = await emp.post('/api/attendance/check-in').send({ location: 'WFH', remarks: 'Plumber visit' }).expect(200);
    expect(t.body.record).toMatchObject({ state: 'working', location: 'WFH', remarks: 'Plumber visit' });
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(409); // no duplicates

    t = await emp.post('/api/attendance/break/start').expect(200);
    expect(t.body.record.state).toBe('on_break');
    await emp.post('/api/attendance/break/start').expect(409);
    t = await emp.post('/api/attendance/break/end').expect(200);
    expect(t.body.record.state).toBe('working');
    expect(t.body.record.breaks).toHaveLength(1);
    await emp.post('/api/attendance/break/end').expect(400);

    await emp.post('/api/attendance/break/start').expect(200);
    t = await emp.post('/api/attendance/check-out').send({ remarks: 'Done for today' }).expect(200);
    expect(t.body.record.state).toBe('checked_out');
    expect(t.body.record.breaks.every((b: { endAt: string | null }) => b.endAt)).toBe(true); // open break closed
    await emp.post('/api/attendance/check-out').send({}).expect(400);
    await emp.post('/api/attendance/check-in').send({ location: 'WFO' }).expect(409);

    const hist = await emp.get('/api/attendance/me').expect(200);
    expect(hist.body.items).toHaveLength(1);
    expect(hist.body.summary.home).toBe(1);
  });

  it('presence changes never touch attendance', async () => {
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.put('/api/me/status').send({ presence: 'wfh' }).expect(200);
    expect(await prisma.attendanceRecord.count({ where: { userId: fg.users.manager.id } })).toBe(0);
  });

  it('team board: employees forbidden, managers see reports only, HR sees everyone, other tenants nothing', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.get('/api/attendance/board').expect(403);
    await emp.get(`/api/attendance/users/${fg.users.manager.id}`).expect(403);

    const mgr = await login(app, 'manager@futuristglobal.com');
    const team = await mgr.get('/api/attendance/board').expect(200);
    expect(team.body.rows.map((r: { person: { id: string } }) => r.person.id)).toEqual([fg.users.employee.id]);
    expect(team.body.totals.checkedOut).toBe(1);
    await mgr.get(`/api/attendance/users/${fg.users.employee.id}`).expect(200);
    await mgr.get(`/api/attendance/users/${fg.users.hr_admin.id}`).expect(403);

    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const all = await hr.get('/api/attendance/board').expect(200);
    expect(all.body.totals.employees).toBe(4);
    expect(all.body.totals.notCheckedIn).toBe(3);

    const acme = await login(app, 'super_admin@acme.test');
    const theirs = await acme.get('/api/attendance/board').expect(200);
    expect(theirs.body.rows.every((r: { person: { id: string } }) => !Object.values(fg.users).some((u) => u.id === r.person.id))).toBe(true);
    await acme.get(`/api/attendance/users/${fg.users.employee.id}`).expect(403);
  });

  it('exports CSV with formula injection neutralised', async () => {
    await prisma.attendanceRecord.updateMany({ where: { userId: fg.users.employee.id }, data: { remarks: '=HYPERLINK("http://evil")' } });
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const res = await hr.get('/api/attendance/export').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Date,Employee,Email');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")`);
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.get('/api/attendance/export').expect(403);
  });
});

describe('announcements', () => {
  let id: string;
  it('only announcement managers publish; audience gets notified; acknowledgements tracked', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/announcements').send({ title: 'Nope', body: 'x' }).expect(403);

    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/announcements').send({ title: 'x', body: '' }).expect(400);
    const a = await hr.post('/api/announcements').send({ title: 'New leave policy', body: 'Read it please', category: 'POLICY', requireAck: true }).expect(201);
    id = a.body.id;

    // notification delivered (async)
    await new Promise((r) => setTimeout(r, 300));
    const notes = await emp.get('/api/notifications').expect(200);
    expect(notes.body.items.some((n: { type: string; title: string }) => n.type === 'announcement' && n.title.includes('New leave policy'))).toBe(true);

    const list = await emp.get('/api/announcements').expect(200);
    expect(list.body.find((x: { id: string }) => x.id === id).acknowledgedAt).toBeNull();
    await emp.post(`/api/announcements/${id}/ack`).expect(200);
    await emp.post(`/api/announcements/${id}/ack`).expect(200); // idempotent
    const after = await emp.get(`/api/announcements/${id}`).expect(200);
    expect(after.body.acknowledgedAt).not.toBeNull();
    expect(after.body.ackCount).toBe(1);

    await emp.get(`/api/announcements/${id}/acks`).expect(403);
    const acks = await hr.get(`/api/announcements/${id}/acks`).expect(200);
    expect(acks.body.acknowledged.map((u: { id: string }) => u.id)).toEqual([fg.users.employee.id]);
    expect(acks.body.pending.length).toBe(3);
  });

  it('department announcements are hidden from other departments and other tenants', async () => {
    const dept = await prisma.department.create({ data: { organizationId: fg.org.id, name: 'QA' } });
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const a = await hr.post('/api/announcements').send({ title: 'QA only', body: 'Regression tonight', departmentId: dept.id }).expect(201);
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.get(`/api/announcements/${a.body.id}`).expect(404);
    const acme = await login(app, 'super_admin@acme.test');
    await acme.get(`/api/announcements/${id}`).expect(404);
    await acme.post(`/api/announcements/${id}/ack`).expect(404);
    await acme.delete(`/api/announcements/${id}`).expect(404);
  });
});

describe('notifications', () => {
  it('DMs, mentions and thread replies notify the right people; DMs group; preferences respected', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post('/api/notifications/read').send({ all: true }).expect(200);

    const dm = await emp.post('/api/dm').send({ userIds: [fg.users.manager.id] }).expect(200);
    await emp.post(`/api/channels/${dm.body.id}/messages`).send({ body: 'hi' }).expect(201);
    await emp.post(`/api/channels/${dm.body.id}/messages`).send({ body: 'are you there?' }).expect(201);
    await new Promise((r) => setTimeout(r, 300));
    let n = await mgr.get('/api/notifications?filter=unread').expect(200);
    const dmNotes = n.body.items.filter((x: { type: string }) => x.type === 'dm');
    expect(dmNotes).toHaveLength(1);
    expect(dmNotes[0].count).toBe(2);

    const root = await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'hello @manager and @nobody' }).expect(201);
    await mgr.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'reply', parentId: root.body.id }).expect(201);
    await new Promise((r) => setTimeout(r, 300));
    n = await mgr.get('/api/notifications?filter=mentions').expect(200);
    expect(n.body.items.some((x: { type: string }) => x.type === 'mention')).toBe(true);
    const empNotes = await emp.get('/api/notifications?filter=mentions').expect(200);
    expect(empNotes.body.items.some((x: { type: string }) => x.type === 'thread')).toBe(true);

    // turn DMs off
    await mgr.patch('/api/me/preferences').send({ notifications: { dm: false } }).expect(200);
    await mgr.post('/api/notifications/read').send({ all: true }).expect(200);
    await emp.post(`/api/channels/${dm.body.id}/messages`).send({ body: 'third' }).expect(201);
    await new Promise((r) => setTimeout(r, 300));
    const c = await mgr.get('/api/notifications/unread-count').expect(200);
    expect(c.body.unread).toBe(0);

    // users only read their own notifications
    const ids = (await emp.get('/api/notifications').expect(200)).body.items.map((x: { id: string }) => x.id);
    await mgr.post('/api/notifications/read').send({ ids }).expect(200);
    const still = await emp.get('/api/notifications/unread-count').expect(200);
    expect(still.body.unread).toBeGreaterThan(0);
  });
});
