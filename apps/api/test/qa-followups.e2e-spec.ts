import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { RT } from '@fg/shared';
import { createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

/** Follow-ups from the QA pass: presence never crosses tenants, default channels keep their names, search is literal. */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let acme: Awaited<ReturnType<typeof makeOrg>>;
let port = 0;

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  acme = await makeOrg(prisma, 'acme', 'acme.test');
  ({ app } = await createApp());
  await app.listen(0);
  port = (app.getHttpServer().address() as { port: number }).port;
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

async function connect(email: string) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const socket = io(`http://localhost:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
  const snapshot = new Promise<string[]>((resolve) => socket.once(RT.ONLINE_SNAPSHOT, (p: { userIds: string[] }) => resolve(p.userIds)));
  return { socket, snapshot };
}

describe('QA follow-ups', () => {
  it('the online snapshot and online count only include your own organization', async () => {
    const sockets: Socket[] = [];
    try {
      const a = await connect('employee@acme.test');
      sockets.push(a.socket);
      await a.snapshot;
      const f = await connect('employee@futuristglobal.com');
      sockets.push(f.socket);
      const ids = await f.snapshot;
      expect(ids).toContain(fg.users.employee.id);
      expect(ids).not.toContain(acme.users.employee.id);
      const hr = await login(app, 'hr_admin@futuristglobal.com');
      expect((await hr.get('/api/admin/overview').expect(200)).body.employees.onlineNow).toBe(1);
    } finally {
      sockets.forEach((s) => s.close());
    }
  });

  it('default channels cannot be renamed through the API', async () => {
    const admin = await login(app, 'super_admin@futuristglobal.com');
    const res = await admin.patch(`/api/channels/${fg.general.id}`).send({ name: 'renamed' }).expect(400);
    expect(res.body.message).toMatch(/Default channels/);
    await admin.patch(`/api/channels/${fg.general.id}`).send({ topic: 'Company news' }).expect(200);
  });

  it('employee and audit search treat % and _ literally', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    expect((await hr.get('/api/employees').query({ q: '%' }).expect(200)).body.total).toBe(0);
    expect((await hr.get('/api/employees').query({ q: 'manager' }).expect(200)).body.total).toBeGreaterThan(0);
    const admin = await login(app, 'super_admin@futuristglobal.com');
    expect((await admin.get('/api/audit-logs').query({ q: '%' }).expect(200)).body.total).toBe(0);
  });
});
