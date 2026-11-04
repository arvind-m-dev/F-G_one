import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

/**
 * QA hardening for chat, announcements, notifications, profile, settings and search.
 * Each test creates its own channels and announcements so the file can run in any order.
 */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;
let port = 0;
let seq = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;
const settle = () => new Promise((r) => setTimeout(r, 250));

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  ({ app } = await createApp());
  await app.listen(0);
  port = (app.getHttpServer().address() as { port: number }).port;
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

async function socketFor(email: string) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const socket = io(`http://localhost:${port}`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie } });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

describe('chat: private channels stay private', () => {
  it('non-members, admins without membership and other tenants get 404 everywhere, including search', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const name = uniq('secret');
    const ch = await emp.post('/api/channels').send({ name, visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    const word = uniq('needle');
    const msg = await emp.post(`/api/channels/${ch.body.id}/messages`).send({ body: `${word} private plans` }).expect(201);

    for (const email of ['hr_admin@futuristglobal.com', 'super_admin@futuristglobal.com', 'employee@acme.test']) {
      const outsider = await login(app, email);
      await outsider.get(`/api/channels/${ch.body.id}`).expect(404);
      await outsider.get(`/api/channels/${ch.body.id}/messages`).expect(404);
      await outsider.get(`/api/messages/${msg.body.id}`).expect(404);
      await outsider.patch(`/api/messages/${msg.body.id}`).send({ body: 'x' }).expect(404);
      await outsider.delete(`/api/messages/${msg.body.id}`).expect(404);
      await outsider.post(`/api/messages/${msg.body.id}/reactions`).send({ emoji: 'thumbs-up' }).expect(404);
      await outsider.post(`/api/channels/${ch.body.id}/join`).expect(404);
      await outsider.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'hi' }).expect(404);
      await outsider.post(`/api/channels/${ch.body.id}/read`).expect(404);
      await outsider.patch(`/api/channels/${ch.body.id}`).send({ topic: 'x' }).expect(404);
      const s = await outsider.get(`/api/search?q=${word}`).expect(200);
      expect(s.body.messages).toHaveLength(0);
      const byName = await outsider.get(`/api/search?q=${name}`).expect(200);
      expect(byName.body.channels).toHaveLength(0);
      const browse = await outsider.get('/api/channels/browse').expect(200);
      expect(browse.body.some((c: { id: string }) => c.id === ch.body.id)).toBe(false);
    }
    const mine = await emp.get(`/api/search?q=${word}`).expect(200);
    expect(mine.body.messages).toHaveLength(1);
  });

  it('members cannot edit or delete other people’s messages unless they are a channel admin', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    const ch = await emp.post('/api/channels').send({ name: uniq('mod'), visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    const byEmp = await emp.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'mine' }).expect(201);
    const byMgr = await mgr.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'his' }).expect(201);
    await mgr.patch(`/api/messages/${byEmp.body.id}`).send({ body: 'tampered' }).expect(403);
    await mgr.delete(`/api/messages/${byEmp.body.id}`).expect(403);
    await mgr.post(`/api/channels/${ch.body.id}/members`).send({ userIds: [fg.users.hr_admin.id] }).expect(403);
    // the channel admin can moderate but still not edit
    await emp.patch(`/api/messages/${byMgr.body.id}`).send({ body: 'tampered' }).expect(403);
    const del = await emp.delete(`/api/messages/${byMgr.body.id}`).expect(200);
    expect(del.body).toMatchObject({ deleted: true, body: '' });
    expect(await prisma.auditLog.count({ where: { action: 'message.deleted_by_moderator', entityId: byMgr.body.id } })).toBe(1);
    const edited = await emp.patch(`/api/messages/${byEmp.body.id}`).send({ body: 'mine, edited' }).expect(200);
    expect(edited.body.editedAt).toBeTruthy();
  });
});

