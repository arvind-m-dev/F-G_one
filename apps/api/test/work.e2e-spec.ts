import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { addDays, localDate } from '../src/common/tz';
import { createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let dev2: { id: string };
let outsider: { id: string };
let projectId: string;

const today = localDate('Asia/Kolkata');
const soon = addDays(today, 7); // inside the ten-working-day planning window
const later = addDays(today, 60);

type Agent = Awaited<ReturnType<typeof login>>;
let admin: Agent, hr: Agent, mgr: Agent, emp: Agent, d2: Agent, acme: Agent;

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  await makeOrg(prisma, 'acme', 'acme.test');
  const passwordHash = await hash(PASSWORD);
  const base = { organizationId: fg.org.id, roleId: fg.roles.employee!.id, status: 'ACTIVE' as const, passwordHash };
  dev2 = await prisma.user.create({ data: { ...base, email: 'dev2@futuristglobal.com', firstName: 'Ravi', lastName: 'Dev', managerId: fg.users.manager!.id } });
  outsider = await prisma.user.create({ data: { ...base, email: 'outsider@futuristglobal.com', firstName: 'Out', lastName: 'Sider' } });
  await prisma.user.update({ where: { id: fg.users.employee!.id }, data: { managerId: fg.users.manager!.id } });
  ({ app } = await createApp());
  admin = await login(app, 'super_admin@futuristglobal.com');
  hr = await login(app, 'hr_admin@futuristglobal.com');
  mgr = await login(app, 'manager@futuristglobal.com');
  emp = await login(app, 'employee@futuristglobal.com');
  d2 = await login(app, 'dev2@futuristglobal.com');
  acme = await login(app, 'super_admin@acme.test');
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('projects', () => {
  it('managers create projects; members see them; others and other companies do not', async () => {
    await emp.post('/api/work/projects').send({ name: 'Website', key: 'WEB' }).expect(403);
    const p = await mgr
      .post('/api/work/projects')
      .send({ name: 'Website', key: 'web', memberIds: [fg.users.employee!.id, dev2.id], targetDate: later })
      .expect(201);
    projectId = p.body.id;
    expect(p.body).toMatchObject({ key: 'WEB', lead: { id: fg.users.manager!.id }, can: { manage: true } });
    // The lead is always a member.
    expect(p.body.members.map((m: { id: string }) => m.id).sort()).toEqual([fg.users.manager!.id, fg.users.employee!.id, dev2.id].sort());
    await mgr.post('/api/work/projects').send({ name: 'Web again', key: 'WEB' }).expect(409);
    await mgr.post('/api/work/projects').send({ name: 'Bad', key: 'w' }).expect(400);
    await mgr.post('/api/work/projects').send({ name: 'Stranger', key: 'STR', memberIds: ['nobody'] }).expect(400);

    expect((await emp.get('/api/work/projects').expect(200)).body).toHaveLength(1);
    expect((await emp.get(`/api/work/projects/${projectId}`).expect(200)).body.can.manage).toBe(false);
    // HR plans their own team only, and is not on this project.
    expect((await hr.get('/api/work/projects').expect(200)).body).toHaveLength(0);
    await hr.get(`/api/work/projects/${projectId}`).expect(404);
    // Company-wide planners see everything.
    expect((await admin.get('/api/work/projects').expect(200)).body).toHaveLength(1);
    // Another company: invisible.
    expect((await acme.get('/api/work/projects').expect(200)).body).toHaveLength(0);
    await acme.get(`/api/work/projects/${projectId}`).expect(404);
    await acme.patch(`/api/work/projects/${projectId}`).send({ name: 'Hijacked' }).expect(404);

    await emp.patch(`/api/work/projects/${projectId}`).send({ name: 'Mine now' }).expect(403);
    const renamed = await mgr.patch(`/api/work/projects/${projectId}`).send({ name: 'Website relaunch' }).expect(200);
    expect(renamed.body.name).toBe('Website relaunch');
    const audit = await prisma.auditLog.findMany({ where: { organizationId: fg.org.id, entityType: 'project' } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['project.created', 'project.updated']));
  });
});

describe('tasks', () => {
  let taskId: string;

  it('numbers project tasks, notifies the owner and enforces who may assign to whom', async () => {
    const t = await mgr.post('/api/work/tasks').send({ title: 'Design the home page', projectId, assigneeId: fg.users.employee!.id, size: 'L', dueDate: later }).expect(201);
    taskId = t.body.id;
    expect(t.body).toMatchObject({ ref: 'WEB-1', status: 'TODO', remainingDays: 5, assignee: { id: fg.users.employee!.id }, can: { manage: true } });
    const note = await prisma.notification.findFirst({ where: { userId: fg.users.employee!.id, type: 'work' }, orderBy: { createdAt: 'desc' } });
    expect(note).toMatchObject({ title: 'New task for you: Design the home page', link: `/app/work?task=${taskId}` });

    // Not on the project: cannot be given its tasks.
    await mgr.post('/api/work/tasks').send({ title: 'Stray', projectId, assigneeId: outsider.id }).expect(400);
    // Other company's project.
    await acme.post('/api/work/tasks').send({ title: 'Stray', projectId }).expect(404);
    // A member may add work for themselves or leave it unassigned, but not hand it to a colleague.
    const own = await emp.post('/api/work/tasks').send({ title: 'Write copy', projectId, assigneeId: fg.users.employee!.id, size: 'S' }).expect(201);
    expect(own.body.ref).toBe('WEB-2');
    expect((await emp.post('/api/work/tasks').send({ title: 'Someone should test this', projectId }).expect(201)).body.assignee).toBeNull();
    await emp.post('/api/work/tasks').send({ title: 'For Ravi', projectId, assigneeId: dev2.id }).expect(403);
    // Personal tasks: yours by default; only a manager can give one to a direct report.
    const personal = await emp.post('/api/work/tasks').send({ title: 'Renew passport' }).expect(201);
    expect(personal.body).toMatchObject({ ref: null, project: null, assignee: { id: fg.users.employee!.id } });
    await emp.post('/api/work/tasks').send({ title: 'For Ravi', assigneeId: dev2.id }).expect(403);
    await mgr.post('/api/work/tasks').send({ title: 'Read the handbook', assigneeId: dev2.id }).expect(201);
    await mgr.post('/api/work/tasks').send({ title: 'Not my report', assigneeId: outsider.id }).expect(403);
    await mgr.post('/api/work/tasks').send({ title: 'Backwards', startDate: later, dueDate: soon }).expect(400);
  });

  it('shows each person only the tasks they should see', async () => {
    const mine = await emp.get('/api/work/tasks?scope=mine').expect(200);
    expect(mine.body.map((t: { title: string }) => t.title).sort()).toEqual(['Design the home page', 'Renew passport', 'Write copy']);
    // A project colleague sees project tasks, not personal ones.
    const colleague = await d2.get('/api/work/tasks?scope=all').expect(200);
    expect(colleague.body.map((t: { title: string }) => t.title)).not.toContain('Renew passport');
    expect(colleague.body.map((t: { title: string }) => t.title)).toContain('Design the home page');
    // The manager sees their reports' personal tasks.
    const team = await mgr.get('/api/work/tasks?scope=team').expect(200);
    expect(team.body.map((t: { title: string }) => t.title)).toContain('Renew passport');
    // Outside the project and the reporting line: nothing, and 404 by id.
    expect((await hr.get('/api/work/tasks?scope=all').expect(200)).body).toHaveLength(0);
    await hr.get(`/api/work/tasks/${taskId}`).expect(404);
    await acme.get(`/api/work/tasks/${taskId}`).expect(404);
    await acme.patch(`/api/work/tasks/${taskId}`).send({ status: 'DONE' }).expect(404);
    expect((await mgr.get(`/api/work/tasks?scope=all&projectId=${projectId}&assigneeId=none`).expect(200)).body).toHaveLength(1);
    expect((await mgr.get('/api/work/tasks?scope=all&q=home').expect(200)).body).toHaveLength(1);
  });

  it('lets the owner move their work along but keeps dates and ownership with the lead', async () => {
    const started = await emp.patch(`/api/work/tasks/${taskId}`).send({ status: 'IN_PROGRESS', links: [{ label: 'Pull request', url: 'https://github.com/acme/web/pull/12' }] }).expect(200);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', remainingDays: 3, links: [{ label: 'Pull request', url: 'https://github.com/acme/web/pull/12' }] });
    await emp.patch(`/api/work/tasks/${taskId}`).send({ links: [{ label: 'x', url: 'javascript:alert(1)' }] }).expect(400);
    expect((await emp.patch(`/api/work/tasks/${taskId}`).send({ dueDate: addDays(later, 5) }).expect(403)).body.message).toMatch(/Ask for more time/);
    await emp.patch(`/api/work/tasks/${taskId}`).send({ assigneeId: dev2.id }).expect(403);
    await emp.patch(`/api/work/tasks/${taskId}`).send({ size: 'XS' }).expect(403);
    // A colleague on the project can read and comment, not change.
    await d2.patch(`/api/work/tasks/${taskId}`).send({ status: 'DONE' }).expect(403);
    await d2.post(`/api/work/tasks/${taskId}/comments`).send({ body: 'I can review this.' }).expect(201);
    await d2.post(`/api/work/tasks/${taskId}/comments`).send({ body: ' ' }).expect(400);
    await d2.delete(`/api/work/tasks/${taskId}`).expect(403);

    const detail = await emp.get(`/api/work/tasks/${taskId}`).expect(200);
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.activity.map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(['created', 'status']));
    expect(detail.body.can).toEqual({ manage: false, update: true, request: true });

    const done = await emp.patch(`/api/work/tasks/${taskId}`).send({ status: 'DONE' }).expect(200);
    expect(done.body.completedAt).toBeTruthy();
    expect((await emp.patch(`/api/work/tasks/${taskId}`).send({ status: 'IN_PROGRESS' }).expect(200)).body.completedAt).toBeNull();
  });
});

