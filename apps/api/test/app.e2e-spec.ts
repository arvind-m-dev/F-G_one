import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;
let mail: MailService;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  ({ app, mail } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('health & public', () => {
  it('reports healthy', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
  it('derives the client IP from trusted proxy hops only (rate-limit key)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').set('X-Forwarded-For', '203.0.113.7, 10.0.0.5').expect(200);
    expect(res.body.clientIp).toBe('203.0.113.7');
    // A client-supplied (spoofed) entry in front is ignored.
    const spoofed = await request(app.getHttpServer()).get('/api/health').set('X-Forwarded-For', '6.6.6.6, 203.0.113.7, 10.0.0.5').expect(200);
    expect(spoofed.body.clientIp).toBe('203.0.113.7');
  });

  it('requires a session for protected routes', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/employees').expect(401);
  });
});

describe('authentication', () => {
  it('rejects bad credentials with a generic message', async () => {
    const r1 = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: 'wrong' }).expect(401);
    const r2 = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'nobody@futuristglobal.com', password: 'wrong' }).expect(401);
    expect(r1.body.message).toBe(r2.body.message);
  });

  it('sets an httpOnly session cookie and returns the profile without secrets', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'EMPLOYEE@futuristglobal.com', password: PASSWORD }).expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/fg_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user.email).toBe('employee@futuristglobal.com');
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|\$argon2/);
    // Session token is stored hashed, never raw.
    const raw = cookie.match(/fg_session=([^;]+)/)![1];
    expect(await prisma.session.count({ where: { tokenHash: raw } })).toBe(0);
  });

  it('logout invalidates the session server-side', async () => {
    const agent = await login(app, 'employee@futuristglobal.com');
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('locks the account after repeated failures', async () => {
    const u = await prisma.user.create({
      data: { organizationId: fg.org.id, email: 'lockme@futuristglobal.com', firstName: 'L', lastName: 'M', roleId: fg.roles.employee.id, status: 'ACTIVE', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } })).passwordHash },
    });
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/api/auth/login').send({ email: u.email, password: 'nope' });
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: u.email, password: PASSWORD }).expect(403);
  });

  it('blocks cross-origin state-changing requests', async () => {
    await request(app.getHttpServer()).post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(403);
  });

  it('password reset: single-use token, signs out other sessions, no enumeration', async () => {
    const existing = await login(app, 'manager@futuristglobal.com');
    mail.testOutbox.length = 0;
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'ghost@futuristglobal.com' }).expect(200);
    expect(mail.testOutbox).toHaveLength(0);
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'manager@futuristglobal.com' }).expect(200);
    const token = mail.testOutbox[0]!.text.match(/token=([\w-]+)/)![1];
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, password: 'weak' }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, password: 'Brand-New-Pass-42' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, password: 'Brand-New-Pass-43' }).expect(400);
    await existing.get('/api/auth/me').expect(401);
    await login(app, 'manager@futuristglobal.com', 'Brand-New-Pass-42');
    // restore
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } })).passwordHash } });
  });

  it('expired reset tokens are rejected', async () => {
    mail.testOutbox.length = 0;
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'employee@futuristglobal.com' }).expect(200);
    const token = mail.testOutbox[0]!.text.match(/token=([\w-]+)/)![1];
    await prisma.passwordResetToken.updateMany({ where: { userId: fg.users.employee.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, password: 'Brand-New-Pass-42' }).expect(400);
  });
});