describe('chat: members and roles', () => {
  it('changing the role of someone who is not in the channel is a 404, not a server error', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const ch = await emp.post('/api/channels').send({ name: uniq('roles'), visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    await emp.patch(`/api/channels/${ch.body.id}/members/${fg.users.hr_admin.id}`).send({ role: 'ADMIN' }).expect(404);
    await emp.patch(`/api/channels/${ch.body.id}/members/does-not-exist`).send({ role: 'ADMIN' }).expect(404);
    await emp.patch(`/api/channels/${ch.body.id}/members/${fg.users.manager.id}`).send({ role: 'OWNER' }).expect(400);
  });

  it('setting a plain member to member is allowed; the last admin cannot step down', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const ch = await emp.post('/api/channels').send({ name: uniq('lastadmin'), visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    await emp.patch(`/api/channels/${ch.body.id}/members/${fg.users.manager.id}`).send({ role: 'MEMBER' }).expect(200);
    await emp.patch(`/api/channels/${ch.body.id}/members/${fg.users.employee.id}`).send({ role: 'MEMBER' }).expect(400);
    await emp.patch(`/api/channels/${ch.body.id}/members/${fg.users.manager.id}`).send({ role: 'ADMIN' }).expect(200);
    await emp.patch(`/api/channels/${ch.body.id}/members/${fg.users.employee.id}`).send({ role: 'MEMBER' }).expect(200);
    const d = await emp.get(`/api/channels/${ch.body.id}`).expect(200);
    expect(d.body.canManage).toBe(false);
  });

  it('the last person in a private channel can leave it, and the empty channel is archived', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    const ch = await emp.post('/api/channels').send({ name: uniq('solo'), visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    // the only admin cannot leave while others remain
    await emp.post(`/api/channels/${ch.body.id}/leave`).expect(400);
    await mgr.post(`/api/channels/${ch.body.id}/leave`).expect(200);
    await emp.post(`/api/channels/${ch.body.id}/leave`).expect(200);
    const mine = await emp.get('/api/channels').expect(200);
    expect(mine.body.some((c: { id: string }) => c.id === ch.body.id)).toBe(false);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: ch.body.id } })).archivedAt).not.toBeNull();
    await emp.get(`/api/channels/${ch.body.id}`).expect(404);
  });

  it('default channels cannot be left, DMs cannot be left, and people from other tenants cannot be added', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post(`/api/channels/${fg.general.id}/leave`).expect(400);
    const dm = await emp.post('/api/dm').send({ userIds: [fg.users.manager.id] }).expect(200);
    await emp.post(`/api/channels/${dm.body.id}/leave`).expect(400);
    await emp.post('/api/dm').send({ userIds: [other.users.employee.id] }).expect(400);
    await emp.post(`/api/channels/${fg.general.id}/members`).send({ userIds: [other.users.employee.id] }).expect(400);
    const acme = await login(app, 'employee@acme.test');
    await acme.get(`/api/channels/${fg.general.id}/messages`).expect(404);
    await acme.post(`/api/channels/${fg.general.id}/join`).expect(404);
  });

  it('deactivated people cannot be added or messaged as a new DM', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const emp = await login(app, 'employee@futuristglobal.com');
    const gone = await prisma.user.create({ data: { organizationId: fg.org.id, email: `${uniq('gone')}@futuristglobal.com`, firstName: 'Gone', lastName: 'User', roleId: fg.roles.employee.id, status: 'DEACTIVATED' } });
    await emp.post('/api/dm').send({ userIds: [gone.id] }).expect(400);
    await emp.post('/api/channels').send({ name: uniq('withgone'), memberIds: [gone.id] }).expect(400);
    const s = await hr.get('/api/search?q=Gone').expect(200);
    expect(s.body.people.some((p: { id: string }) => p.id === gone.id)).toBe(false);
  });
});

describe('chat: messages and threads', () => {
  it('validates bodies: empty, whitespace and over 4000 characters are rejected', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: '' }).expect(400);
    await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: '   \n ' }).expect(400);
    await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'a'.repeat(4001) }).expect(400);
    const ok = await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'a'.repeat(4000) }).expect(201);
    expect(ok.body.body).toHaveLength(4000);
    const xss = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const m = await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: xss }).expect(201);
    expect(m.body.body).toBe(xss); // stored as text; the web app renders it escaped
  });

  it('threads are one level deep and stay in their channel', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const root = await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'root' }).expect(201);
    const reply = await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'reply', parentId: root.body.id }).expect(201);
    await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'nested', parentId: reply.body.id }).expect(400);
    const priv = await emp.post('/api/channels').send({ name: uniq('elsewhere'), visibility: 'PRIVATE' }).expect(201);
    await emp.post(`/api/channels/${priv.body.id}/messages`).send({ body: 'x', parentId: root.body.id }).expect(400);
    const thread = await emp.get(`/api/channels/${fg.general.id}/messages?parentId=${root.body.id}`).expect(200);
    expect(thread.body.items.map((m: { body: string }) => m.body)).toEqual(['reply']);
    const parent = await emp.get(`/api/messages/${root.body.id}`).expect(200);
    expect(parent.body.replyCount).toBe(1);
  });

  it('history pages by cursor without gaps or duplicates', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const ch = await emp.post('/api/channels').send({ name: uniq('paging'), visibility: 'PRIVATE' }).expect(201);
    for (let i = 0; i < 25; i++) await emp.post(`/api/channels/${ch.body.id}/messages`).send({ body: `m${i}` }).expect(201);
    const seen: string[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await emp.get(`/api/channels/${ch.body.id}/messages`).query({ limit: 10, ...(before ? { before } : {}) }).expect(200);
      seen.unshift(...page.body.items.map((m: { body: string }) => m.body));
      if (!page.body.hasMore) break;
      before = page.body.items[0].createdAt;
    }
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => `m${i}`));
  });

  it('unread counts rise for others, not the author, and clear when read', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    const ch = await emp.post('/api/channels').send({ name: uniq('unread'), visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    await emp.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'one' }).expect(201);
    await emp.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'two' }).expect(201);
    const unreadOf = async (a: typeof emp) => (await a.get('/api/channels').expect(200)).body.find((c: { id: string }) => c.id === ch.body.id).unread;
    expect(await unreadOf(mgr)).toBe(2);
    expect(await unreadOf(emp)).toBe(0);
    await mgr.post(`/api/channels/${ch.body.id}/read`).expect(200);
    expect(await unreadOf(mgr)).toBe(0);
  });
});

