import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io } from 'socket.io-client';
import { currentStep, totpAt } from '../src/auth/mfa';
import { MailService } from '../src/mail/mail.service';
import { createApp, login, makeOrg, PASSWORD, resetDb, totp } from './helpers';

/**
 * QA pass over authentication and the admin portal: every admin route by role, tenant isolation,
 * validation, password policy, two-step verification end to end, devices and the Super Admins API.
 */
const prisma = new PrismaClient();
let app: INestApplication;
let mail: MailService;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let acme: Awaited<ReturnType<typeof makeOrg>>;

const ORIGIN = 'http://localhost:3000';
const ageSessions = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) } });
const setSettings = (orgId: string, settings: Prisma.InputJsonObject) => prisma.organization.update({ where: { id: orgId }, data: { settings } });
const defaultSettings = (domain: string) => ({ auth: { allowedEmailDomains: [domain] } });

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  acme = await makeOrg(prisma, 'acme', 'acme.test');
  ({ app, mail } = await createApp());
});
afterEach(async () => {
  // Every test starts from the default (admin-managed) policies.
  await setSettings(fg.org.id, defaultSettings('futuristglobal.com'));
  await setSettings(acme.org.id, defaultSettings('acme.test'));
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('admin routes by role', () => {
  const cases: [string, string, Record<string, number>][] = [
    // [method, path, expected status per role]
    ['get', '/api/admin/overview', { super_admin: 200, hr_admin: 200, manager: 403, employee: 403 }],
    ['get', '/api/audit-logs', { super_admin: 200, hr_admin: 200, manager: 403, employee: 403 }],
    ['get', '/api/roles', { super_admin: 200, hr_admin: 200, manager: 200, employee: 200 }],
    ['get', '/api/departments', { super_admin: 200, hr_admin: 200, manager: 200, employee: 200 }],
    ['get', '/api/organization', { super_admin: 200, hr_admin: 200, manager: 200, employee: 200 }],
    ['get', '/api/super-admins', { super_admin: 200, hr_admin: 403, manager: 403, employee: 403 }],
  ];
  for (const [method, path, expected] of cases) {
    it(`${method.toUpperCase()} ${path}`, async () => {
      for (const [role, status] of Object.entries(expected)) {
        const agent = await login(app, `${role}@futuristglobal.com`);
        const res = await agent[method as 'get'](path);
        expect({ role, status: res.status }).toEqual({ role, status });
      }
    });
  }

  it('writes: departments need departments.manage, settings need settings.manage', async () => {
    for (const role of ['manager', 'employee']) {
      const agent = await login(app, `${role}@futuristglobal.com`);
      await agent.post('/api/departments').send({ name: `By ${role}` }).expect(403);
      await agent.patch('/api/organization').send({ name: 'Hacked' }).expect(403);
    }
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const dept = (await hr.post('/api/departments').send({ name: 'QA by HR' }).expect(201)).body;
    await hr.patch(`/api/departments/${dept.id}`).send({ description: 'Edited' }).expect(200);
    await hr.delete(`/api/departments/${dept.id}`).expect(200);
    await hr.patch('/api/organization').send({ name: 'Hacked' }).expect(403); // HR has no settings.manage
    const audit = await prisma.auditLog.findMany({ where: { organizationId: fg.org.id, entityId: dept.id }, select: { action: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(['department.created', 'department.deleted', 'department.updated']);
  });

  it('nothing is unlocked by a half-signed-in (two-step pending) session or anonymously', async () => {
    const half = request.agent(app.getHttpServer());
    expect((await half.post('/api/auth/login').send({ email: 'super_admin@futuristglobal.com', password: PASSWORD }).expect(200)).body.mfaRequired).toBe(true);
    for (const path of ['/api/admin/overview', '/api/audit-logs', '/api/super-admins', '/api/organization', '/api/auth/sessions']) {
      expect((await half.get(path).expect(401)).body.code).toBe('MFA_REQUIRED');
      await request(app.getHttpServer()).get(path).expect(401);
    }
    await half.post('/api/auth/logout').expect(200);
    await half.post('/api/auth/mfa/verify').send({ code: '123456' }).expect(401); // nothing pending any more
  });

  it('a temporary-password session reaches no admin route even for an administrator', async () => {
    await prisma.user.update({ where: { id: fg.users.hr_admin.id }, data: { mustChangePassword: true } });
    try {
      const hr = await login(app, 'hr_admin@futuristglobal.com');
      for (const path of ['/api/admin/overview', '/api/audit-logs', '/api/departments', '/api/auth/sessions']) {
        expect((await hr.get(path).expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      }
      expect((await hr.get('/api/auth/me').expect(200)).body.permissions).toEqual([]);
    } finally {
      await prisma.user.update({ where: { id: fg.users.hr_admin.id }, data: { mustChangePassword: false } });
    }
  });

  it('cross-origin writes are refused', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/departments').set('Origin', 'https://evil.example').send({ name: 'Cross origin' }).expect(403);
    await hr.post('/api/departments').set('Origin', ORIGIN).send({ name: 'Same origin' }).expect(201);
    await prisma.department.deleteMany({ where: { organizationId: fg.org.id, name: 'Same origin' } });
  });
});

describe('tenant isolation in the admin portal', () => {
  it('another organization cannot see or change departments, audit logs or settings', async () => {
    const fgHr = await login(app, 'hr_admin@futuristglobal.com');
    const dept = (await fgHr.post('/api/departments').send({ name: 'FG only' }).expect(201)).body;
    const acmeAdmin = await login(app, 'super_admin@acme.test');

    await acmeAdmin.patch(`/api/departments/${dept.id}`).send({ name: 'Taken over' }).expect(404);
    await acmeAdmin.delete(`/api/departments/${dept.id}`).expect(404);
    await acmeAdmin.post('/api/departments').send({ name: 'Acme team', headId: fg.users.employee.id }).expect(400); // FG person as head
    const acmeDepts = (await acmeAdmin.get('/api/departments').expect(200)).body as { id: string }[];
    expect(acmeDepts.map((d) => d.id)).not.toContain(dept.id);

    const audit = (await acmeAdmin.get('/api/audit-logs?pageSize=100').expect(200)).body;
    expect(audit.items.every((i: { organizationId: string }) => i.organizationId === acme.org.id)).toBe(true);
    expect((await acmeAdmin.get(`/api/audit-logs?q=department.created`).expect(200)).body.total).toBe(0);

    const roles = (await acmeAdmin.get('/api/roles').expect(200)).body.roles as { organizationId: string }[];
    expect(roles.every((r) => r.organizationId === acme.org.id)).toBe(true);
    expect((await acmeAdmin.get('/api/organization').expect(200)).body.id).toBe(acme.org.id);
    await acmeAdmin.patch('/api/organization').send({ name: 'Acme Renamed' }).expect(200);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: fg.org.id } })).name).toBe('futurist-global');
    await prisma.organization.update({ where: { id: acme.org.id }, data: { name: 'acme' } });

    const search = (await acmeAdmin.get('/api/search?q=futuristglobal').expect(200)).body;
    expect(search.people).toHaveLength(0);
    await fgHr.delete(`/api/departments/${dept.id}`).expect(200);
  });

  it('Super Admin routes and device controls never reach another organization', async () => {
    const acmeSa = await login(app, 'super_admin@acme.test');
    await acmeSa.post('/api/super-admins/invitations').send({ userId: fg.users.employee.id, password: PASSWORD }).expect(404);
    await acmeSa.post(`/api/super-admins/${fg.users.super_admin.id}/remove`).send({ password: PASSWORD }).expect(404);
    const list = (await acmeSa.get('/api/super-admins').expect(200)).body;
    expect(list.superAdmins.map((s: { id: string }) => s.id)).toEqual([acme.users.super_admin.id]);

    // An FG invitation cannot be revoked or accepted from Acme.
    const fgSa = await login(app, 'super_admin@futuristglobal.com');
    const inv = (await fgSa.post('/api/super-admins/invitations').send({ userId: fg.users.manager.id, password: PASSWORD }).expect(201)).body;
    await acmeSa.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(404);
    const token = decodeURIComponent(inv.url.split('token=')[1]);
    await acmeSa.post('/api/super-admins/invitations/accept').send({ token, password: PASSWORD }).expect(404);
    await fgSa.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(200);

    // Someone else's device session cannot be signed out.
    await login(app, 'employee@futuristglobal.com');
    const fgSession = await prisma.session.findFirstOrThrow({ where: { userId: fg.users.employee.id } });
    await acmeSa.post(`/api/auth/sessions/${fgSession.id}/revoke`).expect(404);
    const fgHr = await login(app, 'hr_admin@futuristglobal.com');
    await fgHr.post(`/api/auth/sessions/${fgSession.id}/revoke`).expect(404);
    expect(await prisma.session.count({ where: { id: fgSession.id } })).toBe(1);
  });

  it('the overview counts only this organization’s people as online', async () => {
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee@acme.test', password: PASSWORD }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const socket = io(`http://localhost:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      const fgHr = await login(app, 'hr_admin@futuristglobal.com');
      expect((await fgHr.get('/api/admin/overview').expect(200)).body.employees.onlineNow).toBe(0);
      const acmeSa = await login(app, 'super_admin@acme.test');
      // Poll briefly: the socket registers right after connecting.
      let online = 0;
      for (let i = 0; i < 20 && online !== 1; i++) {
        online = (await acmeSa.get('/api/admin/overview').expect(200)).body.employees.onlineNow;
        if (online !== 1) await new Promise((r) => setTimeout(r, 50));
      }
      expect(online).toBe(1);
    } finally {
      socket.close();
    }
  });
});

