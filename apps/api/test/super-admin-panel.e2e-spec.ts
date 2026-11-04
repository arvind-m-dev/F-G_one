import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, login, makeOrg, mfaFields, PASSWORD, resetDb } from './helpers';

/** Phase 3: data behind the Super Admins page, the nominee's acceptance page and the Overview's access section. */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let acme: Awaited<ReturnType<typeof makeOrg>>;
const tokenOf = (url: string) => decodeURIComponent(url.split('token=')[1]!);

async function addUser(org: { id: string }, email: string, roleId: string, extra: Record<string, unknown> = {}) {
  const src = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } });
  return prisma.user.create({ data: { organizationId: org.id, email, firstName: email.split('@')[0]!, lastName: 'T', roleId, status: 'ACTIVE', passwordHash: src.passwordHash, ...extra } });
}

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  acme = await makeOrg(prisma, 'acme', 'acme.test');
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('Super Admins page data', () => {
  it('lists each Super Admin with two-step status, whether the authority works, and counts', async () => {
    // A flagged Super Admin without two-step verification: counted, but dormant.
    const dormant = await addUser(fg.org, 'dormant.sa@futuristglobal.com', fg.roles.administrator.id, { isSuperAdmin: true });
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const inv = (await sa.post('/api/super-admins/invitations').send({ userId: fg.users.hr_admin.id, password: PASSWORD }).expect(201)).body;
    const list = (await sa.get('/api/super-admins').expect(200)).body;
    expect(list).toMatchObject({ limit: 4, hardLimit: 4, activeCount: 2, pendingCount: 1, used: 3 });
    const me = list.superAdmins.find((s: { id: string }) => s.id === fg.users.super_admin.id);
    expect(me).toMatchObject({ isYou: true, mfaEnabled: true, authorityActive: true, email: 'super_admin@futuristglobal.com', status: 'ACTIVE' });
    expect(list.superAdmins.find((s: { id: string }) => s.id === dormant.id)).toMatchObject({ isYou: false, mfaEnabled: false, authorityActive: false });
    expect(list.pending).toHaveLength(1);
    expect(list.pending[0]).toMatchObject({ id: inv.id, person: { id: fg.users.hr_admin.id, email: 'hr_admin@futuristglobal.com', mfaEnabled: false }, invitedBy: { id: fg.users.super_admin.id } });
    // Nothing secret leaks into the list.
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|mfaSecretEnc|tokenHash/);
    await sa.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(200);
    await prisma.user.delete({ where: { id: dormant.id } });
  });

  it('the nominee can look at their own nomination without accepting it; nobody else learns anything', async () => {
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const inv = (await sa.post('/api/super-admins/invitations').send({ userId: fg.users.manager.id, password: PASSWORD }).expect(201)).body;
    const token = tokenOf(inv.url);

    const mgr = await login(app, 'manager@futuristglobal.com');
    const seen = (await mgr.post('/api/super-admins/invitations/check').send({ token }).expect(200)).body;
    expect(seen).toMatchObject({ invitedBy: { id: fg.users.super_admin.id }, mfaEnabled: false, limitReached: false });
    expect(new Date(seen.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Looking does not accept.
    expect(await prisma.user.findUniqueOrThrow({ where: { id: fg.users.manager.id } })).toMatchObject({ isSuperAdmin: false });

    // Same 404 for someone else's link, an unknown link, and another tenant.
    const emp = await login(app, 'employee@futuristglobal.com');
    const other = await emp.post('/api/super-admins/invitations/check').send({ token }).expect(404);
    const unknown = await mgr.post('/api/super-admins/invitations/check').send({ token: 'not-a-real-token-123' }).expect(404);
    expect(other.body.message).toBe(unknown.body.message);
    await sa.post('/api/super-admins/invitations/check').send({ token }).expect(404); // the nominator is not the nominee
    const acmeSa = await login(app, 'super_admin@acme.test');
    await acmeSa.post('/api/super-admins/invitations/check').send({ token }).expect(404);
    await request(app.getHttpServer()).post('/api/super-admins/invitations/check').send({ token }).expect(401);
    await mgr.post('/api/super-admins/invitations/check').send({}).expect(400);

    // Once two-step verification is on, the page knows the nominee can accept.
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: mfaFields() });
    const mgr2 = await login(app, 'manager@futuristglobal.com');
    expect((await mgr2.post('/api/super-admins/invitations/check').send({ token }).expect(200)).body.mfaEnabled).toBe(true);

    // Withdrawn links stop working for the check too.
    await sa.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(200);
    await mgr2.post('/api/super-admins/invitations/check').send({ token }).expect(404);
  });

  it('the limit can be changed by a Super Admin only, never below the Super Admins who hold it, and is audited', async () => {
    const adm = await addUser(fg.org, 'plain.admin@futuristglobal.com', fg.roles.administrator.id);
    const a = await login(app, 'plain.admin@futuristglobal.com');
    await a.patch('/api/organization').send({ settings: { security: { superAdminLimit: 2 } } }).expect(403);

    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { isSuperAdmin: true } });
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const low = await sa.patch('/api/organization').send({ settings: { security: { superAdminLimit: 1 } } }).expect(409);
    expect(low.body.message).toMatch(/already 2 Super Admins/);
    const ok = (await sa.patch('/api/organization').send({ settings: { security: { superAdminLimit: 2 } } }).expect(200)).body;
    expect(ok.settings.security.superAdminLimit).toBe(2);
    expect((await sa.get('/api/super-admins').expect(200)).body).toMatchObject({ limit: 2, used: 2 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: fg.org.id, action: 'superadmin.limit_changed' } });
    expect(log.metadata).toMatchObject({ from: 4, to: 2 });
    // Other settings still save while the limit stays where it is.
    await sa.patch('/api/organization').send({ settings: { auth: { sessionTtlHours: 72 } } }).expect(200);

    await sa.patch('/api/organization').send({ settings: { security: { superAdminLimit: 4 } } }).expect(200);
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { isSuperAdmin: false, mfaSecretEnc: null, mfaEnabledAt: null } });
    await prisma.user.delete({ where: { id: adm.id } });
  });
});

