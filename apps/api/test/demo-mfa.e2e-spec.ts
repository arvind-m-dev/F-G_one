// The demo code is read from the environment once, so set it before the app loads.
process.env.DEMO_MFA_CODE = '123456';
process.env.DEMO_MFA_EMAILS = 'super_admin@futuristglobal.com';

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, makeOrg, PASSWORD, resetDb } from './helpers';

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

describe('demo two-step code', () => {
  it('a listed demo account sees and can use the fixed code', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/login').send({ email: 'super_admin@futuristglobal.com', password: PASSWORD }).expect(200);
    expect(res.body).toMatchObject({ mfaRequired: true, demoMfaCode: '123456' });
    await agent.post('/api/auth/mfa/verify').send({ code: '123456' }).expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.mfaPending ?? false).toBe(false);
  });

  it('an account not on the list gets no hint and the code does not work', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/login').send({ email: 'super_admin@acme.test', password: PASSWORD }).expect(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.demoMfaCode).toBeUndefined();
    const v = await agent.post('/api/auth/mfa/verify').send({ code: '123456' });
    expect(v.status).toBeGreaterThanOrEqual(400);
  });

  it('a wrong password never reveals the code', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'super_admin@futuristglobal.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.demoMfaCode).toBeUndefined();
  });
});