describe('employee onboarding & RBAC', () => {
  it('employees cannot create or edit employees', async () => {
    const agent = await login(app, 'employee@futuristglobal.com');
    await agent.post('/api/employees').send({ email: 'x@futuristglobal.com', firstName: 'X', lastName: 'Y', roleId: fg.roles.employee.id, password: 'Temp-Pass-2026' }).expect(403);
    await agent.patch(`/api/employees/${fg.users.manager.id}`).send({ firstName: 'Hacked' }).expect(403);
  });

  const passwordPolicy = (selfServicePassword: boolean) =>
    prisma.organization.update({ where: { id: fg.org.id }, data: { settings: { auth: { allowedEmailDomains: ['futuristglobal.com'], selfServicePassword } } } });

  it('by default only admins manage passwords: new accounts work at once and people cannot change their own', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const res = await hr.post('/api/employees').send({ email: 'given.pass@futuristglobal.com', firstName: 'Given', lastName: 'Pass', roleId: fg.roles.employee.id, password: 'Given-Pass-2026' }).expect(201);
    const agent = await login(app, 'given.pass@futuristglobal.com', 'Given-Pass-2026');
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    expect(me.mustChangePassword).toBe(false);
    expect(me.permissions.length).toBeGreaterThan(0);
    await agent.get('/api/channels').expect(200);
    const denied = await agent.post('/api/auth/change-password').send({ currentPassword: 'Given-Pass-2026', newPassword: 'Other-Pass-2026' }).expect(403);
    expect(denied.body.message).toMatch(/administrator/);
    // An admin-set replacement is not temporary either.
    await hr.post(`/api/employees/${res.body.employee.id}/password`).send({ password: 'Second-Pass-2026' }).expect(200);
    const again = await login(app, 'given.pass@futuristglobal.com', 'Second-Pass-2026');
    expect((await again.get('/api/auth/me').expect(200)).body.mustChangePassword).toBe(false);
    // The invitation flow is gone.
    await hr.post(`/api/employees/${res.body.employee.id}/invite`).send({}).expect(404);
  });

  it('with self-service passwords, HR creates an employee with a temporary password they must change at first sign-in', async () => {
    await passwordPolicy(true);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const temp = 'Temp-Pass-2026';
    await hr.post('/api/employees').send({ email: 'new@gmail.com', firstName: 'N', lastName: 'J', roleId: fg.roles.employee.id, password: temp }).expect(400); // domain policy
    await hr.post('/api/employees').send({ email: 'boss@futuristglobal.com', firstName: 'B', lastName: 'S', roleId: fg.roles.administrator.id, password: temp }).expect(403); // cannot grant higher role
    await hr.post('/api/employees').send({ email: 'weak@futuristglobal.com', firstName: 'W', lastName: 'P', roleId: fg.roles.employee.id, password: 'short' }).expect(400); // password policy

    const res = await hr.post('/api/employees').send({ email: 'New.Joiner@futuristglobal.com', firstName: 'New', lastName: 'Joiner', roleId: fg.roles.employee.id, designation: 'Engineer', password: temp }).expect(201);
    expect(res.body.employee.status).toBe('ACTIVE');
    expect(res.body).not.toHaveProperty('inviteUrl');

    const agent = await login(app, 'new.joiner@futuristglobal.com', temp);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.mustChangePassword).toBe(true);
    expect(me.body.permissions).toEqual([]); // nothing works until they choose their own password
    expect((await agent.get('/api/channels').expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await agent.get('/api/auth/sessions').expect(403);
    await agent.post('/api/auth/change-password').send({ currentPassword: temp, newPassword: temp }).expect(400); // must differ
    await agent.post('/api/auth/change-password').send({ currentPassword: temp, newPassword: 'Joiner-Pass-2026' }).expect(200);
    const after = await agent.get('/api/auth/me').expect(200);
    expect(after.body.mustChangePassword).toBe(false);
    expect(after.body.permissions.length).toBeGreaterThan(0);
    // auto-joined default channels
    const channels = await agent.get('/api/channels').expect(200);
    expect(channels.body.map((c: { name: string }) => c.name)).toContain('general');
    await passwordPolicy(false);
  });

  it('admins set a password for an employee: signs them out, forces a change, audited, guarded by rank', async () => {
    await passwordPolicy(true);
    const victim = await login(app, 'employee@futuristglobal.com');
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/employees/${fg.users.super_admin.id}/password`).send({ password: 'Reset-Pass-2026' }).expect(403); // above them
    await hr.post(`/api/employees/${fg.users.hr_admin.id}/password`).send({ password: 'Reset-Pass-2026' }).expect(400); // self
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post(`/api/employees/${fg.users.manager.id}/password`).send({ password: 'Reset-Pass-2026' }).expect(403); // no permission

    await hr.post(`/api/employees/${fg.users.employee.id}/password`).send({ password: 'Reset-Pass-2026' }).expect(200);
    await victim.get('/api/auth/me').expect(401); // signed out everywhere
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(401);
    const again = await login(app, 'employee@futuristglobal.com', 'Reset-Pass-2026');
    expect((await again.get('/api/auth/me').expect(200)).body.mustChangePassword).toBe(true);
    await again.post('/api/auth/change-password').send({ currentPassword: 'Reset-Pass-2026', newPassword: PASSWORD }).expect(200);

    const audit = await prisma.auditLog.count({ where: { organizationId: fg.org.id, action: 'employee.password_set', entityId: fg.users.employee.id } });
    expect(audit).toBe(1);
    await passwordPolicy(false);
  });

  it('deactivation revokes sessions immediately; HR cannot deactivate a super admin', async () => {
    const victim = await login(app, 'employee@futuristglobal.com');
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/employees/${fg.users.super_admin.id}/deactivate`).expect(403);
    await hr.post(`/api/employees/${fg.users.hr_admin.id}/deactivate`).expect(403); // self
    await hr.post(`/api/employees/${fg.users.employee.id}/deactivate`).expect(200);
    await victim.get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(403);
    await hr.post(`/api/employees/${fg.users.employee.id}/activate`).expect(200);
    await login(app, 'employee@futuristglobal.com');
  });

  it('non-admins see only active colleagues and no private fields', async () => {
    const agent = await login(app, 'employee@futuristglobal.com');
    const res = await agent.get('/api/employees?status=ALL').expect(200);
    expect(res.body.items.every((e: { status: string }) => e.status === 'ACTIVE')).toBe(true);
    expect(res.body.items[0].lastLoginAt).toBeUndefined();
  });

  it('only settings.manage can change company settings', async () => {
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.patch('/api/organization').send({ primaryColor: '#000000' }).expect(403);
    const admin = await login(app, 'super_admin@futuristglobal.com');
    const res = await admin.patch('/api/organization').send({ primaryColor: '#123456', settings: { modules: { ai: false } } }).expect(200);
    expect(res.body.primaryColor).toBe('#123456');
    expect(res.body.settings.modules.ai).toBe(false);
    expect(res.body.settings.modules.chat).toBe(true); // deep merge keeps other values
    await admin.patch('/api/organization').send({ primaryColor: 'red' }).expect(400);
  });
});