describe('asking for more time', () => {
  let taskId: string;
  beforeAll(async () => {
    taskId = (await mgr.post('/api/work/tasks').send({ title: 'Build the checkout', projectId, assigneeId: fg.users.employee!.id, size: 'M', dueDate: soon }).expect(201)).body.id;
  });

  it('offers a realistic date and colleagues, and routes the request to the project lead', async () => {
    const relief = await emp.get(`/api/work/tasks/${taskId}/relief`).expect(200);
    expect(relief.body).toMatchObject({ dueDate: soon, remainingDays: 2, approvers: [{ id: fg.users.manager!.id }] });
    expect(relief.body.candidates.map((c: { userId: string }) => c.userId).sort()).toEqual([fg.users.manager!.id, dev2.id].sort());
    await d2.get(`/api/work/tasks/${taskId}/relief`).expect(403);

    await emp.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'MOVE_DATE', reason: 'short' }).expect(400);
    await emp.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'MOVE_DATE', reason: 'The payment API changed', proposedDueDate: soon }).expect(400);
    await d2.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'MOVE_DATE', reason: 'Not my task at all', proposedDueDate: later }).expect(403);
    const r = await emp.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'MOVE_DATE', reason: 'The payment API changed', proposedDueDate: addDays(soon, 5) }).expect(201);
    expect(r.body).toMatchObject({ status: 'PENDING', previousDueDate: soon, proposedDueDate: addDays(soon, 5), can: { decide: false, cancel: true } });
    expect(r.body.rationale).toMatch(/of work due in the next two weeks/);
    await emp.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'MOVE_DATE', reason: 'Asking twice', proposedDueDate: later }).expect(409);
    expect((await emp.get(`/api/work/tasks/${taskId}`).expect(200)).body.can.request).toBe(false);

    const note = await prisma.notification.findFirst({ where: { userId: fg.users.manager!.id, type: 'work' }, orderBy: { createdAt: 'desc' } });
    expect(note).toMatchObject({ link: '/app/approvals?tab=work' });
    expect((await mgr.get('/api/approvals/count').expect(200)).body).toMatchObject({ canApprove: true, work: 1 });
    expect((await d2.get('/api/approvals/count').expect(200)).body.work).toBe(0);
    expect((await mgr.get('/api/work/requests?scope=approvals&status=PENDING').expect(200)).body).toHaveLength(1);
    expect((await d2.get('/api/work/requests?scope=approvals').expect(200)).body).toHaveLength(0);

    // Never your own; invisible to people who cannot decide; hidden from other companies.
    await emp.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    await d2.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'APPROVED' }).expect(404);
    await acme.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'APPROVED' }).expect(404);

    const ok = await mgr.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'APPROVED', note: 'Fine, keep me posted' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'APPROVED', decider: { id: fg.users.manager!.id } });
    await mgr.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'REJECTED' }).expect(409);
    expect((await emp.get(`/api/work/tasks/${taskId}`).expect(200)).body.dueDate).toBe(addDays(soon, 5));
    expect(await prisma.auditLog.count({ where: { organizationId: fg.org.id, action: 'work_request.approved' } })).toBe(1);
  });

  it('hands a task over when the lead picks someone, and lets the owner withdraw a request', async () => {
    const r = await emp.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'REASSIGN', reason: 'I am on the release this week' }).expect(201);
    // Only people on the project can be proposed.
    await emp.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'REASSIGN', reason: 'Pick an outsider', proposedAssigneeId: outsider.id }).expect(400);
    await mgr.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'APPROVED' }).expect(400);
    await mgr.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'APPROVED', assigneeId: outsider.id }).expect(400);
    await mgr.post(`/api/work/requests/${r.body.id}/decision`).send({ decision: 'APPROVED', assigneeId: dev2.id }).expect(200);
    const t = await d2.get(`/api/work/tasks/${taskId}`).expect(200);
    expect(t.body.assignee.id).toBe(dev2.id);
    expect(await prisma.notification.count({ where: { userId: dev2.id, type: 'work', title: 'New task for you: Build the checkout' } })).toBe(1);

    // Withdraw, and decline.
    const again = await d2.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'MOVE_DATE', reason: 'Need two more days', proposedDueDate: addDays(soon, 9) }).expect(201);
    await emp.post(`/api/work/requests/${again.body.id}/cancel`).expect(404);
    await d2.post(`/api/work/requests/${again.body.id}/cancel`).expect(200);
    await d2.post(`/api/work/requests/${again.body.id}/cancel`).expect(409);
    const third = await d2.post(`/api/work/tasks/${taskId}/requests`).send({ kind: 'MOVE_DATE', reason: 'Need two more days', proposedDueDate: addDays(soon, 9) }).expect(201);
    await mgr.post(`/api/work/requests/${third.body.id}/decision`).send({ decision: 'REJECTED', note: 'The launch date is fixed' }).expect(200);
    expect((await d2.get(`/api/work/tasks/${taskId}`).expect(200)).body.dueDate).toBe(addDays(soon, 5));
    expect((await d2.get('/api/work/requests?scope=mine&status=DECLINED').expect(200)).body).toHaveLength(1);
  });
});