describe('chat: notifications respect membership', () => {
  it('a person removed from a private channel is not notified about replies there', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    const ch = await emp.post('/api/channels').send({ name: uniq('leaky'), visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    const root = await mgr.post(`/api/channels/${ch.body.id}/messages`).send({ body: 'my question' }).expect(201);
    await emp.delete(`/api/channels/${ch.body.id}/members/${fg.users.manager.id}`).expect(200);
    const secret = uniq('confidential');
    await emp.post(`/api/channels/${ch.body.id}/messages`).send({ body: `${secret} answer`, parentId: root.body.id }).expect(201);
    await settle();
    const n = await mgr.get('/api/notifications').expect(200);
    expect(n.body.items.some((x: { body: string | null }) => x.body?.includes(secret))).toBe(false);
  });

  it('mentions followed by punctuation still notify', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post('/api/notifications/read').send({ all: true }).expect(200);
    const word = uniq('punct');
    await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: `Thanks @manager. ${word}` }).expect(201);
    await settle();
    const n = await mgr.get('/api/notifications?filter=mentions').expect(200);
    expect(n.body.items.some((x: { type: string; body: string | null }) => x.type === 'mention' && x.body?.includes(word))).toBe(true);
  });

  it('turning one notification type off keeps the other switches', async () => {
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.patch('/api/me/preferences').send({ notifications: { mentions: false } }).expect(200);
    const res = await mgr.patch('/api/me/preferences').send({ notifications: { dm: false } }).expect(200);
    expect(res.body.notifications).toMatchObject({ mentions: false, dm: false });
    // a mention is now silent, a thread reply still notifies
    await mgr.post('/api/notifications/read').send({ all: true }).expect(200);
    const emp = await login(app, 'employee@futuristglobal.com');
    const root = await mgr.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'root by manager' }).expect(201);
    await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'hey @manager', parentId: root.body.id }).expect(201);
    await emp.post(`/api/channels/${fg.general.id}/messages`).send({ body: 'ping @manager' }).expect(201);
    await settle();
    const n = await mgr.get('/api/notifications?filter=unread').expect(200);
    expect(n.body.items.map((x: { type: string }) => x.type)).toEqual(['thread']);
    await mgr.patch('/api/me/preferences').send({ notifications: { mentions: true, dm: true } }).expect(200);
  });

  it('marking notifications read only touches your own', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    const dm = await emp.post('/api/dm').send({ userIds: [fg.users.manager.id] }).expect(200);
    await emp.post(`/api/channels/${dm.body.id}/messages`).send({ body: 'unread for manager' }).expect(201);
    await settle();
    const ids = (await mgr.get('/api/notifications?filter=unread').expect(200)).body.items.map((x: { id: string }) => x.id);
    expect(ids.length).toBeGreaterThan(0);
    await emp.post('/api/notifications/read').send({ ids }).expect(200);
    const acme = await login(app, 'employee@acme.test');
    await acme.post('/api/notifications/read').send({ all: true }).expect(200);
    expect((await mgr.get('/api/notifications/unread-count').expect(200)).body.unread).toBeGreaterThanOrEqual(ids.length);
    await mgr.get('/api/notifications?filter=bogus').expect(400);
  });
});

