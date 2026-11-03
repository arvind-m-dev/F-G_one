/**
 * Production bootstrap: creates the organization (if missing) with system roles,
 * and a first Super Admin in INVITED state. Prints a one-time invitation link.
 *
 *   ORG_NAME="Futurist Global" ORG_SLUG=futurist-global ORG_DOMAIN=futuristglobal.com \
 *   ADMIN_EMAIL=it@futuristglobal.com ADMIN_FIRST=IT ADMIN_LAST=Admin \
 *   pnpm --filter @fg/api db:bootstrap
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, organizationSettingsSchema } from '@fg/shared';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}`);
  return v;
};

/** Creates the org (if missing), roles, default channels and leave types, and a Super Admin invite. */
export async function bootstrap(prisma: PrismaClient) {
  const slug = need('ORG_SLUG');
  const domain = need('ORG_DOMAIN').toLowerCase();
  const email = need('ADMIN_EMAIL').toLowerCase();
  const webOrigin = need('WEB_ORIGIN');

  let org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: need('ORG_NAME'), slug, settings: organizationSettingsSchema.parse({ auth: { allowedEmailDomains: [domain] } }) },
    });
    console.log(`Created organization ${org.name}`);
  }
  for (const r of DEFAULT_ROLE_DEFINITIONS) {
    await prisma.role.upsert({
      where: { organizationId_key: { organizationId: org.id, key: r.key } },
      // Re-running bootstrap restores the system roles' default grants.
      update: { rank: r.rank, isSystem: true, grants: { deleteMany: {}, create: DEFAULT_ROLE_GRANTS[r.key] } },
      create: { organizationId: org.id, key: r.key, name: r.name, description: r.description, rank: r.rank, isSystem: true, grants: { create: DEFAULT_ROLE_GRANTS[r.key] } },
    });
  }
  for (const name of ['general', 'announcements']) {
    await prisma.channel.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, type: 'PUBLIC', name, isDefault: true, description: name === 'general' ? 'Company-wide chatter and news' : 'Official company announcements' },
    });
  }
  for (const t of [
    { code: 'CL', name: 'Casual leave', annualAllowance: 12, color: '#0ea5e9' },
    { code: 'SL', name: 'Sick leave', annualAllowance: 8, color: '#f43f5e' },
    { code: 'EL', name: 'Earned leave', annualAllowance: 15, color: '#10b981' },
    { code: 'UL', name: 'Unpaid leave', annualAllowance: 0, color: '#94a3b8', paid: false },
  ]) {
    await prisma.leaveType.upsert({ where: { organizationId_code: { organizationId: org.id, code: t.code } }, update: {}, create: { ...t, organizationId: org.id } });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: 'administrator' } } });
  if (await prisma.user.findUnique({ where: { email } })) throw new Error(`${email} already exists`);
  const user = await prisma.user.create({
    data: { organizationId: org.id, email, firstName: need('ADMIN_FIRST'), lastName: need('ADMIN_LAST'), roleId: role.id, isSuperAdmin: true, status: 'INVITED' },
  });
  const token = randomBytes(32).toString('base64url');
  await prisma.invitation.create({
    data: { organizationId: org.id, userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 2 * 86400_000) },
  });
  console.log(`Super Admin invitation (valid 48h):\n${webOrigin}/invite/${token}`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  bootstrap(prisma)
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
