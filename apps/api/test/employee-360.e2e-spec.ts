import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

/** Admin employee page: one person's full picture, and changing their work email. */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;
let administrator: { id: string };

async function cloneUser(email: string, roleId: string, extra: Record<string, unknown> = {}) {
  const src = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } });
  return prisma.user.create({ data: { organizationId: fg.org.id, email, firstName: email.split('@')[0]!, lastName: 'T', roleId, status: 'ACTIVE', passwordHash: src.passwordHash, ...extra } });
}
const ageSessions = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) } });

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  administrator = await cloneUser('administrator@futuristglobal.com', fg.roles.administrator.id);
  await prisma.user.update({ where: { id: fg.users.employee.id }, data: { managerId: fg.users.manager.id } });
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('GET /employees/:id/overview', () => {
  it('HR sees everything about someone below their rank', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/attendance/check-in').send({ location: 'WFH' }).expect((r) => expect([200, 201]).toContain(r.status));
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.patch(`/api/employees/${fg.users.employee.id}`).send({ designation: 'Analyst' }).expect(200);

    const res = await hr.get(`/api/employees/${fg.users.employee.id}/overview`).expect(200);
    const o = res.body;
    expect(o.employee).toMatchObject({ id: fg.users.employee.id, email: 'employee@futuristglobal.com', designation: 'Analyst' });
    expect(o.employee.manager.id).toBe(fg.users.manager.id);
    expect(o.employee).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(o)).not.toMatch(/passwordHash|mfaSecret|\$argon2/);
    expect(o.access.role.key).toBe('employee');
    expect(o.access.grants['employees.view']).toBe('ORG');
    expect(o.access.grants['employees.create']).toBeUndefined();
    expect(o.account).toMatchObject({ isSuperAdmin: false, mfaEnabled: false, mustChangePassword: false, hasPassword: true, status: 'ACTIVE' });
    expect(o.attendance.items).toHaveLength(1);
    expect(o.attendance.timezone).toBeTruthy();
    expect(o.attendance.summary.daysPresent).toBe(1);
    expect(Array.isArray(o.leave.balances)).toBe(true);
    expect(Array.isArray(o.leave.requests)).toBe(true);
    expect(o.sessions.length).toBeGreaterThanOrEqual(1);
    expect(o.activity.some((a: { action: string }) => a.action === 'employee.updated')).toBe(true); // target
    expect(o.activity.some((a: { action: string; actorId: string }) => a.action === 'auth.login' && a.actorId === fg.users.employee.id)).toBe(true); // actor

    const mgr = (await hr.get(`/api/employees/${fg.users.manager.id}/overview`).expect(200)).body;
    expect(mgr.employee.reports.map((r: { id: string }) => r.id)).toContain(fg.users.employee.id);
  });

  it('HR cannot open an Administrator or a Super Admin; people without employees.manage cannot open anyone', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.get(`/api/employees/${administrator.id}/overview`).expect(403);
    await hr.get(`/api/employees/${fg.users.super_admin.id}/overview`).expect(403);
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.get(`/api/employees/${fg.users.employee.id}/overview`).expect(403);
    const adm = await login(app, 'administrator@futuristglobal.com');
    await adm.get(`/api/employees/${fg.users.super_admin.id}/overview`).expect(403);
    await adm.get(`/api/employees/${fg.users.hr_admin.id}/overview`).expect(200);
  });

  it('a Super Admin can open anyone, including themselves', async () => {
    const sa = await login(app, 'super_admin@futuristglobal.com');
    for (const id of [administrator.id, fg.users.hr_admin.id, fg.users.employee.id, fg.users.super_admin.id]) {
      await sa.get(`/api/employees/${id}/overview`).expect(200);
    }
    const me = (await sa.get(`/api/employees/${fg.users.super_admin.id}/overview`).expect(200)).body;
    expect(me.account).toMatchObject({ isSuperAdmin: true, superAdminActive: true, mfaEnabled: true });
    expect(me.access.grants['roles.manage']).toBe('ORG');
    expect(me.sessions.some((s: { current: boolean }) => s.current)).toBe(true);
  });

  it('other organizations get 404', async () => {
    const acme = await login(app, 'super_admin@acme.test');
    await acme.get(`/api/employees/${fg.users.employee.id}/overview`).expect(404);
    await acme.post(`/api/employees/${fg.users.employee.id}/email`).send({ email: 'stolen@acme.test' }).expect(404);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.get(`/api/employees/${other.users.employee.id}/overview`).expect(404);
  });
});