describe('chat: realtime', () => {
  let sockets: Socket[] = [];
  afterEach(() => {
    sockets.forEach((s) => s.close());
    sockets = [];
  });

  it('delivers to members only and stops after leaving or being removed', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    const mgrSock = await socketFor('manager@futuristglobal.com');
    const hrSock = await socketFor('hr_admin@futuristglobal.com');
    sockets.push(mgrSock, hrSock);
    const got = { mgr: [] as string[], hr: [] as string[], typing: [] as string[], removed: [] as string[] };
    mgrSock.on('message:new', (m: { body: string }) => got.mgr.push(m.body));
    hrSock.on('message:new', (m: { body: string }) => got.hr.push(m.body));
    mgrSock.on('typing', (t: { channelId: string }) => got.typing.push(t.channelId));
    mgrSock.on('channel:removed', (p: { channelId: string }) => got.removed.push(p.channelId));

    const priv = await emp.post('/api/channels').send({ name: uniq('rt'), visibility: 'PRIVATE', memberIds: [fg.users.manager.id] }).expect(201);
    await settle();
    await emp.post(`/api/channels/${priv.body.id}/messages`).send({ body: 'first' }).expect(201);
    hrSock.emit('typing', { channelId: priv.body.id, typing: true }); // not a member: ignored
    await settle();
    expect(got.mgr).toContain('first');
    expect(got.hr).not.toContain('first');
    expect(got.typing).toHaveLength(0);

    await emp.delete(`/api/channels/${priv.body.id}/members/${fg.users.manager.id}`).expect(200);
    await settle();
    expect(got.removed).toContain(priv.body.id);
    await emp.post(`/api/channels/${priv.body.id}/messages`).send({ body: 'after removal' }).expect(201);

    const pub = await emp.post('/api/channels').send({ name: uniq('rtpub'), visibility: 'PUBLIC', memberIds: [fg.users.manager.id] }).expect(201);
    await settle();
    await mgr.post(`/api/channels/${pub.body.id}/leave`).expect(200);
    await settle();
    await emp.post(`/api/channels/${pub.body.id}/messages`).send({ body: 'after leaving' }).expect(201);
    await settle();
    expect(got.mgr).not.toContain('after removal');
    expect(got.mgr).not.toContain('after leaving');
  });
});

