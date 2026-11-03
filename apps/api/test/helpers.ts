import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, organizationSettingsSchema } from '@fg/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MailService } from '../src/mail/mail.service';

export const PASSWORD = 'Test-Password-123';

export async function resetDb(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

/** Creates an organization with system roles and one user per role. */
export async function makeOrg(prisma: PrismaClient, slug: string, domain: string) {
  const org = await prisma.organization.create({
    data: { name: slug, slug, settings: organizationSettingsSchema.parse({ auth: { allowedEmailDomains: [domain] } }) },
  });
  const roles: Record<string, { id: string }> = {};
  for (const r of DEFAULT_ROLE_DEFINITIONS) {
    roles[r.key] = await prisma.role.create({ data: { organizationId: org.id, key: r.key, name: r.name, grants: { create: DEFAULT_ROLE_GRANTS[r.key] }, rank: r.rank, isSystem: true } });
  }
  const passwordHash = await hash(PASSWORD);
  const users: Record<string, { id: string; email: string }> = {};
  for (const key of ['super_admin', 'hr_admin', 'manager', 'employee']) {
    users[key] = await prisma.user.create({
      data: { organizationId: org.id, email: `${key}@${domain}`, firstName: key, lastName: 'User', roleId: roles[key].id, status: 'ACTIVE', passwordHash },
    });
  }
  const general = await prisma.channel.create({
    data: { organizationId: org.id, type: 'PUBLIC', name: 'general', isDefault: true, members: { create: Object.values(users).map((u) => ({ userId: u.id })) } },
  });
  return { org, roles, users, general };
}

export async function createApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = configureApp(mod.createNestApplication());
  await app.init();
  return { app, mail: app.get(MailService) };
}

/** Logs in and returns a supertest agent that carries the session cookie. */
export async function login(app: INestApplication, email: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
