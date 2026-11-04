import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io } from 'socket.io-client';
import { DEFAULT_ROLE_GRANTS } from '@fg/shared';
import { createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

/** Super Admin Phase 3: suspend, archive and restore accounts; manage one person's access with escalation guards. */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;
let seq = 0;

/** A fresh ACTIVE person with the seed password, so each test owns its target. */
async function person(roleKey = 'employee', extra: Record<string, unknown> = {}) {
  const src = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } });
  seq += 1;
  return prisma.user.create({
    data: { organizationId: fg.org.id, email: `p${seq}.${Date.now()}@futuristglobal.com`, firstName: `Person${seq}`, lastName: 'T', roleId: fg.roles[roleKey]!.id, status: 'ACTIVE', passwordHash: src.passwordHash, ...extra },
  });
}
const ageSessions = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) } });
const lastAudit = (action: string, entityId: string) => prisma.auditLog.findFirst({ where: { action, entityId }, orderBy: { createdAt: 'desc' } });

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('suspend and unsuspend', () => {
  it('signs them out at once (old session 401, socket closed), blocks sign-in, and is reversible', async () => {
    const p = await person();
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: p.email, password: PASSWORD }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const socket = io(`http://localhost:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const closed = new Promise<string>((resolve) => socket.once('disconnect', (reason) => resolve(reason)));
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);

    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const s = await hr.post(`/api/employees/${p.id}/suspend`).send({ reason: 'Laptop reported stolen' }).expect(200);
    expect(s.body.status).toBe('SUSPENDED');
    expect(await closed).toBe('io server disconnect');
    socket.close();
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: p.email, password: PASSWORD }).expect(403);
    expect(await prisma.session.count({ where: { userId: p.id } })).toBe(0);

    const audit = await lastAudit('employee.suspended', p.id);
    expect(audit?.metadata).toMatchObject({ reason: 'Laptop reported stolen', from: 'ACTIVE' });
    const o = (await hr.get(`/api/employees/${p.id}/overview`).expect(200)).body;
    expect(o.account).toMatchObject({ status: 'SUSPENDED', suspensionReason: 'Laptop reported stolen' });
    expect(o.account.suspendedAt).toBeTruthy();

    // Listed under Suspended for admins; hidden from colleagues.
    const list = (await hr.get('/api/employees?status=SUSPENDED&pageSize=100').expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toContain(p.id);
    const colleague = await login(app, 'employee@futuristglobal.com');
    const dir = (await colleague.get('/api/employees?status=ALL&pageSize=100').expect(200)).body;
    expect(dir.items.map((x: { id: string }) => x.id)).not.toContain(p.id);
    await colleague.get(`/api/employees/${p.id}`).expect(404);

    await hr.post(`/api/employees/${p.id}/suspend`).send({}).expect(400); // already suspended
    const u = await hr.post(`/api/employees/${p.id}/unsuspend`).expect(200);
    expect(u.body.status).toBe('ACTIVE');
    expect((await lastAudit('employee.unsuspended', p.id))?.metadata).toMatchObject({ to: 'ACTIVE' });
    await login(app, p.email);
    await hr.post(`/api/employees/${p.id}/unsuspend`).expect(400); // not suspended
  });

  it('applies the authority rules', async () => {
    const p = await person();
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/employees/${fg.users.hr_admin.id}/suspend`).send({}).expect(403); // yourself
    await hr.post(`/api/employees/${fg.users.super_admin.id}/suspend`).send({}).expect(403); // Super Admin
    const admin = await person('administrator');
    await hr.post(`/api/employees/${admin.id}/suspend`).send({}).expect(403); // higher rank
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post(`/api/employees/${p.id}/suspend`).send({}).expect(403); // no employees.manage
    await hr.post(`/api/employees/${other.users.employee.id}/suspend`).send({}).expect(404); // other tenant
    await hr.post(`/api/employees/${other.users.employee.id}/unsuspend`).expect(404);

    // A Super Admin target needs their authority removed first, even for another Super Admin.
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const sa2 = await person('administrator', { isSuperAdmin: true });
    const r = await sa.post(`/api/employees/${sa2.id}/suspend`).send({}).expect(403);
    expect(r.body.message).toMatch(/Super Admin authority/);

    // Suspending needs a recent sign-in.
    await ageSessions(fg.users.hr_admin.id);
    const stale = await hr.post(`/api/employees/${p.id}/suspend`).send({}).expect(403);
    expect(stale.body.code).toBe('REAUTH_REQUIRED');
  });
});