describe('POST /employees/:id/email', () => {
  it('changes the email, signs the person out everywhere and is audited', async () => {
    const target = await cloneUser('rename.me@futuristglobal.com', fg.roles.employee.id);
    const emp = await login(app, 'rename.me@futuristglobal.com');
    await emp.get('/api/auth/me').expect(200);

    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const res = await hr.post(`/api/employees/${target.id}/email`).send({ email: '  Renamed.Person@FuturistGlobal.com ' }).expect(200);
    expect(res.body.email).toBe('renamed.person@futuristglobal.com');

    await emp.get('/api/auth/me').expect(401);
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'employee.email_changed', entityId: target.id } });
    expect(log.actorId).toBe(fg.users.hr_admin.id);
    expect(log.metadata).toEqual({ from: 'rename.me@futuristglobal.com', to: 'renamed.person@futuristglobal.com' });

    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'rename.me@futuristglobal.com', password: PASSWORD }).expect(401);
    await login(app, 'renamed.person@futuristglobal.com');
  });

  it('enforces company domain, uniqueness and validation', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const id = fg.users.employee.id;
    expect((await hr.post(`/api/employees/${id}/email`).send({ email: 'someone@gmail.com' }).expect(400)).body.message).toMatch(/company domain/);
    await hr.post(`/api/employees/${id}/email`).send({ email: 'manager@futuristglobal.com' }).expect(409);
    await hr.post(`/api/employees/${id}/email`).send({ email: 'employee@futuristglobal.com' }).expect(400);
    await hr.post(`/api/employees/${id}/email`).send({ email: 'not-an-email' }).expect(400);
    // Another tenant's address is taken too: emails are unique across FG One.
    await prisma.organization.update({ where: { id: fg.org.id }, data: { settings: { auth: { allowedEmailDomains: ['futuristglobal.com', 'acme.test'] } } } });
    await hr.post(`/api/employees/${id}/email`).send({ email: 'employee@acme.test' }).expect(409);
    await prisma.organization.update({ where: { id: fg.org.id }, data: { settings: { auth: { allowedEmailDomains: ['futuristglobal.com'] } } } });
  });

  it('follows rank and Super Admin authority, and nobody changes their own email here', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/employees/${administrator.id}/email`).send({ email: 'adm2@futuristglobal.com' }).expect(403);
    await hr.post(`/api/employees/${fg.users.super_admin.id}/email`).send({ email: 'sa2@futuristglobal.com' }).expect(403);
    await hr.post(`/api/employees/${fg.users.hr_admin.id}/email`).send({ email: 'hr2@futuristglobal.com' }).expect(400);
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post(`/api/employees/${fg.users.employee.id}/email`).send({ email: 'x1@futuristglobal.com' }).expect(403);
    const adm = await login(app, 'administrator@futuristglobal.com');
    await adm.post(`/api/employees/${fg.users.super_admin.id}/email`).send({ email: 'sa2@futuristglobal.com' }).expect(403);
    const sa = await login(app, 'super_admin@futuristglobal.com');
    await sa.post(`/api/employees/${administrator.id}/email`).send({ email: 'administrator2@futuristglobal.com' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: administrator.id } })).email).toBe('administrator2@futuristglobal.com');
  });

  it('requires a recent sign-in', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await ageSessions(fg.users.hr_admin.id);
    const res = await hr.post(`/api/employees/${fg.users.manager.id}/email`).send({ email: 'mgr2@futuristglobal.com' }).expect(403);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
    await hr.post('/api/auth/reauth').send({ password: PASSWORD }).expect(200);
    await hr.post(`/api/employees/${fg.users.manager.id}/email`).send({ email: 'mgr2@futuristglobal.com' }).expect(200);
  });
});