describe('departments', () => {
  it('validates input and refuses duplicate names', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    expect((await hr.post('/api/departments').send({ name: ' ' }).expect(400)).body.issues[0].path).toBe('name');
    await hr.post('/api/departments').send({ name: 'Ops', color: 'red' }).expect(400);
    await hr.post('/api/departments').send({ name: 'x'.repeat(61) }).expect(400);
    await hr.post('/api/departments').send({ name: 'Ops', headId: 'not-a-person' }).expect(400);
    const ops = (await hr.post('/api/departments').send({ name: 'Ops', headId: fg.users.manager.id, color: '#22c55e' }).expect(201)).body;
    await hr.post('/api/departments').send({ name: 'Ops' }).expect(409);
    await hr.patch('/api/departments/nope').send({ name: 'Nope' }).expect(404);
    await hr.patch(`/api/departments/${ops.id}`).send({ headId: null }).expect(200);
    await hr.delete(`/api/departments/${ops.id}`).expect(200);
    await hr.delete(`/api/departments/${ops.id}`).expect(404);
  });

  it('deleting a department never silently deletes announcements addressed to it', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const dept = (await hr.post('/api/departments').send({ name: 'Targeted' }).expect(201)).body;
    await prisma.user.update({ where: { id: fg.users.employee.id }, data: { departmentId: dept.id } });
    const ann = await prisma.announcement.create({ data: { organizationId: fg.org.id, departmentId: dept.id, title: 'Team only', body: 'Hello team' } });

    const listed = ((await hr.get('/api/departments').expect(200)).body as { id: string; memberCount: number; announcementCount: number }[]).find((d) => d.id === dept.id)!;
    expect(listed).toMatchObject({ memberCount: 1, announcementCount: 1 });
    const refused = await hr.delete(`/api/departments/${dept.id}`).expect(409);
    expect(refused.body.message).toMatch(/1 announcement is addressed to this department/);
    expect(await prisma.announcement.count({ where: { id: ann.id } })).toBe(1);

    await prisma.announcement.delete({ where: { id: ann.id } });
    await hr.delete(`/api/departments/${dept.id}`).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } })).departmentId).toBeNull(); // members keep their account
  });
});