describe('archive and restore', () => {
  it('archives only deactivated accounts, hides them from lists and pickers, and restores to deactivated', async () => {
    const p = await person();
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/employees/${p.id}/archive`).expect(400); // still active
    await hr.post(`/api/employees/${p.id}/deactivate`).expect(200);
    const a = await hr.post(`/api/employees/${p.id}/archive`).expect(200);
    expect(a.body.status).toBe('ARCHIVED');
    expect(await lastAudit('employee.archived', p.id)).toBeTruthy();
    await hr.post(`/api/employees/${p.id}/archive`).expect(400); // already archived
    await hr.post(`/api/employees/${p.id}/deactivate`).expect(400);
    await hr.post(`/api/employees/${p.id}/activate`).expect(400); // restore first

    const all = (await hr.get('/api/employees?status=ALL&pageSize=100').expect(200)).body;
    expect(all.items.map((x: { id: string }) => x.id)).not.toContain(p.id);
    const archived = (await hr.get('/api/employees?status=ARCHIVED&pageSize=100').expect(200)).body;
    expect(archived.items.map((x: { id: string }) => x.id)).toContain(p.id);
    await hr.get(`/api/employees/${p.id}`).expect(200); // history stays reachable for admins
    await hr.patch(`/api/employees/${fg.users.employee.id}`).send({ managerId: p.id }).expect(400); // not a pickable manager
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: p.email, password: PASSWORD }).expect(403);
    await hr.put(`/api/employees/${p.id}/access`).send({ extraRoleIds: [], overrides: [] }).expect(400);

    await ageSessions(fg.users.hr_admin.id);
    expect((await hr.post(`/api/employees/${fg.users.employee.id}/archive`).expect(403)).body.code).toBe('REAUTH_REQUIRED');

    const r = await hr.post(`/api/employees/${p.id}/restore`).expect(200);
    expect(r.body.status).toBe('DEACTIVATED');
    expect(await lastAudit('employee.restored', p.id)).toBeTruthy();
    await hr.post(`/api/employees/${p.id}/restore`).expect(400);
    await hr.post(`/api/employees/${p.id}/activate`).expect(200);
    await login(app, p.email);

    // Other tenants and yourself.
    const fresh = await login(app, 'hr_admin@futuristglobal.com');
    await fresh.post(`/api/employees/${other.users.employee.id}/archive`).expect(404);
    await fresh.post(`/api/employees/${other.users.employee.id}/restore`).expect(404);
    await fresh.post(`/api/employees/${fg.users.hr_admin.id}/archive`).expect(403);
  });
});

describe('access for one person', () => {
  it('HR sees and changes access within their own; the change applies on the next request and is audited', async () => {
    const p = await person();
    const them = await login(app, p.email);
    expect((await them.get('/api/auth/me').expect(200)).body.permissions).not.toContain('announcements.manage');
    await them.get('/api/employees').expect(200);

    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const before = (await hr.get(`/api/employees/${p.id}/access`).expect(200)).body;
    expect(before).toMatchObject({ roleId: fg.roles.employee.id, extraRoleIds: [], overrides: [], editable: true });
    expect(before.grants['employees.view']).toBe('ORG');

    const put = await hr
      .put(`/api/employees/${p.id}/access`)
      .send({
        extraRoleIds: [fg.roles.manager.id],
        overrides: [
          { permission: 'announcements.publish', effect: 'ALLOW', scope: 'ORG' },
          { permission: 'employees.view', effect: 'DENY' },
        ],
      })
      .expect(200);
    expect(put.body.extraRoleIds).toEqual([fg.roles.manager.id]);
    expect(put.body.grants['announcements.publish']).toBe('ORG');
    expect(put.body.grants['leave.approve']).toBe('TEAM');
    expect(put.body.grants['employees.view']).toBeUndefined();

    // Next request, same session: DENY removed the directory, ALLOW added announcements.
    const me = (await them.get('/api/auth/me').expect(200)).body;
    expect(me.permissions).toContain('announcements.manage');
    expect(me.permissions).toContain('leave.approve');
    expect(me.permissions).not.toContain('employees.read');
    await them.get('/api/employees').expect(403);

    const audit = await lastAudit('employee.access_changed', p.id);
    expect(audit?.metadata).toMatchObject({
      extraRoles: { added: ['manager'], removed: [] },
      overrides: { added: [{ permission: 'announcements.publish', effect: 'ALLOW', scope: 'ORG' }, { permission: 'employees.view', effect: 'DENY', scope: null }] },
    });

    // Removing everything gives the directory back. A no-op save writes no audit entry.
    await hr.put(`/api/employees/${p.id}/access`).send({ extraRoleIds: [], overrides: [] }).expect(200);
    await them.get('/api/employees').expect(200);
    const count = await prisma.auditLog.count({ where: { action: 'employee.access_changed', entityId: p.id } });
    await hr.put(`/api/employees/${p.id}/access`).send({ extraRoleIds: [], overrides: [] }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'employee.access_changed', entityId: p.id } })).toBe(count);
  });

  it('blocks escalation: sensitive or unheld permissions, higher roles, own access, Super Admins', async () => {
    const p = await person();
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    for (const permission of ['roles.manage', 'settings.configure', 'audit.view']) {
      const r = await hr.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission, effect: 'ALLOW', scope: 'ORG' }] }).expect(403);
      expect(r.body.message).toMatch(/can't allow/);
    }
    await hr.put(`/api/employees/${p.id}/access`).send({ roleId: fg.roles.administrator.id }).expect(403);
    await hr.put(`/api/employees/${p.id}/access`).send({ extraRoleIds: [fg.roles.administrator.id] }).expect(403);
    await hr.put(`/api/employees/${p.id}/access`).send({ extraRoleIds: [fg.roles.hr_admin.id] }).expect(403); // same rank
    await hr.put(`/api/employees/${fg.users.hr_admin.id}/access`).send({ overrides: [] }).expect(403); // own access
    await hr.put(`/api/employees/${fg.users.super_admin.id}/access`).send({ overrides: [] }).expect(403);
    await hr.get(`/api/employees/${fg.users.super_admin.id}/access`).expect(403);
    const own = (await hr.get(`/api/employees/${fg.users.hr_admin.id}/access`).expect(200)).body;
    expect(own.editable).toBe(false);
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.put(`/api/employees/${p.id}/access`).send({ overrides: [] }).expect(403);
    expect(await prisma.userPermissionOverride.count({ where: { userId: p.id } })).toBe(0);

    // Invalid input: unknown permission, unsupported scope, duplicates.
    await hr.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'nuclear.launch', effect: 'ALLOW' }] }).expect(400);
    await hr.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'attendance.view', effect: 'ALLOW', scope: 'OWN' }] }).expect(400);
    await hr.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'ai.use', effect: 'DENY' }, { permission: 'ai.use', effect: 'ALLOW' }] }).expect(400);

    // A Super Admin may give sensitive permissions.
    const sa = await login(app, 'super_admin@futuristglobal.com');
    await sa.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'audit.view', effect: 'ALLOW', scope: 'ORG' }] }).expect(200);
    // HR can keep that exception while changing something else, and can take it away, but cannot re-add it.
    const kept = await hr
      .put(`/api/employees/${p.id}/access`)
      .send({ overrides: [{ permission: 'audit.view', effect: 'ALLOW', scope: 'ORG' }, { permission: 'ai.use', effect: 'DENY' }] })
      .expect(200);
    expect(kept.body.grants['audit.view']).toBe('ORG');
    await hr.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'ai.use', effect: 'DENY' }] }).expect(200);
    await hr.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'audit.view', effect: 'ALLOW', scope: 'ORG' }] }).expect(403);

    // Changing access needs a recent sign-in.
    await ageSessions(fg.users.hr_admin.id);
    expect((await hr.put(`/api/employees/${p.id}/access`).send({ overrides: [] }).expect(403)).body.code).toBe('REAUTH_REQUIRED');
  });

  it('enforces the scope ceiling and removing a block the caller could not give', async () => {
    // A people-ops lead who manages employees but only sees their own team's attendance.
    const lead = await prisma.role.create({
      data: {
        organizationId: fg.org.id,
        key: 'people_lead',
        name: 'People lead',
        rank: 60,
        grants: { create: [...DEFAULT_ROLE_GRANTS.employee!, { permission: 'employees.create', scope: 'ORG' }, { permission: 'employees.edit', scope: 'ORG' }, { permission: 'employees.deactivate', scope: 'ORG' }, { permission: 'attendance.view', scope: 'TEAM' }] },
      },
    });
    const actor = await person('employee', { roleId: lead.id });
    const p = await person();
    const a = await login(app, actor.email);
    const narrow = await a.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'attendance.view', effect: 'ALLOW', scope: 'ORG' }] }).expect(403);
    expect(narrow.body.message).toMatch(/their team/);
    await a.put(`/api/employees/${p.id}/access`).send({ overrides: [{ permission: 'attendance.view', effect: 'ALLOW', scope: 'TEAM' }] }).expect(200);
    // The Manager role includes leave approval, which the lead does not hold.
    await a.put(`/api/employees/${p.id}/access`).send({ extraRoleIds: [fg.roles.manager.id] }).expect(403);

    // A manager blocked from approving leave: the lead may not lift that block (they don't hold leave.approve).
    const m = await person('manager');
    const sa = await login(app, 'super_admin@futuristglobal.com');
    await sa.put(`/api/employees/${m.id}/access`).send({ overrides: [{ permission: 'leave.approve', effect: 'DENY' }] }).expect(200);
    const lift = await a.put(`/api/employees/${m.id}/access`).send({ overrides: [] }).expect(403);
    expect(lift.body.message).toMatch(/more access than you have/);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.put(`/api/employees/${m.id}/access`).send({ overrides: [] }).expect(200);
  });

  it('keeps tenants apart', async () => {
    const p = await person();
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.get(`/api/employees/${other.users.employee.id}/access`).expect(404);
    await hr.put(`/api/employees/${other.users.employee.id}/access`).send({ overrides: [] }).expect(404);
    await hr.put(`/api/employees/${p.id}/access`).send({ roleId: other.roles.employee.id }).expect(400);
    await hr.put(`/api/employees/${p.id}/access`).send({ extraRoleIds: [other.roles.manager.id] }).expect(400);
    expect(await prisma.userRole.count({ where: { userId: p.id } })).toBe(0);
  });
});

describe('account creation with access', () => {
  it('creates the person, extra roles and exceptions together, with the same guards', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const base = { firstName: 'Wiz', lastName: 'Ard', roleId: fg.roles.employee.id, password: 'Wizard-Pass-2026' };
    const res = await hr
      .post('/api/employees')
      .send({ ...base, email: 'wizard@futuristglobal.com', extraRoleIds: [fg.roles.manager.id], overrides: [{ permission: 'announcements.publish', effect: 'ALLOW', scope: 'ORG' }] })
      .expect(201);
    const id = res.body.employee.id;
    const access = (await hr.get(`/api/employees/${id}/access`).expect(200)).body;
    expect(access.extraRoleIds).toEqual([fg.roles.manager.id]);
    expect(access.overrides).toMatchObject([{ permission: 'announcements.publish', effect: 'ALLOW', scope: 'ORG' }]);
    const them = await login(app, 'wizard@futuristglobal.com', 'Wizard-Pass-2026');
    expect((await them.get('/api/auth/me').expect(200)).body.permissions).toEqual(expect.arrayContaining(['announcements.manage', 'leave.approve']));
    expect((await lastAudit('employee.created', id))?.metadata).toMatchObject({ extraRoles: ['manager'] });

    // Guards: nothing is created when any part is refused.
    await hr.post('/api/employees').send({ ...base, email: 'wizard2@futuristglobal.com', overrides: [{ permission: 'roles.manage', effect: 'ALLOW' }] }).expect(403);
    await hr.post('/api/employees').send({ ...base, email: 'wizard2@futuristglobal.com', extraRoleIds: [fg.roles.administrator.id] }).expect(403);
    await hr.post('/api/employees').send({ ...base, email: 'wizard2@futuristglobal.com', extraRoleIds: [other.roles.manager.id] }).expect(400);
    expect(await prisma.user.count({ where: { email: 'wizard2@futuristglobal.com' } })).toBe(0);

    // Extra access at creation needs a recent sign-in; a plain account does not.
    await ageSessions(fg.users.hr_admin.id);
    const stale = await hr.post('/api/employees').send({ ...base, email: 'wizard3@futuristglobal.com', overrides: [{ permission: 'ai.use', effect: 'DENY' }] }).expect(403);
    expect(stale.body.code).toBe('REAUTH_REQUIRED');
    await hr.post('/api/employees').send({ ...base, email: 'wizard3@futuristglobal.com' }).expect(201);
  });
});
