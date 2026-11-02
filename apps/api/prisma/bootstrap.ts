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
import { DEFAULT_ROLE_DEFINITIONS, organizationSettingsSchema } from '@fg/shared';

const prisma = new PrismaClient();
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}`);
  return v;
};

async function main() {
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
      update: { permissions: r.permissions, rank: r.rank, isSystem: true },
      create: { organizationId: org.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, rank: r.rank, isSystem: true },
    });
  }
  for (const name of ['general', 'announcements']) {
    await prisma.channel.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, type: 'PUBLIC', name, isDefault: true, description: name === 'general' ? 'Company-wide chatter and news' : 'Official company announcements' },
    });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: 'super_admin' } } });
  if (await prisma.user.findUnique({ where: { email } })) throw new Error(`${email} already exists`);
  const user = await prisma.user.create({
    data: { organizationId: org.id, email, firstName: need('ADMIN_FIRST'), lastName: need('ADMIN_LAST'), roleId: role.id, status: 'INVITED' },
  });
  const token = randomBytes(32).toString('base64url');
  await prisma.invitation.create({
    data: { organizationId: org.id, userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 2 * 86400_000) },
  });
  console.log(`Super Admin invitation (valid 48h):\n${webOrigin}/invite/${token}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