describe('system settings', () => {
  it('rejects values that would break the workspace', async () => {
    const admin = await login(app, 'super_admin@futuristglobal.com');
    const bad: [Record<string, unknown>, string][] = [
      [{ settings: { attendance: { timezone: 'Not/AZone' } } }, 'settings.attendance.timezone'],
      [{ settings: { attendance: { workdayStart: '25:00' } } }, 'settings.attendance.workdayStart'],
      [{ settings: { attendance: { graceMinutes: 999 } } }, 'settings.attendance.graceMinutes'],
      [{ settings: { attendance: { allowedLocations: [] } } }, 'settings.attendance.allowedLocations'],
      [{ settings: { auth: { allowedEmailDomains: [] } } }, 'settings.auth.allowedEmailDomains'],
      [{ settings: { auth: { sessionTtlHours: 0 } } }, 'settings.auth.sessionTtlHours'],
      [{ settings: { branding: { tagline: 'x'.repeat(121) } } }, 'settings.branding.tagline'],
      [{ logoUrl: 'javascript:alert(1)' }, 'logoUrl'],
      [{ logoUrl: 'data:image/svg+xml,<svg/>' }, 'logoUrl'],
      [{ primaryColor: 'blue' }, 'primaryColor'],
      [{ name: '   ' }, 'name'],
    ];
    for (const [body, path] of bad) {
      const res = await admin.patch('/api/organization').send(body);
      expect({ body, status: res.status, path: res.body.issues?.[0]?.path }).toEqual({ body, status: 400, path });
    }
    // Attendance keeps working.
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.get('/api/attendance/today').expect(200);

    const ok = (await admin.patch('/api/organization').send({ logoUrl: 'https://cdn.example.com/logo.png', settings: { attendance: { timezone: 'Europe/London' } } }).expect(200)).body;
    expect(ok.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(ok.settings.attendance.timezone).toBe('Europe/London');
    expect((await emp.get('/api/attendance/today').expect(200)).body.policy.timezone).toBe('Europe/London');
    await admin.patch('/api/organization').send({ logoUrl: null }).expect(200);
  });

  it('settings changes are deep-merged, audited, and security settings need an active Super Admin', async () => {
    await prisma.user.update({ where: { id: fg.users.hr_admin.id }, data: { roleId: fg.roles.administrator.id } }); // Administrator role, no flag
    try {
      const administrator = await login(app, 'hr_admin@futuristglobal.com');
      const res = (await administrator.patch('/api/organization').send({ settings: { leave: { allowHalfDay: false } } }).expect(200)).body;
      expect(res.settings.leave.allowHalfDay).toBe(false);
      expect(res.settings.auth.allowedEmailDomains).toEqual(['futuristglobal.com']); // untouched sections stay
      // Sending the unchanged security section (what the settings page does) is fine; changing it is not.
      await administrator.patch('/api/organization').send({ settings: { security: { superAdminLimit: 4 } } }).expect(200);
      await administrator.patch('/api/organization').send({ settings: { security: { superAdminLimit: 2 } } }).expect(403);
      const sa = await login(app, 'super_admin@futuristglobal.com');
      await sa.patch('/api/organization').send({ settings: { security: { superAdminLimit: 2 } } }).expect(200);
      const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: fg.org.id, action: 'settings.updated' }, orderBy: { createdAt: 'desc' } });
      expect(log.metadata).toMatchObject({ settingsSections: ['security'] });
    } finally {
      await prisma.user.update({ where: { id: fg.users.hr_admin.id }, data: { roleId: fg.roles.hr_admin.id } });
    }
  });

  it('"People choose their own passwords" switch controls changing your own password', async () => {
    const admin = await login(app, 'super_admin@futuristglobal.com');
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Own-Choice-2026' }).expect(403);

    await admin.patch('/api/organization').send({ settings: { auth: { selfServicePassword: true } } }).expect(200);
    await emp.post('/api/auth/change-password').send({ currentPassword: 'wrong', newPassword: 'Own-Choice-2026' }).expect(400);
    await emp.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
    await emp.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Own-Choice-2026' }).expect(200);
    await emp.post('/api/auth/change-password').send({ currentPassword: 'Own-Choice-2026', newPassword: PASSWORD }).expect(200); // back to the shared test password

    await admin.patch('/api/organization').send({ settings: { auth: { selfServicePassword: false } } }).expect(200);
    await emp.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Own-Choice-2026' }).expect(403);
  });
});

