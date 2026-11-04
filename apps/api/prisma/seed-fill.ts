/**
 * Demo top-up: adds the demo data an existing organization is missing, without deleting or changing anything.
 * Fills only empty areas: holidays for this year and next (dates not taken yet), leave types, leave requests,
 * attendance history, correction requests, announcements and notifications. Chat is left alone.
 * People-based data is generated only for the demo people (seed-data.ts) who exist in the organization.
 * Use it when a demo organization was only partly seeded (the full seed wipes the organization first).
 *
 * Dry run (default), shows what would be added:
 *   pnpm --filter @fg/api db:seed-fill
 * Apply:
 *   CONFIRM_FILL=futurist-global pnpm --filter @fg/api db:seed-fill
 */
import { addDays, buildContext, type LeaveRow, prisma, type SeedContext, seedAnnouncements, seedAttendance, seedCorrections, seedHolidays, seedLeave, seedLeaveTypes, seedNotifications, ymdIn } from './seed';
import { holidaysFor } from './seed-data';

/** Leave already in the database, in the shape the attendance generator uses. */
async function leaveFromDb(ctx: SeedContext): Promise<LeaveRow[]> {
  const rows = await prisma.leaveRequest.findMany({ where: { organizationId: ctx.organizationId }, include: { user: { select: { email: true } }, type: { select: { code: true } } } });
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return rows.map((l) => ({ email: l.user.email, type: l.type.code, from: ymd(l.startDate), to: ymd(l.endDate), status: l.status, reason: l.reason ?? '', halfDay: l.halfDay, days: l.days }));
}

/** Past working days in the last 30 without attendance or approved leave, for correction requests. */
async function missingDays(ctx: SeedContext, leave: LeaveRow[]) {
  const from = addDays(ctx.today, -30);
  const recs = await prisma.attendanceRecord.findMany({ where: { organizationId: ctx.organizationId, date: { gte: new Date(`${from}T00:00:00Z`) } }, select: { userId: true, date: true } });
  const have = new Set(recs.map((r) => `${r.userId}|${r.date.toISOString().slice(0, 10)}`));
  const away = new Set(leave.filter((l) => l.status === 'APPROVED').flatMap((l) => { const out: string[] = []; for (let d = l.from; d <= l.to; d = addDays(d, 1)) out.push(`${l.email}|${d}`); return out; }));
  const out: { email: string; date: string }[] = [];
  for (let d = from; d < ctx.today; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6 || ctx.daysOff.has(d)) continue;
    for (const p of ctx.people) if (!p.status && p.joined <= d && !have.has(`${p.id}|${d}`) && !away.has(`${p.email}|${d}`)) out.push({ email: p.email, date: d });
  }
  return out;
}

async function main() {
  const slug = process.env.DEFAULT_ORG_SLUG || 'futurist-global';
  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) throw new Error(`No organization with slug "${slug}"`);
  const organizationId = org.id;
  const where = { where: { organizationId } };
  let ctx = await buildContext(organizationId);
  const depts = Object.fromEntries((await prisma.department.findMany({ ...where, select: { id: true, name: true } })).map((d) => [d.name, d]));
  const demoPeople = ctx.people.length > 0;

  const year = Number(ymdIn(new Date()).slice(0, 4));
  const holidayRows = [...holidaysFor(year), ...holidaysFor(year + 1)];
  const existing = await prisma.holiday.findMany({ where: { organizationId, date: { in: holidayRows.map((h) => new Date(`${h.date}T00:00:00Z`)) } }, select: { date: true } });
  const taken = new Set(existing.map((h) => h.date.toISOString().slice(0, 10)));
  const newHolidays = holidayRows.filter((h) => !taken.has(h.date));

  const [leaveTypes, leaveRequests, attendance, announcements, corrections, notifications] = await Promise.all([
    prisma.leaveType.count(where),
    prisma.leaveRequest.count(where),
    prisma.attendanceRecord.count(where),
    prisma.announcement.count(where),
    prisma.attendanceCorrection.count(where),
    prisma.notification.count(where),
  ]);

  // Order matters: holidays before leave (days off are not counted), leave before attendance (nobody works on leave).
  const plan: { label: string; run: () => Promise<unknown> }[] = [];
  if (newHolidays.length) plan.push({ label: `${newHolidays.length} holidays (${year} and ${year + 1})`, run: async () => { await seedHolidays(organizationId); ctx = await buildContext(organizationId); } });
  if (!leaveRequests && demoPeople) plan.push({ label: `Leave types and a year of leave requests for ${ctx.people.length} demo people`, run: () => seedLeave(ctx) });
  else if (!leaveTypes) plan.push({ label: 'Leave types (Casual, Sick, Earned, Unpaid)', run: () => seedLeaveTypes(organizationId) });
  if (!attendance && demoPeople) plan.push({ label: '60 days of attendance history', run: async () => seedAttendance(ctx, await leaveFromDb(ctx)) });
  if (!corrections && demoPeople) plan.push({ label: 'Attendance correction requests (pending, approved and declined)', run: async () => { const leave = await leaveFromDb(ctx); return seedCorrections(ctx, await missingDays(ctx, leave)); } });
  if (!announcements && demoPeople) plan.push({ label: 'Announcements with read confirmations', run: () => seedAnnouncements(ctx, depts) });
  if (!notifications && demoPeople) plan.push({ label: 'Notifications that match the requests and messages', run: () => seedNotifications(ctx) });

  if (!demoPeople) console.log('None of the demo people exist in this organization, so only holidays and leave types can be added.');
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