describe('tenant isolation', () => {
  it('a user from another organization cannot read or modify Futurist Global data', async () => {
    const acme = await login(app, 'super_admin@acme.test');
    const list = await acme.get('/api/employees?status=ALL').expect(200);
    expect(list.body.items.every((e: { email: string }) => e.email.endsWith('@acme.test'))).toBe(true);
    await acme.get(`/api/employees/${fg.users.employee.id}`).expect(404);
    await acme.patch(`/api/employees/${fg.users.employee.id}`).send({ firstName: 'Pwned' }).expect(404);
    await acme.post(`/api/employees/${fg.users.employee.id}/deactivate`).expect(404);
    await acme.get(`/api/channels/${fg.general.id}`).expect(404);
    await acme.get(`/api/channels/${fg.general.id}/messages`).expect(404);
    await acme.post(`/api/channels/${fg.general.id}/join`).expect(404);
    await acme.post('/api/dm').send({ userIds: [fg.users.employee.id] }).expect(400);
    // cannot assign a role from another org
    await acme.post('/api/employees').send({ email: 'z@acme.test', firstName: 'Z', lastName: 'Z', roleId: fg.roles.employee.id, password: 'Temp-Pass-2026' }).expect(400);
    const search = await acme.get('/api/search?q=super').expect(200);
    expect(search.body.people.every((p: { id: string }) => p.id !== fg.users.super_admin.id)).toBe(true);
  });
});