describe('password reset by email follows the password policy', () => {
  it('admin-managed passwords (default): no reset email, and an older link stops working', async () => {
    mail.testOutbox.length = 0;
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'employee@futuristglobal.com' }).expect(200);
    expect(mail.testOutbox).toHaveLength(0);

    // A link issued while self-service was on...
    await setSettings(fg.org.id, { auth: { allowedEmailDomains: ['futuristglobal.com'], selfServicePassword: true } });
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'employee@futuristglobal.com' }).expect(200);
    const token = mail.testOutbox[0]!.text.match(/token=([\w-]+)/)![1];
    // ...is refused once the company switches back to admin-managed passwords.
    await setSettings(fg.org.id, defaultSettings('futuristglobal.com'));
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, password: 'Reset-By-Email-1' }).expect(400);
    await login(app, 'employee@futuristglobal.com'); // old password still works
  });

  it('self-service passwords: the link works and clears a temporary-password flag', async () => {
    await setSettings(fg.org.id, { auth: { allowedEmailDomains: ['futuristglobal.com'], selfServicePassword: true } });
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { mustChangePassword: true } });
    mail.testOutbox.length = 0;
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'manager@futuristglobal.com' }).expect(200);
    const token = mail.testOutbox[0]!.text.match(/token=([\w-]+)/)![1];
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, password: 'Reset-By-Email-1' }).expect(200);
    const agent = await login(app, 'manager@futuristglobal.com', 'Reset-By-Email-1');
    expect((await agent.get('/api/auth/me').expect(200)).body.mustChangePassword).toBe(false);
    const original = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } });
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { passwordHash: original.passwordHash } });
  });
});

