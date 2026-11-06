// The flag and allow-list are read from the environment once, so set them before the app loads.
process.env.DEMO_PASSWORDLESS_LOGIN = 'true';
process.env.DEMO_MFA_EMAILS = 'employee@futuristglobal.com,hr_admin@futuristglobal.com';

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, makeOrg, resetDb } from './helpers';

const prisma = new PrismaClient();
let app: INestApplication;

beforeAll(async () => {
  await resetDb(prisma);
  await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  await makeOrg(prisma, 'acme', 'acme.test');
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('demo passwordless sign-in', () => {
  it('offers only the allow-listed demo accounts of this workspace', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/demo-accounts').expect(200);
    expect(res.body.enabled).toBe(true);
    const emails = res.body.accounts.map((a: { email: string }) => a.email).sort();
    expect(emails).toEqual(['employee@futuristglobal.com', 'hr_admin@futuristglobal.com']);
    // Never an account that is not on the list, and never one from another workspace.
    expect(res.body.accounts.every((a: { email: string }) => a.email.endsWith('@futuristglobal.com'))).toBe(true);
  });

  it('signs a listed account in with no password and gives a full (not pending) session', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/demo-login').send({ email: 'employee@futuristglobal.com' }).expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.email).toBe('employee@futuristglobal.com');
    expect(me.body.mfaPending ?? false).toBe(false);
  });

  it('matches the account case-insensitively', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/demo-login').send({ email: 'Employee@FuturistGlobal.com' }).expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  it('refuses an account that is not on the demo list (404)', async () => {
    await request(app.getHttpServer()).post('/api/auth/demo-login').send({ email: 'manager@futuristglobal.com' }).expect(404);
  });

  it('refuses a listed-looking account in another workspace (404)', async () => {
    await request(app.getHttpServer()).post('/api/auth/demo-login').send({ email: 'employee@acme.test' }).expect(404);
  });

  it('refuses an unknown email (404)', async () => {
    await request(app.getHttpServer()).post('/api/auth/demo-login').send({ email: 'nobody@futuristglobal.com' }).expect(404);
  });
});