describe('workload, suggestions and the daily report', () => {
  it('spots an overloaded person and proposes someone with room', async () => {
    // Start clean: only the tasks below count.
    await prisma.task.deleteMany({ where: { organizationId: fg.org.id } });
    const big: string[] = [];
    for (const title of ['Search', 'Payments', 'Accounts']) {
      big.push((await mgr.post('/api/work/tasks').send({ title, projectId, assigneeId: fg.users.employee!.id, size: 'L', dueDate: soon }).expect(201)).body.id);
    }
    await mgr.post('/api/work/tasks').send({ title: 'Fix a typo', projectId, assigneeId: dev2.id, size: 'XS', dueDate: soon }).expect(201);

    await emp.get('/api/work/workload').expect(403);
    const w = await mgr.get(`/api/work/workload?projectId=${projectId}`).expect(200);
    const row = (id: string) => w.body.people.find((p: { person: { id: string } }) => p.person.id === id);
    expect(row(fg.users.employee!.id).load).toMatchObject({ demandDays: 15, level: 'over', openTasks: 3 });
    expect(row(fg.users.employee!.id).load.lateTasks).toBeGreaterThan(0);
    expect(row(dev2.id).load).toMatchObject({ demandDays: 0.5, level: 'light' });
    const move = w.body.suggestions.find((s: { kind: string }) => s.kind === 'REASSIGN');
    expect(move).toMatchObject({ from: { id: fg.users.employee!.id } });
    expect(big).toContain(move.task.id);
    expect([dev2.id, fg.users.manager!.id]).toContain(move.to.id);

    // The employee's own view says the same.
    const s = await emp.get('/api/work/summary').expect(200);
    expect(s.body).toMatchObject({ load: { level: 'over' }, counts: { open: 3 }, can: { plan: false, createProject: false } });
    expect((await mgr.get('/api/work/summary').expect(200)).body.can).toMatchObject({ plan: true, createProject: true, reach: 'TEAM' });

    // Applying a suggestion is an ordinary task update by someone who manages the task.
    await mgr.patch(`/api/work/tasks/${move.task.id}`).send({ assigneeId: move.to.id }).expect(200);
    const after = await mgr.get(`/api/work/workload?projectId=${projectId}`).expect(200);
    expect(after.body.people.find((p: { person: { id: string } }) => p.person.id === fg.users.employee!.id).load.demandDays).toBe(10);

    // Approved leave shrinks the days available.
    const type = await prisma.leaveType.create({ data: { organizationId: fg.org.id, code: 'CL', name: 'Casual leave', annualAllowance: 10 } });
    await prisma.leaveRequest.create({ data: { organizationId: fg.org.id, userId: dev2.id, typeId: type.id, startDate: new Date(`${today}T00:00:00Z`), endDate: new Date(`${addDays(today, 30)}T00:00:00Z`), days: 20, status: 'APPROVED' } });
    const away = await mgr.get(`/api/work/workload?projectId=${projectId}`).expect(200);
    expect(away.body.people.find((p: { person: { id: string } }) => p.person.id === dev2.id).load.availableDays).toBe(0);
  });

  it('reports what was finished and what is at risk', async () => {
    const list = await emp.get('/api/work/tasks?scope=mine').expect(200);
    await emp.patch(`/api/work/tasks/${list.body[0].id}`).send({ status: 'IN_PROGRESS' }).expect(200);
    await emp.patch(`/api/work/tasks/${list.body[0].id}`).send({ status: 'DONE' }).expect(200);
    await emp.patch(`/api/work/tasks/${list.body[1].id}`).send({ status: 'IN_PROGRESS' }).expect(200);
    const r = await mgr.get('/api/work/report').expect(200);
    expect(r.body).toMatchObject({ date: today, totals: { done: 1, started: 1 } });
    expect(r.body.done[0].id).toBe(list.body[0].id);
    expect(r.body.people.find((p: { person: { id: string } }) => p.person.id === fg.users.employee!.id)).toMatchObject({ done: 1, started: 1, open: 1 });
    // An employee gets a report about themselves only.
    const own = await emp.get('/api/work/report').expect(200);
    expect(own.body.people.map((p: { person: { id: string } }) => p.person.id)).toEqual([fg.users.employee!.id]);
    await mgr.get(`/api/work/report?date=${addDays(today, 1)}`).expect(400);
    await mgr.get('/api/work/report?date=nonsense').expect(400);
  });

  it('keeps history: members with open work stay, projects with tasks are archived not deleted', async () => {
    const stuck = await mgr.patch(`/api/work/projects/${projectId}`).send({ memberIds: [dev2.id] }).expect(409);
    expect(stuck.body.message).toMatch(/still has open tasks/);
    await mgr.delete(`/api/work/projects/${projectId}`).expect(409);
    await mgr.patch(`/api/work/projects/${projectId}`).send({ status: 'ARCHIVED' }).expect(200);
    await mgr.post('/api/work/tasks').send({ title: 'Too late', projectId }).expect(409);
    const empty = await mgr.post('/api/work/projects').send({ name: 'Scratch', key: 'TMP' }).expect(201);
    await emp.delete(`/api/work/projects/${empty.body.id}`).expect(404);
    await mgr.delete(`/api/work/projects/${empty.body.id}`).expect(200);
  });
});
