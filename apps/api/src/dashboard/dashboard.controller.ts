import { Controller, Get } from '@nestjs/common';
import { parseOrganizationSettings, PERMISSIONS } from '@fg/shared';
import { ChatService } from '../chat/chat.service';
import { Auth, AuthContext, RequirePermissions } from '../common/auth-context';
import { fmtDateOnly, startOfUtcDay } from '../common/dates';
import { localDate, toDbDate } from '../common/tz';
import { personSelect, toPerson } from '../employees/employee.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const DAY = 86400_000;

/** Days from today until the next occurrence of a month/day (0 = today). */
function daysUntilAnniversary(date: Date, today: Date) {
  const y = today.getUTCFullYear();
  let next = Date.UTC(y, date.getUTCMonth(), date.getUTCDate());
  if (next < today.getTime()) next = Date.UTC(y + 1, date.getUTCMonth(), date.getUTCDate());
  return Math.round((next - today.getTime()) / DAY);
}

@Controller()
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly chat: ChatService,
  ) {}

  /** Everything the personal dashboard needs, in one round-trip, scoped to the caller. */
  @Get('dashboard')
  async dashboard(@Auth() auth: AuthContext) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { departmentId: true, managerId: true } });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    const settings = parseOrganizationSettings(org.settings);
    // "Today" is the organization's calendar day, so holidays and celebrations don't shift around midnight UTC.
    const today = toDbDate(localDate(settings.attendance.timezone));

    const teamFilter = [
      ...(me.departmentId ? [{ departmentId: me.departmentId }] : []),
      ...(me.managerId ? [{ id: me.managerId }, { managerId: me.managerId }] : []),
      { managerId: auth.userId },
    ];

    const [team, announcements, holidays, people, headcount, departments, joinersThisMonth, channels] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId: auth.organizationId, status: 'ACTIVE', id: { not: auth.userId }, OR: teamFilter },
        select: personSelect,
        take: 24,
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.announcement.findMany({
        where: {
          organizationId: auth.organizationId,
          publishedAt: { lte: new Date() },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            { OR: [{ departmentId: null }, ...(me.departmentId ? [{ departmentId: me.departmentId }] : [])] },
          ],
        },
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        take: 6,
        include: { author: { select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true } }, department: { select: { name: true } } },
      }),
      this.prisma.holiday.findMany({ where: { organizationId: auth.organizationId, date: { gte: today } }, orderBy: { date: 'asc' }, take: 6 }),
      this.prisma.user.findMany({
        where: { organizationId: auth.organizationId, status: 'ACTIVE' },
        select: { ...personSelect, birthday: true, showBirthday: true, joinedAt: true },
      }),
      this.prisma.user.count({ where: { organizationId: auth.organizationId, status: 'ACTIVE' } }),
      this.prisma.department.count({ where: { organizationId: auth.organizationId } }),
      this.prisma.user.count({
        where: { organizationId: auth.organizationId, status: 'ACTIVE', joinedAt: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)) } },
      }),
      this.chat.listMine(auth),
    ]);

    const celebrations: { type: 'birthday' | 'anniversary'; inDays: number; years?: number; person: ReturnType<typeof toPerson> }[] = [];
    for (const p of people) {
      if (p.birthday && p.showBirthday) {
        const d = daysUntilAnniversary(p.birthday, today);
        if (d <= 14) celebrations.push({ type: 'birthday', inDays: d, person: toPerson(p) });
      }
      if (p.joinedAt) {
        const d = daysUntilAnniversary(p.joinedAt, today);
        const years = today.getUTCFullYear() + (d > 0 && new Date(today.getTime() + d * DAY).getUTCFullYear() > today.getUTCFullYear() ? 1 : 0) - p.joinedAt.getUTCFullYear();
        if (d <= 14 && years >= 1) celebrations.push({ type: 'anniversary', inDays: d, years, person: toPerson(p) });
      }
    }
    celebrations.sort((a, b) => a.inDays - b.inDays);

    const [myMessages, myProfile] = await Promise.all([
      this.prisma.message.count({ where: { authorId: auth.userId, deletedAt: null } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { bio: true, phone: true, avatarUrl: true, statusText: true, presence: true } }),
    ]);
    const onlineIds = new Set(this.realtime.onlineIds());
    return {
      workday: { start: settings.attendance.workdayStart, end: settings.attendance.workdayEnd, workingDays: settings.attendance.workingDays, timezone: settings.attendance.timezone },
      team: team.map((t) => toPerson(t, onlineIds.has(t.id))),
      announcements,
      holidays: holidays.map((h) => ({ ...h, date: fmtDateOnly(h.date) })),
      celebrations: celebrations.slice(0, 8),
      recentChats: channels.slice(0, 6),
      unreadTotal: channels.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0),
      orgStats: { headcount, departments, joinersThisMonth, onlineNow: people.filter((p) => onlineIds.has(p.id)).length },
      onboarding: {
        sentMessage: myMessages > 0,
        profileComplete: !!(myProfile.bio && myProfile.phone),
        statusSet: !!myProfile.statusText || myProfile.presence !== 'available',
      },
    };
  }

  /** Admin analytics — all values computed live from the database. */
  @Get('admin/overview')
  @RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
  async overview(@Auth() auth: AuthContext) {
    const org = auth.organizationId;
    const since14 = new Date(startOfUtcDay().getTime() - 13 * DAY);
    const [statusCounts, byDept, byRole, pendingInvites, recentAudit, messagesPerDay, channelCount, joiners, onlineNow] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], where: { organizationId: org }, _count: true }),
      this.prisma.department.findMany({
        where: { organizationId: org },
        select: { id: true, name: true, color: true, _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.role.findMany({ where: { organizationId: org }, select: { name: true, key: true, _count: { select: { users: { where: { status: 'ACTIVE' } } } } }, orderBy: { rank: 'desc' } }),
      this.prisma.invitation.count({ where: { organizationId: org, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.prisma.auditLog.findMany({
        where: { organizationId: org },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true } } },
      }),
      this.prisma.$queryRaw<{ day: Date; count: number }[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
        FROM "Message" WHERE "organizationId" = ${org} AND "createdAt" >= ${since14} AND "deletedAt" IS NULL
        GROUP BY 1 ORDER BY 1`,
      this.prisma.channel.count({ where: { organizationId: org, type: { not: 'DIRECT' }, archivedAt: null } }),
      this.prisma.$queryRaw<{ month: Date; count: number }[]>`
        SELECT date_trunc('month', "joinedAt") AS month, COUNT(*)::int AS count
        FROM "User" WHERE "organizationId" = ${org} AND "joinedAt" >= (date_trunc('month', now()) - interval '5 months')
        GROUP BY 1 ORDER BY 1`,
      // Online tracking is process-wide; count only this organization's people.
      this.prisma.user.count({ where: { organizationId: org, status: 'ACTIVE', id: { in: this.realtime.onlineIds() } } }),
    ]);

    const status = Object.fromEntries(statusCounts.map((s) => [s.status, s._count])) as Record<string, number>;
    const msgMap = new Map(messagesPerDay.map((m) => [fmtDateOnly(m.day), m.count]));
    const activity = Array.from({ length: 14 }, (_, i) => {
      const d = fmtDateOnly(new Date(since14.getTime() + i * DAY))!;
      return { date: d, messages: msgMap.get(d) ?? 0 };
    });
    const joinMap = new Map(joiners.map((j) => [fmtDateOnly(j.month)!.slice(0, 7), j.count]));
    const now = new Date();
    const hiring = Array.from({ length: 6 }, (_, i) => {
      const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
      const key = fmtDateOnly(m)!.slice(0, 7);
      return { month: key, joiners: joinMap.get(key) ?? 0 };
    });

    return {
      employees: { active: status.ACTIVE ?? 0, invited: status.INVITED ?? 0, deactivated: status.DEACTIVATED ?? 0, onlineNow },
      pendingInvites,
      channelCount,
      departments: byDept.map((d) => ({ id: d.id, name: d.name, color: d.color, members: d._count.members })),
      roles: byRole.map((r) => ({ key: r.key, name: r.name, members: r._count.users })),
      activity,
      hiring,
      recentAudit,
    };
  }
}
