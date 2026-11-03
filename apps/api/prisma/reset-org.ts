/**
 * Go-live reset: permanently deletes one organization and ALL its data (users, chat,
 * attendance, leave, announcements…), then recreates it empty with a first Super Admin
 * invitation. Use it to remove seeded demo data from a production database.
 *
 * Dry run (default) — shows what would be deleted, changes nothing:
 *   ORG_SLUG=futurist-global pnpm --filter @fg/api db:reset-org
 *
 * Real run — also requires CONFIRM_RESET to repeat the slug, plus the bootstrap values:
 *   ORG_SLUG=futurist-global CONFIRM_RESET=futurist-global \
 *   ORG_NAME="Futurist Global" ORG_DOMAIN=futuristglobal.com \
 *   ADMIN_EMAIL=it@futuristglobal.com ADMIN_FIRST=IT ADMIN_LAST=Admin \
 *   WEB_ORIGIN=https://fg-one-web.onrender.com pnpm --filter @fg/api db:reset-org
 *
 * Take a backup first (docs/DEPLOYMENT.md#backups).
 */
import { PrismaClient } from '@prisma/client';
import { bootstrap } from './bootstrap';

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.ORG_SLUG;
  if (!slug) throw new Error('Set ORG_SLUG');
  const org = await prisma.organization.findUnique({ where: { slug } });
  const host = (process.env.DATABASE_URL ?? '').replace(/^[^@]*@/, '').split('/')[0];
  console.log(`Database host: ${host}`);
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

  if (process.env.CONFIRM_RESET !== slug) {
    console.log('\nDry run only. Set CONFIRM_RESET to the same value as ORG_SLUG to really reset.');
    return;
  }
  if (org) {
    await prisma.organization.delete({ where: { id: org.id } }); // cascades to all org data
    console.log(`Deleted "${org.name}".`);
  }
  await bootstrap(prisma);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
