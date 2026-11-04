/**
 * Go-live reset: permanently deletes one organization and ALL its data (users, chat,
 * attendance, leave, announcements…), then recreates it empty with a first Super Admin
 * (superadmin:bootstrap: a temporary password printed once, no invitation link).
 * Use it to remove seeded demo data from a production database.
 *
 * Dry run (default) — shows what would be deleted, changes nothing:
 *   ORG_SLUG=futurist-global pnpm --filter @fg/api db:reset-org
 *
 * Real run — also requires CONFIRM_RESET to repeat the slug, plus the bootstrap values:
 *   ORG_SLUG=futurist-global CONFIRM_RESET=futurist-global \
 *   ORG_NAME="Futurist Global" ORG_DOMAIN=futuristglobal.com \
 *   ADMIN_EMAIL=it@futuristglobal.com ADMIN_FIRST=IT ADMIN_LAST=Admin \
 *   pnpm --filter @fg/api db:reset-org
 *
 * Take a backup first (docs/DEPLOYMENT.md#backups).
 */
import { PrismaClient } from '@prisma/client';
import { emailSchema, passwordSchema } from '@fg/shared';
import { bootstrapSuperAdmin } from './bootstrap';
import { dbHost, RefusedError } from './operator';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.ORG_SLUG;
  if (!slug) throw new RefusedError('Set ORG_SLUG');
  const org = await prisma.organization.findUnique({ where: { slug } });
  console.log(`Database host: ${dbHost(process.env.DATABASE_URL)}`);
  if (org) {
    const where = { organizationId: org.id };
    const counts = {
      users: await prisma.user.count({ where }),
      channels: await prisma.channel.count({ where }),
      messages: await prisma.message.count({ where }),
      attendanceDays: await prisma.attendanceRecord.count({ where }),
      leaveRequests: await prisma.leaveRequest.count({ where }),
      announcements: await prisma.announcement.count({ where }),
    };
    console.log(`Organization "${org.name}" (${slug}) would be deleted with:`, counts);
  } else {
    console.log(`No organization "${slug}" yet; it will be created.`);
  }
  console.log('Afterwards a first Super Admin is created with a temporary password printed once (they change it at first sign-in).');

  if (process.env.CONFIRM_RESET !== slug) {
    console.log('\nDry run only. Set CONFIRM_RESET to the same value as ORG_SLUG to really reset.');
    return;
  }

  // Check the bootstrap values before deleting anything, so a typo cannot leave the database without an organization.
  const { ORG_NAME, ORG_DOMAIN, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ORG_NAME || !ORG_DOMAIN) throw new RefusedError('Set ORG_NAME and ORG_DOMAIN. Nothing was deleted.');
  const email = emailSchema.safeParse(ADMIN_EMAIL ?? '');
  if (!email.success) throw new RefusedError('Set ADMIN_EMAIL to the first Super Admin’s work email. Nothing was deleted.');
  if (email.data.split('@')[1] !== ORG_DOMAIN.trim().toLowerCase()) throw new RefusedError(`ADMIN_EMAIL must be on ${ORG_DOMAIN}. Nothing was deleted.`);
  if (ADMIN_PASSWORD && !passwordSchema.safeParse(ADMIN_PASSWORD).success) throw new RefusedError('ADMIN_PASSWORD is too weak (10+ characters with upper, lower case and a number). Nothing was deleted.');
  const elsewhere = await prisma.user.findUnique({ where: { email: email.data }, select: { organizationId: true } });
  if (elsewhere && elsewhere.organizationId !== org?.id) throw new RefusedError(`${email.data} belongs to another organization. Nothing was deleted.`);

  if (org) {
    await prisma.organization.delete({ where: { id: org.id } }); // cascades to all org data
    console.log(`Deleted "${org.name}".`);
  }
  await bootstrapSuperAdmin(prisma, { ...process.env, CONFIRM_BOOTSTRAP: 'yes' });
}

main()
  .catch((e: Error) => {
    console.error(e instanceof RefusedError ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
