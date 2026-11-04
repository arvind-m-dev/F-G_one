import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp, login, makeOrg, mfaFields, PASSWORD, resetDb } from './helpers';

/** Phase 2b: Super Admin authority is a protected flag, separate from roles. */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;
let adminRoleUser: { id: string };

async function cloneUser(email: string, roleId: string, extra: Record<string, unknown> = {}) {
  const src = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } });
  return prisma.user.create({ data: { organizationId: fg.org.id, email, firstName: email.split('@')[0]!, lastName: 'T', roleId, status: 'ACTIVE', passwordHash: src.passwordHash, ...extra } });
}
const tokenOf = (url: string) => decodeURIComponent(url.split('token=')[1]!);

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  adminRoleUser = await cloneUser('administrator@futuristglobal.com', fg.roles.administrator.id);
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('Super Admin authority', () => {
  it('holding the Administrator role (all permissions) does not make you a Super Admin', async () => {
    const adm = await login(app, 'administrator@futuristglobal.com');
    const me = (await adm.get('/api/auth/me').expect(200)).body;
    expect(me.isSuperAdmin).toBe(false);
    expect(me.grants['roles.manage']).toBe('ORG');
    await adm.get('/api/super-admins').expect(403);
    await adm.post('/api/super-admins/invitations').send({ userId: adminRoleUser.id, password: PASSWORD }).expect(403);
    await adm.post(`/api/super-admins/${fg.users.super_admin.id}/remove`).send({ password: PASSWORD }).expect(403);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.get('/api/super-admins').expect(403);
  });

  it('only a Super Admin can manage a Super Admin account, and not through employee screens', async () => {
    const adm = await login(app, 'administrator@futuristglobal.com');
    await adm.patch(`/api/employees/${fg.users.super_admin.id}`).send({ designation: 'Hijacked' }).expect(403);
    await adm.post(`/api/employees/${fg.users.super_admin.id}/deactivate`).expect(403);
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const me = (await sa.get('/api/auth/me').expect(200)).body;
    expect(me.isSuperAdmin).toBe(true);
    await sa.post(`/api/employees/${fg.users.super_admin.id}/deactivate`).expect(403); // own account
    const sa2 = await cloneUser('sa2@futuristglobal.com', fg.roles.employee.id, { isSuperAdmin: true });
    const res = await sa.post(`/api/employees/${sa2.id}/deactivate`).expect(403);
    expect(res.body.message).toMatch(/Super Admin authority first/);
    await prisma.user.update({ where: { id: sa2.id }, data: { isSuperAdmin: false } });
  });

  it('nobody can set the password of an account above them (takeover guard)', async () => {
    const pending = await prisma.user.create({ data: { organizationId: fg.org.id, email: 'pending.admin@futuristglobal.com', firstName: 'P', lastName: 'A', roleId: fg.roles.administrator.id, status: 'INVITED' } });
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/employees/${pending.id}/password`).send({ password: 'Takeover-Pass-2026' }).expect(403);
    await hr.post(`/api/employees/${fg.users.super_admin.id}/password`).send({ password: 'Takeover-Pass-2026' }).expect(403);
    const sa = await login(app, 'super_admin@futuristglobal.com');
    await sa.post(`/api/employees/${pending.id}/password`).send({ password: 'Activate-Pass-2026' }).expect(200);
  });

  it('a Super Admin signed in with a temporary admin-set password has no Super Admin authority', async () => {
    await prisma.user.update({ where: { id: fg.users.super_admin.id }, data: { mustChangePassword: true } });
    const sa = await login(app, 'super_admin@futuristglobal.com');
    expect((await sa.get('/api/super-admins').expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await sa.get('/api/auth/me').expect(200)).body.isSuperAdmin).toBe(false);
    await prisma.user.update({ where: { id: fg.users.super_admin.id }, data: { mustChangePassword: false } });
  });

  it('invite → accept flow with password confirmation, and the limit counts pending invitations', async () => {
    await prisma.organization.update({ where: { id: fg.org.id }, data: { settings: { auth: { allowedEmailDomains: ['futuristglobal.com'] }, security: { superAdminLimit: 2 } } } });
    const sa = await login(app, 'super_admin@futuristglobal.com');
    await sa.post('/api/super-admins/invitations').send({ userId: fg.users.manager.id, password: 'wrong-password' }).expect(403);
    const inv = (await sa.post('/api/super-admins/invitations').send({ userId: fg.users.manager.id, password: PASSWORD }).expect(201)).body;
    // 1 active + 1 pending = limit 2
    const full = await sa.post('/api/super-admins/invitations').send({ userId: fg.users.hr_admin.id, password: PASSWORD }).expect(409);
    expect(full.body.message).toMatch(/limit/);
    const list = (await sa.get('/api/super-admins').expect(200)).body;
    expect(list).toMatchObject({ limit: 2, used: 2 });

    // Someone else cannot use the link; the nominee needs their own password.
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/super-admins/invitations/accept').send({ token: tokenOf(inv.url), password: PASSWORD }).expect(404);
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post('/api/super-admins/invitations/accept').send({ token: tokenOf(inv.url), password: 'nope-nope' }).expect(403);
    // Super Admins must use two-step verification: no acceptance without it.
    const noMfa = await mgr.post('/api/super-admins/invitations/accept').send({ token: tokenOf(inv.url), password: PASSWORD }).expect(403);
    expect(noMfa.body.code).toBe('MFA_SETUP_REQUIRED');
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: mfaFields() });
    await mgr.post('/api/super-admins/invitations/accept').send({ token: tokenOf(inv.url), password: PASSWORD }).expect(200);
    await mgr.post('/api/super-admins/invitations/accept').send({ token: tokenOf(inv.url), password: PASSWORD }).expect(404); // single use
    expect((await mgr.get('/api/auth/me').expect(200)).body.isSuperAdmin).toBe(true);
    await mgr.get('/api/super-admins').expect(200);
  });

  it('revoked invitations free a slot and stop working', async () => {
    await prisma.organization.update({ where: { id: fg.org.id }, data: { settings: { auth: { allowedEmailDomains: ['futuristglobal.com'] }, security: { superAdminLimit: 3 } } } });
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const inv = (await sa.post('/api/super-admins/invitations').send({ userId: fg.users.hr_admin.id, password: PASSWORD }).expect(201)).body;
    await sa.post('/api/super-admins/invitations').send({ userId: adminRoleUser.id, password: PASSWORD }).expect(409);
    await sa.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(200);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/super-admins/invitations/accept').send({ token: tokenOf(inv.url), password: PASSWORD }).expect(404);
    // another tenant's Super Admin cannot see or revoke it
    const acme = await login(app, 'super_admin@acme.test');
    await acme.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(404);
    await acme.post(`/api/super-admins/${fg.users.manager.id}/remove`).send({ password: PASSWORD }).expect(404);
  });

  it('nobody changes their own authority; removal is password-confirmed and audited', async () => {
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post(`/api/super-admins/${fg.users.manager.id}/remove`).send({ password: PASSWORD }).expect(403);
    const sa = await login(app, 'super_admin@futuristglobal.com');
    await sa.post(`/api/super-admins/${fg.users.manager.id}/remove`).send({ password: 'wrong-password' }).expect(403);
    await sa.post(`/api/super-admins/${fg.users.manager.id}/remove`).send({ password: PASSWORD }).expect(200);
    await mgr.get('/api/super-admins').expect(403); // takes effect on the next request
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: fg.org.id, action: { startsWith: 'superadmin.' } } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['superadmin.invited', 'superadmin.accepted', 'superadmin.invite_revoked', 'superadmin.removed', 'superadmin.reauth_failed']));
  });

  it('two Super Admins removing each other at the same time cannot leave zero', async () => {
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { isSuperAdmin: true } });
    const a = await login(app, 'super_admin@futuristglobal.com');
    const b = await login(app, 'manager@futuristglobal.com');
    const [ra, rb] = await Promise.all([
      a.post(`/api/super-admins/${fg.users.manager.id}/remove`).send({ password: PASSWORD }),
      b.post(`/api/super-admins/${fg.users.super_admin.id}/remove`).send({ password: PASSWORD }),
    ]);
    expect([ra.status, rb.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1);
    expect(await prisma.user.count({ where: { organizationId: fg.org.id, isSuperAdmin: true, status: 'ACTIVE' } })).toBeGreaterThanOrEqual(1);
  });

  it('only a Super Admin can change security settings', async () => {
    const adm = await login(app, 'administrator@futuristglobal.com');
    await adm.patch('/api/organization').send({ settings: { security: { superAdminLimit: 4 } } }).expect(403);
    await adm.patch('/api/organization').send({ settings: { auth: { sessionTtlHours: 100 } } }).expect(200);
    const sa = (await prisma.user.findFirstOrThrow({ where: { organizationId: fg.org.id, isSuperAdmin: true, status: 'ACTIVE' } })).email;
    const s = await login(app, sa);
    await s.patch('/api/organization').send({ settings: { security: { superAdminLimit: 4 } } }).expect(200);
    await s.patch('/api/organization').send({ settings: { security: { superAdminLimit: 9 } } }).expect(400); // above the hard limit
  });
});

describe('account status and type', () => {
  it('a suspended user is signed out immediately and cannot sign in', async () => {
    const u = await cloneUser('suspend.me@futuristglobal.com', fg.roles.employee.id);
    const s = await login(app, 'suspend.me@futuristglobal.com');
    await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
    await s.get('/api/auth/me').expect(401);
    await (await import('supertest')).default.agent(app.getHttpServer()).post('/api/auth/login').send({ email: 'suspend.me@futuristglobal.com', password: PASSWORD }).expect(403);
  });

  it('client accounts are denied every internal route and hold no internal grants', async () => {
    const c = await cloneUser('client.person@futuristglobal.com', fg.roles.administrator.id, { accountType: 'CLIENT', isSuperAdmin: true });
    const s = await login(app, 'client.person@futuristglobal.com');
    const me = (await s.get('/api/auth/me').expect(200)).body;
    expect(me).toMatchObject({ isSuperAdmin: false, accountType: 'CLIENT', grants: {}, permissions: [] });
    for (const path of ['/api/employees', '/api/channels', '/api/attendance/today', '/api/leave/balances', '/api/notifications', '/api/announcements', '/api/super-admins', '/api/search?q=a']) {
      await s.get(path).expect(403);
    }
    expect(c.id).toBeTruthy();
    void other;
  });
});