describe('announcements', () => {
  it('searching never reveals another department’s announcements', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const [sales, eng] = await Promise.all([
      prisma.department.create({ data: { organizationId: fg.org.id, name: uniq('Sales') } }),
      prisma.department.create({ data: { organizationId: fg.org.id, name: uniq('Eng') } }),
    ]);
    await prisma.user.update({ where: { id: fg.users.employee.id }, data: { departmentId: eng.id } });
    const word = uniq('quarterly');
    const salesOnly = await hr.post('/api/announcements').send({ title: `Sales ${word}`, body: 'targets', departmentId: sales.id }).expect(201);
    const engOnly = await hr.post('/api/announcements').send({ title: `Eng ${word}`, body: 'roadmap', departmentId: eng.id }).expect(201);
    const all = await hr.post('/api/announcements').send({ title: `All ${word}`, body: 'everyone' }).expect(201);

    const emp = await login(app, 'employee@futuristglobal.com');
    const found = await emp.get(`/api/announcements?q=${word}`).expect(200);
    expect(found.body.map((a: { id: string }) => a.id).sort()).toEqual([engOnly.body.id, all.body.id].sort());
    const byBody = await emp.get('/api/announcements?q=targets').expect(200);
    expect(byBody.body.some((a: { id: string }) => a.id === salesOnly.body.id)).toBe(false);
    await emp.get(`/api/announcements/${salesOnly.body.id}`).expect(404);
    await emp.post(`/api/announcements/${salesOnly.body.id}/ack`).expect(404);
    // HR (announcement manager) sees all three
    const mgrView = await hr.get(`/api/announcements?q=${word}`).expect(200);
    expect(mgrView.body).toHaveLength(3);
    await prisma.user.update({ where: { id: fg.users.employee.id }, data: { departmentId: null } });
  });

  it('rejects unknown categories with 400 and matches % and _ literally', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.get('/api/announcements?category=NOPE').expect(400);
    const word = uniq('sale');
    const a = await hr.post('/api/announcements').send({ title: `${word} 50% off`, body: 'b', category: 'EVENT' }).expect(201);
    const byCat = await emp.get('/api/announcements?category=EVENT').expect(200);
    expect(byCat.body.some((x: { id: string }) => x.id === a.body.id)).toBe(true);
    expect((await emp.get('/api/announcements?category=POLICY').expect(200)).body.some((x: { id: string }) => x.id === a.body.id)).toBe(false);
    const pct = await emp.get(`/api/announcements?q=${encodeURIComponent('50%')}`).expect(200);
    expect(pct.body.some((x: { id: string }) => x.id === a.body.id)).toBe(true);
    const wild = await emp.get(`/api/announcements?q=${encodeURIComponent('%')}`).expect(200);
    expect(wild.body.every((x: { title: string; body: string }) => `${x.title}${x.body}`.includes('%'))).toBe(true);
    const people = await emp.get(`/api/search?q=${encodeURIComponent('%')}`).expect(200);
    expect(people.body.people).toHaveLength(0);
    const underscore = await emp.get(`/api/search?q=${encodeURIComponent('hr_a')}`).expect(200); // only "hr_admin", not "hr?a"
    expect(underscore.body.people.map((p: { id: string }) => p.id)).toEqual([fg.users.hr_admin.id]);
  });

  it('managing: only announcement managers; expiry hides from readers; other tenants get 404', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const emp = await login(app, 'employee@futuristglobal.com');
    const mgr = await login(app, 'manager@futuristglobal.com');
    const acme = await login(app, 'hr_admin@acme.test');
    await mgr.post('/api/announcements').send({ title: 'Not allowed', body: 'x' }).expect(403);
    const a = await hr.post('/api/announcements').send({ title: uniq('Pinned note'), body: 'x', pinned: true, requireAck: true }).expect(201);
    await emp.patch(`/api/announcements/${a.body.id}`).send({ title: 'hacked' }).expect(403);
    await emp.delete(`/api/announcements/${a.body.id}`).expect(403);
    await emp.get(`/api/announcements/${a.body.id}/acks`).expect(403);
    await acme.get(`/api/announcements/${a.body.id}`).expect(404);
    await acme.patch(`/api/announcements/${a.body.id}`).send({ title: 'hacked' }).expect(404);
    await acme.delete(`/api/announcements/${a.body.id}`).expect(404);
    await acme.get(`/api/announcements/${a.body.id}/acks`).expect(404);
    await hr.post('/api/announcements').send({ title: 'Bad dept', body: 'x', departmentId: other.general.id }).expect(400);

    const list = await emp.get('/api/announcements').expect(200);
    expect(list.body[0].id).toBe(a.body.id); // pinned first
    await emp.post(`/api/announcements/${a.body.id}/ack`).expect(200);
    await emp.post(`/api/announcements/${a.body.id}/ack`).expect(200); // idempotent
    const acks = await hr.get(`/api/announcements/${a.body.id}/acks`).expect(200);
    expect(acks.body.acknowledged.map((u: { id: string }) => u.id)).toEqual([fg.users.employee.id]);
    expect(acks.body.pending.some((u: { id: string }) => u.id === fg.users.employee.id)).toBe(false);

    await hr.patch(`/api/announcements/${a.body.id}`).send({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).expect(200);
    await emp.get(`/api/announcements/${a.body.id}`).expect(404);
    const hrAll = await hr.get('/api/announcements?include=all').expect(200);
    expect(hrAll.body.some((x: { id: string }) => x.id === a.body.id)).toBe(true);
    await hr.delete(`/api/announcements/${a.body.id}`).expect(200);
    await hr.get(`/api/announcements/${a.body.id}`).expect(404);
  });
});

describe('profile, status and preferences', () => {
  it('rejects unknown time zones and non-web photo links', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.patch('/api/me/profile').send({ timezone: 'Not/AZone' }).expect(400);
    await emp.patch('/api/me/profile').send({ avatarUrl: 'javascript:alert(1)' }).expect(400);
    await emp.patch('/api/me/profile').send({ avatarUrl: 'data:text/html,hi' }).expect(400);
    await emp.patch('/api/me/profile').send({ firstName: 'a'.repeat(61) }).expect(400);
    const ok = await emp.patch('/api/me/profile').send({ timezone: 'Europe/London', avatarUrl: 'https://example.com/me.png', displayName: '<b>Ann</b>' }).expect(200);
    expect(ok.body).toMatchObject({ timezone: 'Europe/London', avatarUrl: 'https://example.com/me.png', displayName: '<b>Ann</b>' });
    await emp.patch('/api/me/profile').send({ avatarUrl: null, displayName: null, timezone: 'Asia/Kolkata' }).expect(200);
  });

  it('"until the end of today" ends at midnight in the person’s own time zone', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.patch('/api/me/profile').send({ timezone: 'Asia/Kolkata' }).expect(200);
    const res = await emp.put('/api/me/status').send({ presence: 'focus', expiry: 'today' }).expect(200);
    const end = new Date(res.body.statusExpiresAt);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(end);
    expect(local).toBe('23:59:59');
    expect(end.getTime()).toBeGreaterThan(Date.now());
    expect(end.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
    await emp.put('/api/me/status').send({ presence: 'available' }).expect(200);
  });
});