describe('sign-in', () => {
  it('the lockout message points to the administrator, not to a reset email', async () => {
    const email = 'locked.qa@futuristglobal.com';
    const src = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } });
    await prisma.user.create({ data: { organizationId: fg.org.id, email, firstName: 'Locked', lastName: 'QA', roleId: fg.roles.employee.id, status: 'ACTIVE', passwordHash: src.passwordHash } });
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Wrong-Password-1' }).expect(401);
    const locked = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(403);
    expect(locked.body.message).toMatch(/administrator/);
    expect(locked.body.message).not.toMatch(/reset/i);
    await prisma.user.delete({ where: { email } });
  });

  it('emails are matched without regard to case or spaces; wrong or unknown accounts get the same answer', async () => {
    await login(app, '  Employee@FuturistGlobal.com ');
    const wrong = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: 'nope' }).expect(401);
    const ghost = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'ghost@futuristglobal.com', password: 'nope' }).expect(401);
    expect(wrong.body.message).toBe(ghost.body.message);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
    await prisma.user.update({ where: { id: fg.users.employee.id }, data: { failedLogins: 0, lockedUntil: null } });
  });
});

describe('two-step verification, end to end', () => {
  it('turn on → sign in with a code → recovery code → new codes → turn off', async () => {
    const id = fg.users.manager.id;
    const agent = await login(app, 'manager@futuristglobal.com');
    // Setup needs a recent sign-in; a fresh sign-in counts.
    const setup = (await agent.post('/api/auth/mfa/setup').expect(200)).body;
    await agent.post('/api/auth/mfa/setup').expect(200); // starting again replaces the pending secret
    await agent.post('/api/auth/mfa/enable').send({ code: totpAt(setup.secret, currentStep()) }).expect(400); // old secret no longer pending
    const setup2 = (await agent.post('/api/auth/mfa/setup').expect(200)).body;
    await agent.post('/api/auth/mfa/enable').send({ code: 'abc' }).expect(400);
    const { recoveryCodes } = (await agent.post('/api/auth/mfa/enable').send({ code: totpAt(setup2.secret, currentStep()) }).expect(200)).body;
    expect(recoveryCodes).toHaveLength(10);
    await agent.post('/api/auth/mfa/setup').expect(409); // already on
    expect((await agent.get('/api/auth/me').expect(200)).body.mfaEnabled).toBe(true);

    // A new sign-in stops halfway; sessions list hides half sessions.
    const second = request.agent(app.getHttpServer());
    expect((await second.post('/api/auth/login').send({ email: 'manager@futuristglobal.com', password: PASSWORD }).expect(200)).body.mfaRequired).toBe(true);
    const devices = (await agent.get('/api/auth/sessions').expect(200)).body as { current: boolean }[];
    expect(devices).toHaveLength(1);
    await prisma.user.update({ where: { id }, data: { mfaLastStep: null } });
    await second.post('/api/auth/mfa/verify').send({ code: totpAt(setup2.secret, currentStep()) }).expect(200);
    expect((await agent.get('/api/auth/sessions').expect(200)).body).toHaveLength(2);

    // Recovery code with stray spaces and in capitals works once.
    const third = request.agent(app.getHttpServer());
    await third.post('/api/auth/login').send({ email: 'manager@futuristglobal.com', password: PASSWORD }).expect(200);
    await third.post('/api/auth/mfa/verify').send({ code: ` ${recoveryCodes[0].toUpperCase()} ` }).expect(200);
    expect((await agent.get('/api/auth/mfa').expect(200)).body.recoveryCodesLeft).toBe(9);
    const fourth = request.agent(app.getHttpServer());
    await fourth.post('/api/auth/login').send({ email: 'manager@futuristglobal.com', password: PASSWORD }).expect(200);
    await fourth.post('/api/auth/mfa/verify').send({ code: recoveryCodes[0] }).expect(400);

    // New recovery codes and turning it off need a recent confirmation with a code.
    await ageSessions(id);
    expect((await agent.post('/api/auth/mfa/recovery-codes').expect(403)).body.code).toBe('REAUTH_REQUIRED');
    await agent.post('/api/auth/reauth').send({ password: PASSWORD }).expect(400); // code missing
    await agent.post('/api/auth/reauth').send({ password: PASSWORD, code: '000000' }).expect(400);
    await agent.post('/api/auth/reauth').send({ password: PASSWORD, code: recoveryCodes[1] }).expect(200);
    const fresh = (await agent.post('/api/auth/mfa/recovery-codes').expect(200)).body.recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(recoveryCodes[2]);
    const fifth = request.agent(app.getHttpServer());
    await fifth.post('/api/auth/login').send({ email: 'manager@futuristglobal.com', password: PASSWORD }).expect(200);
    await fifth.post('/api/auth/mfa/verify').send({ code: recoveryCodes[2] }).expect(400); // old codes stopped working

    await agent.post('/api/auth/mfa/disable').expect(200);
    await agent.post('/api/auth/mfa/disable').expect(400);
    expect((await agent.get('/api/auth/mfa').expect(200)).body).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
    const actions = (await prisma.auditLog.findMany({ where: { actorId: id, action: { startsWith: 'auth.mfa' } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.mfa_enabled', 'auth.mfa_recovery_codes_regenerated', 'auth.mfa_disabled', 'auth.mfa_failed']));
    // Back to a password-only sign-in.
    expect((await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'manager@futuristglobal.com', password: PASSWORD }).expect(200)).body.mfaRequired).toBe(false);
  });

  it('signing out of devices: one, all others, never the current one', async () => {
    const a = await login(app, 'employee@futuristglobal.com');
    const b = await login(app, 'employee@futuristglobal.com');
    const c = await login(app, 'employee@futuristglobal.com');
    const list = (await a.get('/api/auth/sessions').expect(200)).body as { id: string; current: boolean }[];
    const current = list.find((s) => s.current)!;
    await a.post(`/api/auth/sessions/${current.id}/revoke`).expect(400);
    const bId = (await b.get('/api/auth/sessions').expect(200)).body.find((s: { current: boolean }) => s.current).id;
    await a.post(`/api/auth/sessions/${bId}/revoke`).expect(200);
    await b.get('/api/auth/me').expect(401);
    await c.get('/api/auth/me').expect(200);
    expect((await a.post('/api/auth/sessions/revoke-others').expect(200)).body.count).toBeGreaterThanOrEqual(1);
    await c.get('/api/auth/me').expect(401);
    await a.get('/api/auth/me').expect(200);
    await a.post('/api/auth/logout').expect(200);
    await a.get('/api/auth/me').expect(401);
  });
});

describe('Super Admins API', () => {
  it('dormant without two-step verification, active with it; every change needs a recent sign-in and the password', async () => {
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const list = (await sa.get('/api/super-admins').expect(200)).body;
    expect(list).toMatchObject({ limit: 4, hardLimit: 4, used: 1, pending: [] });
    expect(list.superAdmins[0]).toMatchObject({ id: fg.users.super_admin.id, isYou: true });

    await sa.post('/api/super-admins/invitations').send({ userId: fg.users.hr_admin.id }).expect(400); // password missing
    await sa.post('/api/super-admins/invitations').send({ userId: fg.users.hr_admin.id, password: 'wrong' }).expect(403);
    await sa.post('/api/super-admins/invitations').send({ userId: 'missing', password: PASSWORD }).expect(404);
    await sa.post('/api/super-admins/invitations').send({ userId: fg.users.super_admin.id, password: PASSWORD }).expect(409); // already one
    expect(await prisma.auditLog.count({ where: { organizationId: fg.org.id, action: 'superadmin.reauth_failed' } })).toBeGreaterThanOrEqual(1);

    await ageSessions(fg.users.super_admin.id);
    expect((await sa.post('/api/super-admins/invitations').send({ userId: fg.users.hr_admin.id, password: PASSWORD }).expect(403)).body.code).toBe('REAUTH_REQUIRED');
    await sa.post('/api/auth/reauth').send({ password: PASSWORD, code: await totp(app, fg.users.super_admin.id) }).expect(200);
    const inv = (await sa.post('/api/super-admins/invitations').send({ userId: fg.users.hr_admin.id, password: PASSWORD }).expect(201)).body;
    expect((await sa.get('/api/super-admins').expect(200)).body.used).toBe(2);

    // The nominee needs two-step verification before accepting; others cannot use the link.
    const token = decodeURIComponent(inv.url.split('token=')[1]);
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/super-admins/invitations/accept').send({ token, password: PASSWORD }).expect(404);
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/super-admins/invitations/accept').send({ token, password: 'wrong' }).expect(403);
    expect((await hr.post('/api/super-admins/invitations/accept').send({ token, password: PASSWORD }).expect(403)).body.code).toBe('MFA_SETUP_REQUIRED');

    await sa.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(200);
    await sa.post(`/api/super-admins/invitations/${inv.id}/revoke`).expect(404);
    expect((await sa.get('/api/super-admins').expect(200)).body.used).toBe(1);

    // Removing yourself or the last one is refused.
    await sa.post(`/api/super-admins/${fg.users.super_admin.id}/remove`).send({ password: PASSWORD }).expect(403);
    await sa.post(`/api/super-admins/${fg.users.employee.id}/remove`).send({ password: PASSWORD }).expect(404);
  });

  it('a Super Admin flag without two-step verification gives no Super Admin access', async () => {
    await prisma.user.update({ where: { id: fg.users.super_admin.id }, data: { mfaEnabledAt: null } });
    try {
      const sa = await login(app, 'super_admin@futuristglobal.com');
      const me = (await sa.get('/api/auth/me').expect(200)).body;
      expect(me).toMatchObject({ isSuperAdmin: false, superAdminNeedsMfa: true });
      expect((await sa.get('/api/super-admins').expect(403)).body.code).toBe('MFA_SETUP_REQUIRED');
      await sa.patch('/api/organization').send({ settings: { security: { superAdminLimit: 3 } } }).expect(403);
      await sa.get('/api/admin/overview').expect(200); // the Administrator role still works
    } finally {
      await prisma.user.update({ where: { id: fg.users.super_admin.id }, data: { mfaEnabledAt: new Date() } });
    }
  });
});
