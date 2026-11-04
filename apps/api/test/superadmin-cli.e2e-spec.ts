import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { organizationSettingsSchema } from '@fg/shared';
import { bootstrapSuperAdmin } from '../prisma/bootstrap';
import { RefusedError } from '../prisma/operator';
import { recoverSuperAdmin } from '../prisma/recover';
import { verifyPassword } from '../src/auth/password';
import { createApp, login, makeOrg, mfaFields, resetDb } from './helpers';

/** Phase 2d: operator CLIs (superadmin:bootstrap, superadmin:recover), run as functions against the test database. */
const prisma = new PrismaClient();
let app: INestApplication;
let bootPassword = '';
const quiet = () => undefined;
const BOOT = { ORG_SLUG: 'launch-co', ORG_NAME: 'Launch Co', ORG_DOMAIN: 'launch.test', ADMIN_EMAIL: 'it@launch.test', ADMIN_FIRST: 'IT', ADMIN_LAST: 'Admin' };

beforeAll(async () => {
  await resetDb(prisma);
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('superadmin:bootstrap', () => {
  it('refuses without CONFIRM_BOOTSTRAP=yes and changes nothing', async () => {
    await expect(bootstrapSuperAdmin(prisma, BOOT, [], quiet)).rejects.toThrow(RefusedError);
    await expect(bootstrapSuperAdmin(prisma, { ...BOOT, CONFIRM_BOOTSTRAP: 'true' }, [], quiet)).rejects.toThrow(/CONFIRM_BOOTSTRAP=yes/);
    expect(await prisma.organization.count({ where: { slug: 'launch-co' } })).toBe(0);
    expect(await prisma.user.count({ where: { email: 'it@launch.test' } })).toBe(0);
  });

  it('refuses an email outside the company domain or a weak supplied password', async () => {
    await expect(bootstrapSuperAdmin(prisma, { ...BOOT, ADMIN_EMAIL: 'it@gmail.com', CONFIRM_BOOTSTRAP: 'yes' }, [], quiet)).rejects.toThrow(/company domain/);
    await expect(bootstrapSuperAdmin(prisma, { ...BOOT, ADMIN_PASSWORD: 'short', CONFIRM_BOOTSTRAP: 'yes' }, [], quiet)).rejects.toThrow(/too weak/);
    expect(await prisma.organization.count({ where: { slug: 'launch-co' } })).toBe(0);
  });

  it('creates the organization and a Super Admin with a one-time password; the second run is a no-op', async () => {
    const lines: string[] = [];
    const res = await bootstrapSuperAdmin(prisma, { ...BOOT, CONFIRM_BOOTSTRAP: 'yes' }, [], (l) => lines.push(l));
    if (res.status !== 'created') throw new Error('expected created');
    expect(res.organizationCreated).toBe(true);
    expect(res.passwordGenerated).toBe(true);
    expect(res.password).toMatch(/^[\w]{5}-[\w]{5}-[\w]{5}-[\w]{5}$/);
    expect(lines.join('\n')).toContain(res.password);
    bootPassword = res.password;

    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'launch-co' }, include: { roles: true, channels: true, leaveTypes: true } });
    expect(org.roles.map((r) => r.key)).toContain('administrator');
    expect(org.channels.map((c) => c.name).sort()).toEqual(['announcements', 'general']);
    expect(org.leaveTypes).toHaveLength(4);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'it@launch.test' }, include: { role: true, memberships: true } });
    expect(u).toMatchObject({ isSuperAdmin: true, mustChangePassword: true, status: 'ACTIVE', firstName: 'IT', organizationId: org.id });
    expect(u.role.key).toBe('administrator');
    expect(u.memberships).toHaveLength(2);
    expect(u.passwordHash && (await verifyPassword(u.passwordHash, res.password))).toBe(true);
    expect(await prisma.invitation.count()).toBe(0); // no invitation links
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: org.id, action: 'superadmin.bootstrapped' } });
    expect(audit).toMatchObject({ entityId: u.id, actorId: null });
    expect(JSON.stringify(audit.metadata)).not.toContain(res.password);

    // Closed after first success: even with different values, nothing changes.
    const again = await bootstrapSuperAdmin(prisma, { ...BOOT, ADMIN_EMAIL: 'second@launch.test', CONFIRM_BOOTSTRAP: 'yes' }, [], quiet);
    expect(again).toMatchObject({ status: 'already-initialized', superAdmins: ['it@launch.test'] });
    expect(await prisma.user.count({ where: { organizationId: org.id } })).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.passwordHash).toBe(u.passwordHash);
    expect(await prisma.auditLog.count({ where: { action: 'superadmin.bootstrapped' } })).toBe(1);
  });

  it('the new Super Admin signs in, must change the password, and has no Super Admin authority yet', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email: 'it@launch.test', password: bootPassword }).expect(200);
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    expect(me).toMatchObject({ mustChangePassword: true, isSuperAdmin: false, superAdminNeedsMfa: true });
    await agent.get('/api/super-admins').expect(403);
  });

  it('accepts a supplied password and the email from --email for an existing organization without a Super Admin', async () => {
    const { org } = await makeOrg(prisma, 'existing-co', 'existing.test');
    await prisma.user.update({ where: { email: 'super_admin@existing.test' }, data: { isSuperAdmin: false } });
    const res = await bootstrapSuperAdmin(prisma, { ORG_SLUG: 'existing-co', ADMIN_PASSWORD: 'Chosen-Pass-2026', CONFIRM_BOOTSTRAP: 'yes' }, ['--email', 'founder@existing.test'], quiet);
    expect(res).toMatchObject({ status: 'created', organizationCreated: false, passwordGenerated: false, promotedExisting: false, organizationId: org.id });
    const agent = request.agent(app.getHttpServer());
    const signIn = await agent.post('/api/auth/login').send({ email: 'founder@existing.test', password: 'Chosen-Pass-2026' }).expect(200);
    expect(signIn.body.mfaRequired).toBeFalsy();
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    expect(me).toMatchObject({ mustChangePassword: true, isSuperAdmin: false });
    await agent.get('/api/employees').expect(403); // only change-password until a new password is chosen
  });

  it('refuses an email that belongs to another organization', async () => {
    const { org } = await makeOrg(prisma, 'third-co', 'third.test');
    await prisma.user.updateMany({ where: { organizationId: org.id }, data: { isSuperAdmin: false } });
    await prisma.organization.update({ where: { id: org.id }, data: { settings: organizationSettingsSchema.parse({ auth: { allowedEmailDomains: ['third.test', 'launch.test'] } }) } });
    await expect(bootstrapSuperAdmin(prisma, { ORG_SLUG: 'third-co', CONFIRM_BOOTSTRAP: 'yes' }, ['--email=it@launch.test'], quiet)).rejects.toThrow(/another organization/);
    expect(await prisma.user.count({ where: { organizationId: org.id, isSuperAdmin: true } })).toBe(0);
  });
});

