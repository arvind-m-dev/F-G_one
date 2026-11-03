/**
 * Demo top-up: adds the demo data an existing organization is missing, without deleting or changing anything.
 * Fills only empty areas: leave types and sample requests, announcements, a pending attendance correction,
 * inbox notifications for the demo employee, and fixed-date national holidays for this year and next.
 * Use it when a demo organization was only partly seeded (the full seed wipes the organization first).
 *
 * Dry run (default), shows what would be added:
 *   pnpm --filter @fg/api db:seed-fill
 * Apply:
 *   CONFIRM_FILL=futurist-global pnpm --filter @fg/api db:seed-fill
 */
import { PEOPLE, prisma, seedAnnouncements, seedCorrection, seedLeave, seedLeaveTypes, seedNotifications } from './seed';

// Fixed-date holidays only. Festival dates (Holi, Diwali, Eid…) move every year, so HR adds those.
const fixedHolidays = (y: number) =>
  [
    ['New Year', `${y}-01-01`, 'MANDATORY'],
    ['Republic Day', `${y}-01-26`, 'MANDATORY'],
    ['Labour Day', `${y}-05-01`, 'OPTIONAL'],
    ['Independence Day', `${y}-08-15`, 'MANDATORY'],
    ['Gandhi Jayanti', `${y}-10-02`, 'MANDATORY'],
    ['Christmas', `${y}-12-25`, 'MANDATORY'],
  ] as const;

async function main() {
  const slug = process.env.DEFAULT_ORG_SLUG || 'futurist-global';
  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) throw new Error(`No organization with slug "${slug}"`);
  const organizationId = org.id;
  const where = { where: { organizationId } };

  const users = Object.fromEntries((await prisma.user.findMany({ ...where, select: { id: true, email: true } })).map((u) => [u.email, u]));
  const depts = Object.fromEntries((await prisma.department.findMany({ ...where, select: { id: true, name: true } })).map((d) => [d.name, d]));
  // Sample requests, notifications and the correction belong to the demo people; skip them if any are missing.
  const demoPeople = PEOPLE.every((p) => users[p.email]);
  const general = await prisma.channel.findFirst({ where: { organizationId, name: 'general' } });

  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()));
  const holidayRows = [...fixedHolidays(year), ...fixedHolidays(year + 1)];
  const existing = await prisma.holiday.findMany({ where: { organizationId, date: { in: holidayRows.map(([, d]) => new Date(`${d}T00:00:00Z`)) } }, select: { date: true } });
  const taken = new Set(existing.map((h) => h.date.toISOString().slice(0, 10)));
  const newHolidays = holidayRows.filter(([, d]) => !taken.has(d));

  const [leaveTypes, leaveRequests, announcements, corrections, empNotifications] = await Promise.all([
    prisma.leaveType.count(where),
    prisma.leaveRequest.count(where),
    prisma.announcement.count(where),
    prisma.attendanceCorrection.count(where),
    users['employee@futuristglobal.com'] ? prisma.notification.count({ where: { organizationId, userId: users['employee@futuristglobal.com'].id } }) : Promise.resolve(1),
  ]);

  const plan: { label: string; run: () => Promise<unknown> }[] = [];
  if (!leaveRequests && demoPeople) plan.push({ label: 'Leave types (Casual, Sick, Earned, Unpaid) and 12 sample leave requests', run: () => seedLeave(organizationId, users) });
  else if (!leaveTypes) plan.push({ label: 'Leave types (Casual, Sick, Earned, Unpaid)', run: () => seedLeaveTypes(organizationId) });
  if (!announcements && demoPeople && depts['Engineering']) plan.push({ label: '4 announcements', run: () => seedAnnouncements(organizationId, users, depts) });
  if (!corrections && demoPeople) plan.push({ label: '1 pending attendance correction', run: () => seedCorrection(organizationId, users) });
  if (!empNotifications && demoPeople && general) plan.push({ label: '2 notifications for employee@', run: () => seedNotifications(organizationId, users) });
  if (newHolidays.length)
    plan.push({
      label: `${newHolidays.length} holidays: ${newHolidays.map(([n, d]) => `${n} ${d}`).join(', ')}`,
      run: () => prisma.holiday.createMany({ data: newHolidays.map(([name, d, type]) => ({ organizationId, name, date: new Date(`${d}T00:00:00Z`), type })), skipDuplicates: true }),
    });

  if (!demoPeople) console.log('Some demo people are missing, so sample requests, announcements and notifications are skipped.');
  if (!plan.length) return console.log(`"${org.name}" already has demo data everywhere. Nothing to add.`);
  console.log(`Would add to "${org.name}":`);
  for (const p of plan) console.log(`  - ${p.label}`);
  if (process.env.CONFIRM_FILL !== slug) return console.log(`\nDry run. Nothing changed. To apply: CONFIRM_FILL=${slug} pnpm --filter @fg/api db:seed-fill`);
  for (const p of plan) await p.run();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
