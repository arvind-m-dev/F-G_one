import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp, login, makeOrg, resetDb } from './helpers';

/** Phase 2a: grants resolved per request from roles, extra roles and overrides. */
const prisma = new PrismaClient();
let app: INestApplication;
let fg: Awaited<ReturnType<typeof makeOrg>>;
let other: Awaited<ReturnType<typeof makeOrg>>;
let n = 0;
const holiday = () => ({ name: `Day ${++n}`, date: `2031-02-${String(n + 1).padStart(2, '0')}`, type: 'COMPANY' });

beforeAll(async () => {
  await resetDb(prisma);
  fg = await makeOrg(prisma, 'futurist-global', 'futuristglobal.com');
  other = await makeOrg(prisma, 'acme', 'acme.test');
  ({ app } = await createApp());
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('permission engine', () => {
  it('/auth/me returns scoped grants and the derived legacy permissions', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    const me = (await hr.get('/api/auth/me').expect(200)).body;
    expect(me.grants['attendance.view']).toBe('ORG');
    expect(me.permissions).toEqual(expect.arrayContaining(['attendance.view_all', 'attendance.view_team', 'employees.manage']));
    expect(me.grants['roles.manage']).toBeUndefined();
    const mgr = (await (await login(app, 'manager@futuristglobal.com')).get('/api/auth/me').expect(200)).body;
    expect(mgr.grants['attendance.view']).toBe('TEAM');
    expect(mgr.permissions).not.toContain('attendance.view_all');
  });

  it('a custom extra role grants access immediately, and archiving it revokes it on the next request', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await emp.post('/api/holidays').send(holiday()).expect(403);
    const role = await prisma.role.create({
      data: { organizationId: fg.org.id, key: 'holiday_coordinator', name: 'Holiday Coordinator', grants: { create: [{ permission: 'calendar.manage_holidays', scope: 'ORG' }] } },
    });
    await prisma.userRole.create({ data: { userId: fg.users.employee.id, roleId: role.id } });
    await emp.post('/api/holidays').send(holiday()).expect(201); // same session, no re-login
    await prisma.role.update({ where: { id: role.id }, data: { archivedAt: new Date() } });
    await emp.post('/api/holidays').send(holiday()).expect(403);
  });

  it('an explicit DENY override beats the role; removing it restores access', async () => {
    const hr = await login(app, 'hr_admin@futuristglobal.com');
    await hr.post('/api/holidays').send(holiday()).expect(201);
    const o = await prisma.userPermissionOverride.create({
      data: { organizationId: fg.org.id, userId: fg.users.hr_admin.id, permission: 'calendar.manage_holidays', effect: 'DENY', reason: 'test' },
    });
    await hr.post('/api/holidays').send(holiday()).expect(403);
    await prisma.userPermissionOverride.delete({ where: { id: o.id } });
    await hr.post('/api/holidays').send(holiday()).expect(201);
  });

  it('an ALLOW override at TEAM does not unlock ORG-wide access', async () => {
    const emp = await login(app, 'employee@futuristglobal.com');
    await prisma.userPermissionOverride.create({
      data: { organizationId: fg.org.id, userId: fg.users.employee.id, permission: 'attendance.view', effect: 'ALLOW', scope: 'TEAM' },
    });
    const me = (await emp.get('/api/auth/me').expect(200)).body;
    expect(me.permissions).toContain('attendance.view_team');
    expect(me.permissions).not.toContain('attendance.view_all');
  });

  it('a role from another tenant attached to a user grants nothing', async () => {
    const foreign = await prisma.role.create({
      data: { organizationId: other.org.id, key: 'foreign_admin', name: 'Foreign', grants: { create: [{ permission: 'departments.manage', scope: 'ORG' }] } },
    });
    await prisma.userRole.create({ data: { userId: fg.users.manager.id, roleId: foreign.id } });
    const mgr = await login(app, 'manager@futuristglobal.com');
    await mgr.post('/api/departments').send({ name: 'Should fail' }).expect(403);
  });

  it('roles API exposes grants and the catalogue', async () => {
    const sa = await login(app, 'super_admin@futuristglobal.com');
    const body = (await sa.get('/api/roles').expect(200)).body;
    const hrRole = body.roles.find((r: { key: string }) => r.key === 'hr_admin');
    expect(hrRole.grants).toEqual(expect.arrayContaining([{ permission: 'attendance.view', scope: 'ORG' }]));
    expect(hrRole.permissions).toContain('employees.manage');
    expect(body.catalog.find((e: { key: string }) => e.key === 'roles.manage').sensitive).toBe(true);
  });
});
