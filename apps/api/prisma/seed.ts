/**
 * Development seed: Futurist Global with departments, roles, ~16 employees,
 * default channels, sample conversations, holidays and announcements.
 * Also creates a second organization ("Acme Test Co") used to verify tenant isolation.
 *
 * Idempotent per organization: re-running wipes and recreates the seeded orgs.
 * Requires SEED_PASSWORD (never hard-coded). Refuses to run in production.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, organizationSettingsSchema } from '@fg/shared';

const prisma = new PrismaClient();

const DEPARTMENTS = [
  { name: 'Engineering', color: '#6366f1', description: 'Product engineering and platform' },
  { name: 'Quality Assurance', color: '#14b8a6', description: 'Testing and release quality' },
  { name: 'Human Resources', color: '#ec4899', description: 'People operations' },
  { name: 'Design', color: '#f59e0b', description: 'Product and brand design' },
  { name: 'Sales & Marketing', color: '#0ea5e9', description: 'Growth, partnerships and brand' },
  { name: 'Management', color: '#8b5cf6', description: 'Leadership team' },
];

type Person = {
  first: string;
  last: string;
  email: string;
  role: string;
  superAdmin?: boolean;
  dept: string;
  title: string;
  manager?: string;
  joined: string;
  birthday?: string;
  presence?: string;
  statusEmoji?: string;
  statusText?: string;
  color: string;
};

function relDate(daysFromToday: number, year: number) {
  const d = new Date(Date.now() + daysFromToday * 86400_000);
  return `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const PEOPLE: Person[] = [
  { first: 'Aarav', last: 'Mehta', email: 'admin@futuristglobal.com', role: 'administrator', superAdmin: true, dept: 'Management', title: 'Chief Technology Officer', joined: '2019-04-01', color: '#8b5cf6', presence: 'working', statusText: 'Planning Q1 roadmap' },
  { first: 'Priya', last: 'Sharma', email: 'hr@futuristglobal.com', role: 'hr_admin', dept: 'Human Resources', title: 'HR Manager', manager: 'admin@futuristglobal.com', joined: '2020-07-15', birthday: relDate(3, 1991), color: '#ec4899', presence: 'in_office' },
  { first: 'Rohan', last: 'Verma', email: 'manager@futuristglobal.com', role: 'manager', dept: 'Engineering', title: 'Engineering Manager', manager: 'admin@futuristglobal.com', joined: relDate(5, 2021), color: '#0ea5e9', presence: 'meeting', statusText: 'Sprint planning' },
  { first: 'Ananya', last: 'Iyer', email: 'employee@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Senior Frontend Engineer', manager: 'manager@futuristglobal.com', joined: '2022-02-01', birthday: relDate(0, 1996), color: '#14b8a6', presence: 'focus', statusText: 'Deep work until 3pm' },
  { first: 'Kabir', last: 'Singh', email: 'kabir.singh@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Backend Engineer', manager: 'manager@futuristglobal.com', joined: '2023-06-12', color: '#22c55e', presence: 'wfh' },
  { first: 'Meera', last: 'Nair', email: 'meera.nair@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'DevOps Engineer', manager: 'manager@futuristglobal.com', joined: '2021-11-08', color: '#f59e0b', presence: 'available' },
  { first: 'Vikram', last: 'Rao', email: 'vikram.rao@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Full-Stack Engineer', manager: 'manager@futuristglobal.com', joined: '2024-01-22', color: '#ef4444', presence: 'lunch' },
  { first: 'Sneha', last: 'Kulkarni', email: 'sneha.kulkarni@futuristglobal.com', role: 'manager', dept: 'Quality Assurance', title: 'QA Lead', manager: 'admin@futuristglobal.com', joined: '2020-09-30', color: '#14b8a6', presence: 'available' },
  { first: 'Arjun', last: 'Patel', email: 'arjun.patel@futuristglobal.com', role: 'employee', dept: 'Quality Assurance', title: 'QA Engineer', manager: 'sneha.kulkarni@futuristglobal.com', joined: '2023-03-01', birthday: relDate(9, 1998), color: '#6366f1', presence: 'short_break' },
  { first: 'Isha', last: 'Gupta', email: 'isha.gupta@futuristglobal.com', role: 'employee', dept: 'Quality Assurance', title: 'Automation Engineer', manager: 'sneha.kulkarni@futuristglobal.com', joined: relDate(11, 2022), color: '#ec4899', presence: 'available' },
  { first: 'Dev', last: 'Malhotra', email: 'dev.malhotra@futuristglobal.com', role: 'manager', dept: 'Design', title: 'Design Lead', manager: 'admin@futuristglobal.com', joined: '2021-05-17', color: '#f59e0b', presence: 'busy', statusText: 'Client review' },
  { first: 'Tara', last: 'Joshi', email: 'tara.joshi@futuristglobal.com', role: 'employee', dept: 'Design', title: 'Product Designer', manager: 'dev.malhotra@futuristglobal.com', joined: '2024-08-05', color: '#8b5cf6', presence: 'available' },
  { first: 'Nikhil', last: 'Bansal', email: 'nikhil.bansal@futuristglobal.com', role: 'manager', dept: 'Sales & Marketing', title: 'Head of Growth', manager: 'admin@futuristglobal.com', joined: '2020-01-06', color: '#0ea5e9', presence: 'stepped_out' },
  { first: 'Zara', last: 'Khan', email: 'zara.khan@futuristglobal.com', role: 'employee', dept: 'Sales & Marketing', title: 'Marketing Specialist', manager: 'nikhil.bansal@futuristglobal.com', joined: '2025-02-10', color: '#22c55e', presence: 'available' },
  { first: 'Rahul', last: 'Desai', email: 'rahul.desai@futuristglobal.com', role: 'employee', dept: 'Human Resources', title: 'Talent Acquisition', manager: 'hr@futuristglobal.com', joined: '2023-10-02', color: '#ef4444', presence: 'dnd', statusText: 'Interviews back-to-back' },
  { first: 'Neha', last: 'Reddy', email: 'neha.reddy@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Mobile Engineer', manager: 'manager@futuristglobal.com', joined: relDate(2, 2023), color: '#6366f1', presence: 'away' },
];

const CONVERSATIONS: Record<string, [string, string, number][]> = {
  // [author email, body, minutes ago]
  general: [
    ['hr@futuristglobal.com', 'Good morning everyone. Reminder: the townhall is on Friday at 4pm in the main conference room and on the stream.', 300],
    ['admin@futuristglobal.com', 'Welcome to FG One, team. This is now our home for chat, updates and HR. Shout here if anything looks off.', 240],
    ['kabir.singh@futuristglobal.com', 'Loving the new workspace already. Dark mode looks great.', 200],
    ['zara.khan@futuristglobal.com', 'The Diwali celebration photos are up on the shared drive — thank you all for making it special!', 95],
    ['manager@futuristglobal.com', 'Kudos to @Ananya for shipping the new onboarding flow ahead of schedule.', 40],
  ],
  development: [
    ['manager@futuristglobal.com', 'Sprint 42 starts today. Board is updated — please pick your tickets by noon.', 180],
    ['meera.nair@futuristglobal.com', 'Staging deploy is green. Prod release window is 6pm.', 120],
    ['employee@futuristglobal.com', 'PR for the dashboard widgets is up, would love a review when someone has a moment.', 60],
    ['vikram.rao@futuristglobal.com', 'On it, reviewing now.', 55],
  ],
  'qa-testing': [
    ['sneha.kulkarni@futuristglobal.com', 'Regression suite for 3.8 is scheduled tonight. Please log blockers here.', 150],
    ['arjun.patel@futuristglobal.com', 'Found a flaky test in the payments flow, raising a ticket.', 70],
  ],
  'project-updates': [
    ['manager@futuristglobal.com', 'Onboarding revamp: design signed off, build is 70% done. Tracking in https://github.com/arvind-m-dev/F-G_one', 210],
    ['dev.malhotra@futuristglobal.com', 'Updated the dashboard explorations in Figma, feedback welcome before Thursday.', 90],
  ],
  ideas: [['tara.joshi@futuristglobal.com', 'What if daily standups could be posted straight from chat and summarised for the week?', 160]],
  announcements: [['hr@futuristglobal.com', 'Open enrolment for the health insurance top-up closes on the 15th. Details in the HR announcement on your dashboard.', 1440]],
};

const DM: [string, string, string, number][] = [
  ['manager@futuristglobal.com', 'employee@futuristglobal.com', 'Hey Ananya, can we sync for 10 mins about the widget layout?', 30],
  ['employee@futuristglobal.com', 'manager@futuristglobal.com', 'Sure! Free after 2:30.', 25],
  ['manager@futuristglobal.com', 'employee@futuristglobal.com', 'Perfect, sending an invite.', 22],
  ['hr@futuristglobal.com', 'employee@futuristglobal.com', 'Happy birthday in advance. Cake in the pantry at 4!', 10],
];

async function seedOrg(opts: { name: string; slug: string; domain: string; password: string; minimal?: boolean }) {
  await prisma.organization.deleteMany({ where: { slug: opts.slug } });
  const settings = organizationSettingsSchema.parse({ auth: { allowedEmailDomains: [opts.domain] } });
  const org = await prisma.organization.create({
    data: { name: opts.name, slug: opts.slug, primaryColor: '#6366F1', secondaryColor: '#8B5CF6', settings },
  });

  const roles = Object.fromEntries(
    await Promise.all(
      DEFAULT_ROLE_DEFINITIONS.map(async (r) => [
        r.key,
        await prisma.role.create({ data: { organizationId: org.id, key: r.key, name: r.name, description: r.description, grants: { create: DEFAULT_ROLE_GRANTS[r.key] }, rank: r.rank, isSystem: true } }),
      ]),
    ),
  );
  const passwordHash = await hash(opts.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  if (opts.minimal) {
    await prisma.user.create({
      data: { organizationId: org.id, email: `admin@${opts.domain}`, firstName: 'Other', lastName: 'Admin', roleId: roles.administrator.id, isSuperAdmin: true, status: 'ACTIVE', passwordHash },
    });
    return org;
  }

  const depts = Object.fromEntries(
    await Promise.all(DEPARTMENTS.map(async (d) => [d.name, await prisma.department.create({ data: { ...d, organizationId: org.id } })])),
  );

  const users: Record<string, { id: string }> = {};
  for (const p of PEOPLE) {
    users[p.email] = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: p.email,
        firstName: p.first,
        lastName: p.last,
        designation: p.title,
        roleId: roles[p.role].id,
        isSuperAdmin: p.superAdmin === true,
        departmentId: depts[p.dept].id,
        managerId: p.manager ? users[p.manager]?.id : null,
        joinedAt: new Date(`${p.joined}T00:00:00Z`),
        birthday: p.birthday ? new Date(`${p.birthday}T00:00:00Z`) : null,
        employeeCode: `FG${String(Object.keys(users).length + 1001)}`,
        avatarColor: p.color,
        status: 'ACTIVE',
        passwordHash,
        presence: p.presence ?? 'available',
        statusEmoji: p.statusEmoji ?? null,
        statusText: p.statusText ?? null,
      },
    });
  }
  // Pending invitee (no password yet) to demonstrate the invite flow in the admin UI.
  await prisma.user.create({
    data: { organizationId: org.id, email: 'new.joiner@futuristglobal.com', firstName: 'Riya', lastName: 'Kapoor', designation: 'Junior Engineer', roleId: roles.employee.id, departmentId: depts['Engineering'].id, status: 'INVITED', avatarColor: '#0ea5e9' },
  });

  await prisma.department.update({ where: { id: depts['Engineering'].id }, data: { headId: users['manager@futuristglobal.com'].id } });
  await prisma.department.update({ where: { id: depts['Human Resources'].id }, data: { headId: users['hr@futuristglobal.com'].id } });
  await prisma.department.update({ where: { id: depts['Quality Assurance'].id }, data: { headId: users['sneha.kulkarni@futuristglobal.com'].id } });

  const all = Object.values(users).map((u) => u.id);
  const deptMembers = (dept: string) => PEOPLE.filter((p) => p.dept === dept).map((p) => users[p.email].id);
  const channelDefs = [
    { name: 'general', description: 'Company-wide chatter and news', type: 'PUBLIC' as const, isDefault: true, members: all },
    { name: 'announcements', description: 'Official company announcements', type: 'PUBLIC' as const, isDefault: true, members: all },
    { name: 'development', description: 'Engineering discussion, reviews and releases', type: 'PUBLIC' as const, members: deptMembers('Engineering') },
    { name: 'qa-testing', description: 'Test plans, bug reports and verification', type: 'PUBLIC' as const, members: [...deptMembers('Quality Assurance'), ...deptMembers('Engineering').slice(0, 2)] },
    { name: 'project-updates', description: 'Status updates across projects', type: 'PUBLIC' as const, members: all },
    { name: 'ideas', description: 'Suggestions to improve the product and the workplace', type: 'PUBLIC' as const, members: all.slice(0, 12) },
    { name: 'help-support', description: 'Ask for help with tools, access and IT', type: 'PUBLIC' as const, members: all.slice(0, 9) },
    { name: 'team-discussion', description: 'Water-cooler conversations', type: 'PUBLIC' as const, members: all.slice(0, 10) },
    { name: 'management', description: 'Leadership — private', type: 'PRIVATE' as const, members: PEOPLE.filter((p) => ['administrator', 'hr_admin', 'manager'].includes(p.role)).map((p) => users[p.email].id) },
  ];
  const admin = users['admin@futuristglobal.com'].id;
  for (const c of channelDefs) {
    const ch = await prisma.channel.create({
      data: {
        organizationId: org.id,
        type: c.type,
        name: c.name,
        description: c.description,
        isDefault: c.isDefault ?? false,
        createdById: admin,
        members: { create: c.members.map((userId) => ({ userId, role: userId === admin ? 'ADMIN' : 'MEMBER', lastReadAt: new Date(Date.now() - 600 * 60_000) })) },
      },
    });
    let last: Date | null = null;
    for (const [email, body, ago] of CONVERSATIONS[c.name] ?? []) {
      last = new Date(Date.now() - ago * 60_000);
      const msg = await prisma.message.create({ data: { organizationId: org.id, channelId: ch.id, authorId: users[email].id, body, createdAt: last } });
      if (body.includes('Kudos') || body.includes('Staging deploy')) {
        const reactors = c.members.filter((id) => id !== users[email].id).slice(0, 4);
        await prisma.messageReaction.createMany({
          data: reactors.map((userId, i) => ({ messageId: msg.id, userId, emoji: i % 2 ? 'party' : 'thumbs-up' })),
        });
      }
    }
    if (last) await prisma.channel.update({ where: { id: ch.id }, data: { lastMessageAt: last } });
    // Admin has read everything they posted in; reset their read marker for realism.
    await prisma.channelMember.updateMany({ where: { channelId: ch.id, userId: admin }, data: { lastReadAt: new Date() } });
  }

  // A DM thread
  const a = users['manager@futuristglobal.com'].id;
  const b = users['employee@futuristglobal.com'].id;
  const h = users['hr@futuristglobal.com'].id;
  for (const pair of [[a, b], [h, b]]) {
    const ids = [...pair].sort();
    const dm = await prisma.channel.create({
      data: { organizationId: org.id, type: 'DIRECT', directKey: ids.join(':'), createdById: pair[0], members: { create: ids.map((userId) => ({ userId, lastReadAt: new Date(Date.now() - 600 * 60_000) })) } },
    });
    let last: Date | null = null;
    for (const [from, to, body, ago] of DM) {
      if (!pair.includes(users[from].id) || !pair.includes(users[to].id)) continue;
      last = new Date(Date.now() - ago * 60_000);
      await prisma.message.create({ data: { organizationId: org.id, channelId: dm.id, authorId: users[from].id, body, createdAt: last } });
    }
    if (last) await prisma.channel.update({ where: { id: dm.id }, data: { lastMessageAt: last } });
  }

  const year = new Date().getUTCFullYear();
  const holidays = [
    ['New Year', `${year + 1}-01-01`, 'MANDATORY'],
    ['Makar Sankranti / Pongal', `${year + 1}-01-14`, 'OPTIONAL'],
    ['Republic Day', `${year + 1}-01-26`, 'MANDATORY'],
    ['Holi', `${year + 1}-03-04`, 'MANDATORY'],
    ['Christmas', `${year}-12-25`, 'MANDATORY'],
    ['Company offsite', `${year}-12-11`, 'COMPANY'],
    ['Year-end release Saturday', `${year}-12-19`, 'SPECIAL_WORKING_DAY'],
    ['Guru Nanak Jayanti', `${year}-11-24`, 'OPTIONAL'],
    ['Gandhi Jayanti', `${year}-10-02`, 'MANDATORY'],
  ] as const;
  await prisma.holiday.createMany({
    data: holidays.map(([name, date, type]) => ({ organizationId: org.id, name, date: new Date(`${date}T00:00:00Z`), type })),
  });

  // ── Attendance: last 20 working days for everyone + a realistic "today" ──
  const tz = 'Asia/Kolkata';
  const ymdIn = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const at = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+05:30`);
  const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const locations = ['WFO', 'WFO', 'WFO', 'WFH', 'WFH', 'ON_DUTY'] as const;
  const todayYmd = ymdIn(new Date());
  const ids = Object.values(users).map((u) => u.id);
  let seedN = 7;
  const rnd = () => ((seedN = (seedN * 9301 + 49297) % 233280) / 233280);
  for (let back = 28; back >= 1; back--) {
    const day = new Date(Date.now() - back * 86400_000);
    const ymd = ymdIn(day);
    const wd = new Date(`${ymd}T12:00:00+05:30`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (const uid of ids) {
      if (rnd() < 0.08) continue; // occasional absence
      const inMin = 9 * 60 + 5 + Math.floor(rnd() * 55);
      const outMin = 18 * 60 + Math.floor(rnd() * 70);
      const rec = await prisma.attendanceRecord.create({
        data: {
          organizationId: org.id, userId: uid, date: new Date(`${ymd}T00:00:00Z`), location: locations[Math.floor(rnd() * locations.length)],
          checkInAt: at(ymd, pad(inMin)), checkOutAt: at(ymd, pad(outMin)), late: inMin > 9 * 60 + 45,
        },
      });
      await prisma.attendanceBreak.create({ data: { recordId: rec.id, startAt: at(ymd, '13:10'), endAt: at(ymd, pad(13 * 60 + 25 + Math.floor(rnd() * 30))) } });
    }
  }
  // Today: most people are in; a few are not yet (the demo employee checks in themselves).
  const nowLocal = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const todayWd = new Date(`${todayYmd}T12:00:00+05:30`).getUTCDay();
  if (todayWd !== 0 && todayWd !== 6 && nowLocal > '09:15') {
    const todayPeople = PEOPLE.filter((p) => !['employee@futuristglobal.com', 'neha.reddy@futuristglobal.com', 'zara.khan@futuristglobal.com'].includes(p.email));
    for (const [i, p] of todayPeople.entries()) {
      const loc = p.presence === 'wfh' ? 'WFH' : i % 5 === 0 ? 'ON_DUTY' : i % 3 === 0 ? 'WFH' : 'WFO';
      const rec = await prisma.attendanceRecord.create({
        data: { organizationId: org.id, userId: users[p.email].id, date: new Date(`${todayYmd}T00:00:00Z`), location: loc, checkInAt: at(todayYmd, `09:${String(10 + i * 3).padStart(2, '0')}`), late: 10 + i * 3 > 45, remarks: loc === 'ON_DUTY' ? 'At the client office' : null },
      });
      // Breaks taken so far today: a short morning tea and lunch, once the day has got that far.
      const teaAt = 11 * 60 + (i % 4) * 5;
      const lunchAt = 13 * 60 + (i % 3) * 10;
      if (nowLocal > '11:30') await prisma.attendanceBreak.create({ data: { recordId: rec.id, startAt: at(todayYmd, pad(teaAt)), endAt: at(todayYmd, pad(teaAt + 15)) } });
      if (nowLocal > '14:00') await prisma.attendanceBreak.create({ data: { recordId: rec.id, startAt: at(todayYmd, pad(lunchAt)), endAt: at(todayYmd, pad(lunchAt + 35 + (i % 4) * 5)) } });
      if (['lunch', 'short_break'].includes(p.presence ?? '')) await prisma.attendanceBreak.create({ data: { recordId: rec.id, startAt: new Date(Date.now() - 12 * 60_000) } });
      if (i % 6 === 5 && nowLocal > '17:30') await prisma.attendanceRecord.update({ where: { id: rec.id }, data: { checkOutAt: new Date(Date.now() - 20 * 60_000) } });
    }
  }

  await prisma.announcement.createMany({
    data: [
      { organizationId: org.id, authorId: users['admin@futuristglobal.com'].id, title: 'Welcome to FG One', category: 'NEW_FEATURE', body: 'FG One is our new unified workspace for chat, attendance, HR and daily updates. Explore the dashboard, set your status, and say hi in #general!', priority: 'IMPORTANT', pinned: true, publishedAt: new Date(Date.now() - 2 * 86400_000) },
      { organizationId: org.id, authorId: users['hr@futuristglobal.com'].id, title: 'Health insurance top-up enrolment', category: 'POLICY', requireAck: true, body: 'Open enrolment for the optional family health insurance top-up closes on the 15th. Reach out to HR for plan details.', priority: 'NORMAL', publishedAt: new Date(Date.now() - 86400_000) },
      { organizationId: org.id, authorId: users['manager@futuristglobal.com'].id, departmentId: depts['Engineering'].id, title: 'Engineering: on-call rotation updated', category: 'TEAM_UPDATE', body: 'The on-call rotation for December is published. Please confirm your slots by Friday.', priority: 'NORMAL', publishedAt: new Date(Date.now() - 6 * 3600_000) },
      { organizationId: org.id, authorId: users['hr@futuristglobal.com'].id, title: 'Annual townhall — Friday 4 PM', category: 'EVENT', body: 'Join leadership for the annual townhall. Q&A submissions are open until Thursday evening.', priority: 'CRITICAL', publishedAt: new Date(Date.now() - 3 * 3600_000) },
    ],
  });

  // ── Leave types and requests ──
  const lt = Object.fromEntries(
    await Promise.all(
      [
        { code: 'CL', name: 'Casual leave', annualAllowance: 12, color: '#0ea5e9' },
        { code: 'SL', name: 'Sick leave', annualAllowance: 8, color: '#f43f5e' },
        { code: 'EL', name: 'Earned leave', annualAllowance: 15, color: '#10b981' },
        { code: 'UL', name: 'Unpaid leave', annualAllowance: 0, color: '#94a3b8', paid: false },
      ].map(async (t) => [t.code, await prisma.leaveType.create({ data: { ...t, organizationId: org.id } })]),
    ),
  );
  const d = (offset: number) => ymdIn(new Date(Date.now() + offset * 86400_000));
  // Overlapping, multi-day leaves around today so the team calendar shows who is away together.
  const leaveRows: { email: string; type: string; from: number; to: number; status: 'APPROVED' | 'PENDING' | 'REJECTED'; reason: string }[] = [
    { email: 'employee@futuristglobal.com', type: 'CL', from: -20, to: -20, status: 'APPROVED', reason: 'Family function' },
    { email: 'employee@futuristglobal.com', type: 'SL', from: -9, to: -8, status: 'APPROVED', reason: 'Fever' },
    { email: 'employee@futuristglobal.com', type: 'EL', from: 3, to: 7, status: 'APPROVED', reason: 'Family trip to Kerala' },
    { email: 'vikram.rao@futuristglobal.com', type: 'CL', from: 4, to: 5, status: 'APPROVED', reason: 'House shifting' },
    { email: 'kabir.singh@futuristglobal.com', type: 'EL', from: 6, to: 8, status: 'PENDING', reason: 'Trip to Goa' },
    { email: 'neha.reddy@futuristglobal.com', type: 'SL', from: -2, to: 1, status: 'APPROVED', reason: 'Viral fever' },
    { email: 'meera.nair@futuristglobal.com', type: 'CL', from: 2, to: 2, status: 'PENDING', reason: 'Bank work' },
    { email: 'isha.gupta@futuristglobal.com', type: 'CL', from: 5, to: 6, status: 'APPROVED', reason: 'Sister\'s wedding' },
    { email: 'manager@futuristglobal.com', type: 'EL', from: 10, to: 14, status: 'APPROVED', reason: 'Vacation' },
    { email: 'tara.joshi@futuristglobal.com', type: 'EL', from: 12, to: 16, status: 'APPROVED', reason: 'Vacation' },
    { email: 'hr@futuristglobal.com', type: 'EL', from: -6, to: -4, status: 'APPROVED', reason: 'Personal' },
    { email: 'arjun.patel@futuristglobal.com', type: 'CL', from: -3, to: -3, status: 'REJECTED', reason: 'Release week' },
  ];
  // Working days in a range of day offsets (weekends excluded), as the API counts them.
  const workingDaysBetween = (from: number, to: number) => {
    let n = 0;
    for (let o = from; o <= to; o++) {
      const wd = new Date(`${d(o)}T12:00:00+05:30`).getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  };
  for (const l of leaveRows) {
    const u = users[l.email];
    const approver = PEOPLE.find((p) => p.email === l.email)?.manager;
    await prisma.leaveRequest.create({
      data: {
        organizationId: org.id, userId: u.id, typeId: lt[l.type].id, startDate: new Date(`${d(l.from)}T00:00:00Z`), endDate: new Date(`${d(l.to)}T00:00:00Z`), days: workingDaysBetween(l.from, l.to), reason: l.reason, status: l.status,
        approverId: l.status !== 'PENDING' && approver ? users[approver].id : null, decidedAt: l.status !== 'PENDING' ? new Date() : null,
      },
    });
  }
  // A pending attendance correction for the engineering manager to review.
  await prisma.attendanceCorrection.create({
    data: { organizationId: org.id, userId: users['vikram.rao@futuristglobal.com'].id, date: new Date(`${d(-1)}T00:00:00Z`), checkIn: '09:20', checkOut: '18:40', location: 'WFO', reason: 'Forgot to check out — was in the office until 6:40 PM' },
  });

  // A couple of unread notifications so the inbox isn't empty for the demo employee.
  const emp = users['employee@futuristglobal.com'].id;
  const general = await prisma.channel.findFirstOrThrow({ where: { organizationId: org.id, name: 'general' } });
  await prisma.notification.createMany({
    data: [
      { organizationId: org.id, userId: emp, actorId: users['manager@futuristglobal.com'].id, type: 'mention', title: 'Rohan Verma mentioned you in #general', body: 'Kudos to @Ananya for shipping the new onboarding flow ahead of schedule.', link: `/app/chat/${general.id}`, createdAt: new Date(Date.now() - 40 * 60_000) },
      { organizationId: org.id, userId: emp, actorId: users['hr@futuristglobal.com'].id, type: 'announcement', title: 'Please read: Health insurance top-up enrolment', body: 'Open enrolment for the optional family health insurance top-up closes on the 15th.', link: '/app/announcements', createdAt: new Date(Date.now() - 86400_000) },
    ],
  });

  return org;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) throw new Error('Set SEED_PASSWORD (10+ chars) in apps/api/.env before seeding');

  await seedOrg({ name: 'Futurist Global', slug: process.env.DEFAULT_ORG_SLUG || 'futurist-global', domain: 'futuristglobal.com', password });
  await seedOrg({ name: 'Acme Test Co', slug: 'acme-test', domain: 'acme.test', password, minimal: true });
  console.log('Seeded Futurist Global (16 active employees, 1 pending invite) and Acme Test Co.');
  console.log('  Sign in with admin@ / hr@ / manager@ / employee@futuristglobal.com using SEED_PASSWORD.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
