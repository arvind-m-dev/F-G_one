import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, organizationSettingsSchema } from '@fg/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { currentStep, encryptSecret, totpAt } from '../src/auth/mfa';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

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
  // `super_admin` holds the Administrator role plus the Super Admin authority flag.
  for (const key of ['super_admin', 'hr_admin', 'manager', 'employee']) {
    const roleKey = key === 'super_admin' ? 'administrator' : key;
    users[key] = await prisma.user.create({
      data: { organizationId: org.id, email: `${key}@${domain}`, firstName: key, lastName: 'User', roleId: roles[roleKey].id, isSuperAdmin: key === 'super_admin', status: 'ACTIVE', passwordHash, ...(key === 'super_admin' ? mfaFields() : {}) },
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

/** Authenticator secret used for every test account with two-step verification on. */
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const mfaFields = () => ({ mfaSecretEnc: encryptSecret(TOTP_SECRET), mfaEnabledAt: new Date(), mfaRecoveryCodes: [] as string[] });
/** A valid code right now. Clears the replay marker first so tests can sign in many times within one 30-second step. */
export async function totp(app: INestApplication, userId?: string) {
  if (userId) await app.get(PrismaService).user.update({ where: { id: userId }, data: { mfaLastStep: null } });
  return totpAt(TOTP_SECRET, currentStep());
}

/** Logs in (finishing the authenticator step when the account has one) and returns a supertest agent that carries the session cookie. */
export async function login(app: INestApplication, email: string, password = PASSWORD) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  if (res.body.mfaRequired) {
    const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email } });
    const v = await agent.post('/api/auth/mfa/verify').send({ code: await totp(app, user.id) });
    if (v.status !== 200) throw new Error(`MFA failed for ${email}: ${v.status} ${JSON.stringify(v.body)}`);
  }
  return agent;
}