describe('superadmin:recover', () => {
  let fg: Awaited<ReturnType<typeof makeOrg>>;
  let second: { id: string };
  let suspended: { id: string };
  beforeAll(async () => {
    fg = await makeOrg(prisma, 'recover-co', 'recover.test');
    const src = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.super_admin.id } });
    second = await prisma.user.create({ data: { organizationId: fg.org.id, email: 'second@recover.test', firstName: 'Second', lastName: 'Admin', roleId: fg.roles.administrator.id, isSuperAdmin: true, status: 'ACTIVE', passwordHash: src.passwordHash, ...mfaFields() } });
    suspended = await prisma.user.create({ data: { organizationId: fg.org.id, email: 'paused@recover.test', firstName: 'Paused', lastName: 'Admin', roleId: fg.roles.administrator.id, isSuperAdmin: true, status: 'SUSPENDED', passwordHash: src.passwordHash } });
  });

  it('refuses without CONFIRM_RECOVER=yes, for non Super Admins and for suspended accounts', async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.super_admin.id } });
    await expect(recoverSuperAdmin(prisma, {}, ['--email', target.email], quiet)).rejects.toThrow(/CONFIRM_RECOVER=yes/);
    await expect(recoverSuperAdmin(prisma, { CONFIRM_RECOVER: 'yes' }, [], quiet)).rejects.toThrow(/--email/);
    await expect(recoverSuperAdmin(prisma, { CONFIRM_RECOVER: 'yes' }, ['--email', 'employee@recover.test'], quiet)).rejects.toThrow(/not a Super Admin/);
    await expect(recoverSuperAdmin(prisma, { CONFIRM_RECOVER: 'yes' }, ['--email', 'nobody@recover.test'], quiet)).rejects.toThrow(/No account/);
    await expect(recoverSuperAdmin(prisma, { CONFIRM_RECOVER: 'yes', RECOVER_EMAIL: 'paused@recover.test' }, [], quiet)).rejects.toThrow(/suspended/);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.passwordHash).toBe(target.passwordHash);
    expect(unchanged.mfaEnabledAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'superadmin.recovered' } })).toBe(0);
  });

  it('resets the password and two-step verification, signs out everywhere, audits and notifies the other Super Admins', async () => {
    // The locked-out Super Admin has live sessions and is locked from wrong passwords.
    await login(app, 'super_admin@recover.test');
    await login(app, 'super_admin@recover.test');
    const victim = fg.users.super_admin.id;
    await prisma.user.update({ where: { id: victim }, data: { failedLogins: 7, lockedUntil: new Date(Date.now() + 3600_000) } });
    expect(await prisma.session.count({ where: { userId: victim } })).toBe(2);

    const res = await recoverSuperAdmin(prisma, { CONFIRM_RECOVER: 'yes', USER: 'ops-oncall' }, ['--email', 'SUPER_ADMIN@recover.test'], quiet);
    expect(res).toMatchObject({ email: 'super_admin@recover.test', sessionsRevoked: 2, passwordGenerated: true, notified: ['second@recover.test'] });

    const u = await prisma.user.findUniqueOrThrow({ where: { id: victim } });
    expect(u).toMatchObject({ mustChangePassword: true, mfaSecretEnc: null, mfaEnabledAt: null, mfaRecoveryCodes: [], failedLogins: 0, lockedUntil: null, isSuperAdmin: true, status: 'ACTIVE' });
    expect(await verifyPassword(u.passwordHash!, res.password)).toBe(true);
    expect(await prisma.session.count({ where: { userId: victim } })).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: fg.org.id, action: 'superadmin.recovered' } });
    expect(audit.entityId).toBe(victim);
    expect(audit.metadata).toMatchObject({ mfaCleared: true, sessionsRevoked: 2, operator: 'ops-oncall' });
    expect(JSON.stringify(audit.metadata)).not.toContain(res.password);

    const notes = await prisma.notification.findMany({ where: { organizationId: fg.org.id, type: 'security' } });
    expect(notes.map((n) => n.userId)).toEqual([second.id]); // not the suspended one, not the recovered one, nobody else
    expect(notes[0]!.title).toContain('was recovered');
    expect(notes.map((n) => n.userId)).not.toContain(suspended.id);

    // Signs in with the new password without a code, and must choose a new password first.
    const agent = request.agent(app.getHttpServer());
    const signIn = await agent.post('/api/auth/login').send({ email: 'super_admin@recover.test', password: res.password }).expect(200);
    expect(signIn.body.mfaRequired).toBeFalsy();
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    expect(me).toMatchObject({ mustChangePassword: true, isSuperAdmin: false });

    // The other Super Admin sees the notice in their inbox.
    const other = await login(app, 'second@recover.test');
    const inbox = (await other.get('/api/notifications').expect(200)).body;
    expect(JSON.stringify(inbox)).toContain('Super Admin access for super_admin User was recovered');
  });

  it('bootstrap stays closed for an organization that has a Super Admin', async () => {
    const res = await bootstrapSuperAdmin(prisma, { ORG_SLUG: 'recover-co', ADMIN_EMAIL: 'new@recover.test', CONFIRM_BOOTSTRAP: 'yes' }, [], quiet);
    expect(res.status).toBe('already-initialized');
  });
});