describe('Overview: access and security', () => {
  it('summarises account states, locked accounts and admins without two-step verification, per tenant', async () => {
    const locked = await addUser(fg.org, 'locked.person@futuristglobal.com', fg.roles.employee.id, { lockedUntil: new Date(Date.now() + 10 * 60_000), failedLogins: 5 });
    await addUser(fg.org, 'suspended.person@futuristglobal.com', fg.roles.employee.id, { status: 'SUSPENDED' });
    await addUser(fg.org, 'gone.person@futuristglobal.com', fg.roles.employee.id, { status: 'DEACTIVATED' });
    await addUser(fg.org, 'waiting.person@futuristglobal.com', fg.roles.employee.id, { status: 'INVITED', passwordHash: null });
    const hrWithMfa = await addUser(fg.org, 'secure.hr@futuristglobal.com', fg.roles.hr_admin.id, mfaFields());
    // Data in another tenant never shows up.
    await addUser(acme.org, 'locked.acme@acme.test', acme.roles.administrator.id, { lockedUntil: new Date(Date.now() + 10 * 60_000) });

    const sa = await login(app, 'super_admin@futuristglobal.com');
    const access = (await sa.get('/api/admin/overview').expect(200)).body.access;
    expect(access.accounts).toMatchObject({ active: 6, suspended: 1, deactivated: 1, archived: 0, waitingForPassword: 1 });
    expect(access.suspended.map((p: { name: string }) => p.name)).toEqual(['suspended.person T']);
    expect(access.locked.count).toBe(1);
    expect(access.locked.people[0]).toMatchObject({ id: locked.id });
    // hr_admin (HR role, no code) is an admin without two-step verification; the employee, the manager and HR with a code are not.
    const noMfa = access.adminsWithoutMfa.people.map((p: { id: string }) => p.id);
    expect(noMfa).toEqual([fg.users.hr_admin.id]);
    expect(noMfa).not.toContain(hrWithMfa.id);
    expect(access.adminsWithoutMfa.people[0]).toMatchObject({ roleName: 'Admin / HR', isSuperAdmin: false });
    expect(access.superAdmins).toEqual({ active: 1, pending: 0, used: 1, limit: 4 });
    expect(JSON.stringify(access)).not.toMatch(/acme|passwordHash|mfaSecretEnc/);
  });

  it('a permission override that grants admin access counts; Super Admin numbers are for Super Admins only', async () => {
    await prisma.userPermissionOverride.create({ data: { organizationId: fg.org.id, userId: fg.users.employee.id, permission: 'audit.view', effect: 'ALLOW', scope: 'ORG' } });
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const access = (await hr.get('/api/admin/overview').expect(200)).body.access;
    expect(access.superAdmins).toBeNull();
    expect(access.adminsWithoutMfa.people.map((p: { id: string }) => p.id).sort()).toEqual([fg.users.employee.id, fg.users.hr_admin.id].sort());
    await prisma.userPermissionOverride.deleteMany({ where: { userId: fg.users.employee.id } });
  });

  it('is not shown to people who do not manage accounts', async () => {
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.get('/api/admin/overview').expect(403);
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.get('/api/admin/overview').expect(403);
    // Analytics alone (no account management) gets the overview without the access section.
    await prisma.userPermissionOverride.create({ data: { organizationId: fg.org.id, userId: fg.users.manager.id, permission: 'dashboard.view_org', effect: 'ALLOW', scope: 'ORG' } });
    const mgr2 = await login(app, 'manager@futuristglobal.com');
    expect((await mgr2.get('/api/admin/overview').expect(200)).body.access).toBeNull();
    await prisma.userPermissionOverride.deleteMany({ where: { userId: fg.users.manager.id } });
  });
});
