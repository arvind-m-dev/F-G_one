import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io } from 'socket.io-client';
import { currentStep, totpAt } from '../src/auth/mfa';
import { createApp, login, makeOrg, PASSWORD, resetDb, TOTP_SECRET, totp } from './helpers';

/** Phase 2c: two-step verification, re-authentication and device sessions. */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

/** Makes the agent's sessions look like the user signed in long ago (re-authentication needed). */
const ageSessions = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) } });

describe('two-step verification', () => {
  let recoveryCodes: string[] = [];

  it('enrolment needs a recent sign-in and a correct first code, and returns recovery codes once', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const other = await login(app, 'employee@futuristglobal.com'); // a second device
    expect((await emp.get('/api/auth/mfa').expect(200)).body).toMatchObject({ enabled: false, required: false });

    await ageSessions(fg.users.employee.id);
    const stale = await emp.post('/api/auth/mfa/setup').expect(403);
    expect(stale.body.code).toBe('REAUTH_REQUIRED');
    await emp.post('/api/auth/reauth').send({ password: 'wrong-password' }).expect(400);
    await emp.post('/api/auth/reauth').send({ password: PASSWORD }).expect(200);

    const setup = (await emp.post('/api/auth/mfa/setup').expect(200)).body;
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.qrSvg).toContain('<svg');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } });
    expect(stored.mfaPendingSecretEnc).not.toContain(setup.secret); // encrypted at rest
    expect(stored.mfaEnabledAt).toBeNull(); // nothing changes until a code is confirmed

    await emp.post('/api/auth/mfa/enable').send({ code: '000000' }).expect(400);
    const step = currentStep();
    const enabled = (await emp.post('/api/auth/mfa/enable').send({ code: totpAt(setup.secret, step) }).expect(200)).body;
    expect(enabled.recoveryCodes).toHaveLength(10);
    recoveryCodes = enabled.recoveryCodes;
    expect((await emp.get('/api/auth/mfa').expect(200)).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    // Other devices signed in with only the password are signed out.
    await other.get('/api/auth/me').expect(401);
    await emp.get('/api/auth/me').expect(200);
    // Use the test secret from here on.
    await prisma.user.update({ where: { id: fg.users.employee.id }, data: { mfaSecretEnc: (await prisma.user.findUniqueOrThrow({ where: { id: fg.users.super_admin.id } })).mfaSecretEnc } });
  });

  it('sign-in stops halfway until the code is entered; the half session can do nothing else', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(200);
    expect(res.body.mfaRequired).toBe(true);
    const me = await agent.get('/api/auth/me').expect(401);
    expect(me.body.code).toBe('MFA_REQUIRED');
    await agent.get('/api/employees').expect(401);
    await agent.post('/api/auth/reauth').send({ password: PASSWORD }).expect(401);

    await agent.post('/api/auth/mfa/verify').send({ code: '123456' }).expect(400);
    const code = await totp(app, fg.users.employee.id);
    await agent.post('/api/auth/mfa/verify').send({ code }).expect(200);
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/mfa/verify').send({ code }).expect(401); // nothing pending any more

    // The same code cannot be used again on another sign-in.
    const replay = request.agent(app.getHttpServer());
    await replay.post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(200);
    await replay.post('/api/auth/mfa/verify').send({ code }).expect(400);
    // A recovery code works once.
    await replay.post('/api/auth/mfa/verify').send({ code: recoveryCodes[0]!.toUpperCase() }).expect(200);
    const again = request.agent(app.getHttpServer());
    await again.post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(200);
    await again.post('/api/auth/mfa/verify').send({ code: recoveryCodes[0] }).expect(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fg.users.employee.id } })).mfaRecoveryCodes).toHaveLength(9);
  });

  it('five wrong codes discard the half session', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(200);
    for (let i = 0; i < 4; i++) await agent.post('/api/auth/mfa/verify').send({ code: '000000' }).expect(400);
    await agent.post('/api/auth/mfa/verify').send({ code: '000000' }).expect(401);
    await agent.post('/api/auth/mfa/verify').send({ code: await totp(app, fg.users.employee.id) }).expect(401);
    expect(await prisma.auditLog.count({ where: { actorId: fg.users.employee.id, action: 'auth.mfa_failed' } })).toBeGreaterThanOrEqual(5);
  });

  it('re-authentication asks for a code when two-step verification is on', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await ageSessions(fg.users.employee.id);
    await emp.post('/api/auth/mfa/recovery-codes').expect(403);
    await emp.post('/api/auth/reauth').send({ password: PASSWORD }).expect(400);
    await emp.post('/api/auth/reauth').send({ password: PASSWORD, code: '000000' }).expect(400);
    await emp.post('/api/auth/reauth').send({ password: PASSWORD, code: await totp(app, fg.users.employee.id) }).expect(200);
    expect((await emp.post('/api/auth/mfa/recovery-codes').expect(200)).body.recoveryCodes).toHaveLength(10);
    await emp.post('/api/auth/mfa/disable').expect(200);
    const fresh = await request.agent(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(200);
    expect(fresh.body.mfaRequired).toBe(false);
    const actions = (await prisma.auditLog.findMany({ where: { actorId: fg.users.employee.id, action: { startsWith: 'auth.' } } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.mfa_enabled', 'auth.mfa_disabled', 'auth.reauthenticated', 'auth.reauth_failed', 'auth.mfa_recovery_codes_regenerated']));
  });
});

describe('Super Admins and two-step verification', () => {
  it('a Super Admin without two-step verification has dormant authority', async () => {
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { isSuperAdmin: true } });
    const mgr = await login(app, 'manager@futuristglobal.com');
    const me = (await mgr.get('/api/auth/me').expect(200)).body;
    expect(me).toMatchObject({ isSuperAdmin: false, superAdminNeedsMfa: true });
    const res = await mgr.get('/api/super-admins').expect(403);
    expect(res.body.code).toBe('MFA_SETUP_REQUIRED');
    await prisma.user.update({ where: { id: fg.users.manager.id }, data: { isSuperAdmin: false } });
  });

  it('a Super Admin cannot turn two-step verification off', async () => {
    const sa = await login(app, 'super_admin@futuristglobal.com');
    expect((await sa.get('/api/auth/me').expect(200)).body.isSuperAdmin).toBe(true);
    await sa.post('/api/auth/mfa/disable').expect(403);
  });

  it('Super Admin actions need a recent sign-in', async () => {
    const sa = await login(app, 'super_admin@futuristglobal.com');
    await ageSessions(fg.users.super_admin.id);
    const res = await sa.post(`/api/super-admins/${fg.users.manager.id}/remove`).send({ password: PASSWORD }).expect(403);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
    await sa.post('/api/auth/reauth').send({ password: PASSWORD, code: await totp(app, fg.users.super_admin.id) }).expect(200);
    await sa.post(`/api/super-admins/${fg.users.manager.id}/remove`).send({ password: PASSWORD }).expect(404); // passes the check; manager is not a Super Admin
  });
});