describe('chat authorization', () => {
  it('members exchange messages; non-members cannot read private channels', async () => {
    const mgr = await login(app, 'manager@futuristglobal.com');
    const emp = await login(app, 'employee@futuristglobal.com');
    const hr = await login(app, 'hr_admin@futuristglobal.com');

    const ch = await mgr.post('/api/channels').send({ name: 'secret-project', visibility: 'PRIVATE', memberIds: [fg.users.employee.id] }).expect(201);
    await hr.get(`/api/channels/${ch.body.id}/messages`).expect(404);
    await hr.post(`/api/channels/${ch.body.id}/join`).expect(404);

    const sent = await emp.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'hello team' }).expect(201);
    const msgs = await mgr.get(`/api/channels/${ch.body.id}/messages`).expect(200);
    expect(msgs.body.items.map((m: { body: string }) => m.body)).toContain('hello team');

    // unread counter for the manager
    const mine = await mgr.get('/api/channels').expect(200);
    expect(mine.body.find((c: { id: string }) => c.id === ch.body.id).unread).toBe(1);

    // only the author edits; channel admin may delete
    await mgr.patch(`/api/messages/${sent.body.id}`).send({ body: 'edited by someone else' }).expect(403);
    await emp.patch(`/api/messages/${sent.body.id}`).send({ body: 'hello team!' }).expect(200);
    await mgr.post(`/api/messages/${sent.body.id}/reactions`).send({ emoji: 'party' }).expect(200);
    const del = await mgr.delete(`/api/messages/${sent.body.id}`).expect(200);
    expect(del.body.deleted).toBe(true);
    expect(del.body.body).toBe('');

    // members of private channels can't add people unless admin
    await emp.post(`/api/channels/${ch.body.id}/members`).send({ userIds: [fg.users.hr_admin.id] }).expect(403);
    await mgr.post(`/api/channels/${ch.body.id}/members`).send({ userIds: [fg.users.hr_admin.id] }).expect(200);
    await hr.get(`/api/channels/${ch.body.id}/messages`).expect(200);

    // search only returns messages from conversations the caller belongs to
    await mgr.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'zebra-launch-code' }).expect(201);
    const s1 = await emp.get('/api/search?q=zebra-launch').expect(200);
    expect(s1.body.messages).toHaveLength(1);
    const admin = await login(app, 'super_admin@futuristglobal.com');
    const s2 = await admin.get('/api/search?q=zebra-launch').expect(200);
    expect(s2.body.messages).toHaveLength(0);
  });

  it('reactions only accept the approved icon set', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const m = await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'reaction test' }).expect(201);
    await emp.post(`/api/messages/${m.body.id}/reactions`).send({ emoji: '<script>' }).expect(400);
    const ok = await emp.post(`/api/messages/${m.body.id}/reactions`).send({ emoji: 'rocket' }).expect(200);
    expect(ok.body.reactions).toEqual([{ emoji: 'rocket', userIds: [fg.users.employee.id], count: 1 }]);
  });

  it('direct messages are deduplicated per participant set', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const a = await emp.post('/api/dm').send({ userIds: [fg.users.manager.id] }).expect(200);
    const b = await emp.post('/api/dm').send({ userIds: [fg.users.manager.id, fg.users.employee.id] }).expect(200);
    expect(a.body.id).toBe(b.body.id);
  });

  it('presence status changes never create attendance-like records and validate input', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.put('/api/me/status').send({ presence: 'nap' }).expect(400);
    const res = await emp.put('/api/me/status').send({ presence: 'lunch', text: 'Back at 2', expiry: '1h' }).expect(200);
    expect(res.body.presence).toBe('lunch');
    expect(new Date(res.body.statusExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('dashboard & analytics', () => {
  it('dashboard aggregates are scoped to the caller', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const d = await emp.get('/api/dashboard').expect(200);
    expect(d.body.orgStats.headcount).toBeGreaterThan(0);
    expect(d.body).toHaveProperty('workday.start');
    await emp.get('/api/admin/overview').expect(403);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const o = await hr.get('/api/admin/overview').expect(200);
    expect(o.body.employees.active).toBeGreaterThan(0);
    expect(o.body.activity).toHaveLength(14);
  });
});