describe('signed-in devices', () => {
  it('lists your devices and signs out one or all others', async () => {
    const a = await login(app, 'hr_admin@futuristglobal.com');
    const b = await login(app, 'hr_admin@futuristglobal.com');
    const c = await login(app, 'hr_admin@futuristglobal.com');
    const list = (await a.get('/api/auth/sessions').expect(200)).body as { id: string; current: boolean }[];
    expect(list).toHaveLength(3);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const bId = ((await b.get('/api/auth/sessions').expect(200)).body as { id: string; current: boolean }[]).find((s) => s.current)!.id;
    await a.post(`/api/auth/sessions/${bId}/revoke`).expect(200);
    await b.get('/api/auth/me').expect(401);
    // Someone else's session id is not found.
    const emp = await login(app, 'employee@futuristglobal.com');
    const cId = ((await c.get('/api/auth/sessions').expect(200)).body as { id: string; current: boolean }[]).find((s) => s.current)!.id;
    await emp.post(`/api/auth/sessions/${cId}/revoke`).expect(404);
    expect((await a.post('/api/auth/sessions/revoke-others').expect(200)).body.count).toBe(1);
    await c.get('/api/auth/me').expect(401);
    await a.get('/api/auth/me').expect(200);
  });

  it('an admin can sign an employee out everywhere, within their authority', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const emp = await login(app, 'employee@futuristglobal.com');
    expect((await hr.get(`/api/employees/${fg.users.employee.id}/sessions`).expect(200)).body.length).toBeGreaterThanOrEqual(1);
    await hr.post(`/api/employees/${fg.users.employee.id}/sessions/revoke`).expect(200);
    await emp.get('/api/auth/me').expect(401);
    await hr.post(`/api/employees/${fg.users.super_admin.id}/sessions/revoke`).expect(403);
    await hr.get(`/api/employees/${fg.users.super_admin.id}/sessions`).expect(403);
    const plain = await login(app, 'manager@futuristglobal.com');
    await plain.post(`/api/employees/${fg.users.employee.id}/sessions/revoke`).expect(403);
    expect(await prisma.auditLog.count({ where: { action: 'employee.sessions_revoked', entityId: fg.users.employee.id } })).toBe(1);
  });

  it('revoking a session closes its live connection', async () => {
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'employee@futuristglobal.com', password: PASSWORD }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const socket = io(`http://localhost:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const closed = new Promise<string>((resolve) => socket.once('disconnect', (reason) => resolve(reason)));
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post(`/api/employees/${fg.users.employee.id}/sessions/revoke`).expect(200);
    expect(await closed).toBe('io server disconnect');
    socket.close();
  });
});
