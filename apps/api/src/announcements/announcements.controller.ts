import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { announcementSchema, hasPermission, PERMISSIONS, RT, type AnnouncementInput } from '@fg/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Auth, AuthContext, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const listQuery = z.object({
  category: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  include: z.enum(['active', 'all']).default('active'),
});

const include = {
  author: { select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true, designation: true } },
  department: { select: { id: true, name: true, color: true } },
  _count: { select: { acks: true } },
} satisfies Prisma.AnnouncementInclude;

@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Announcements visible to the caller: company-wide or their department; managers of announcements also see expired ones. */
  private async visibility(auth: AuthContext, includeExpired: boolean): Promise<Prisma.AnnouncementWhereInput> {
    const manage = hasPermission(auth.permissions, PERMISSIONS.ANNOUNCEMENTS_MANAGE);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { departmentId: true } });
    const now = new Date();
    return {
      organizationId: auth.organizationId,
      ...(manage ? {} : { OR: [{ departmentId: null }, ...(me.departmentId ? [{ departmentId: me.departmentId }] : [])] }),
      ...(includeExpired && manage ? {} : { publishedAt: { lte: now }, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] }),
    };
  }

  private async audienceCount(organizationId: string, departmentId: string | null) {
    return this.prisma.user.count({ where: { organizationId, status: 'ACTIVE', ...(departmentId ? { departmentId } : {}) } });
  }

  @Get()
  async list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where: Prisma.AnnouncementWhereInput = {
      ...(await this.visibility(auth, q.include === 'all')),
      ...(q.category ? { category: q.category as Prisma.EnumAnnouncementCategoryFilter['equals'] } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { body: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.announcement.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: 100,
      include: { ...include, acks: { where: { userId: auth.userId }, select: { createdAt: true } } },
    });
    return rows.map(({ acks, _count, ...a }) => ({ ...a, ackCount: _count.acks, acknowledgedAt: acks[0]?.createdAt ?? null }));
  }

  @Get(':id')
  async get(@Auth() auth: AuthContext, @Param('id') id: string) {
    const a = await this.prisma.announcement.findFirst({
      where: { ...(await this.visibility(auth, true)), id },
      include: { ...include, acks: { where: { userId: auth.userId }, select: { createdAt: true } } },
    });
    if (!a) throw new NotFoundException('Announcement not found');
    const { acks, _count, ...rest } = a;
    return { ...rest, ackCount: _count.acks, acknowledgedAt: acks[0]?.createdAt ?? null, audience: await this.audienceCount(auth.organizationId, a.departmentId) };
  }

  @Post(':id/ack')
  @HttpCode(200)
  async ack(@Auth() auth: AuthContext, @Param('id') id: string) {
    const a = await this.prisma.announcement.findFirst({ where: { ...(await this.visibility(auth, false)), id } });
    if (!a) throw new NotFoundException('Announcement not found');
    await this.prisma.announcementAck.upsert({
      where: { announcementId_userId: { announcementId: id, userId: auth.userId } },
      update: {},
      create: { announcementId: id, userId: auth.userId },
    });
    return { ok: true, acknowledgedAt: new Date() };
  }

  /** Who has (and hasn't) acknowledged — announcement managers only. */
  @Get(':id/acks')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  async acks(@Auth() auth: AuthContext, @Param('id') id: string) {
    const a = await this.prisma.announcement.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!a) throw new NotFoundException('Announcement not found');
    const [acked, audience] = await Promise.all([
      this.prisma.announcementAck.findMany({ where: { announcementId: id }, include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findMany({
        where: { organizationId: auth.organizationId, status: 'ACTIVE', ...(a.departmentId ? { departmentId: a.departmentId } : {}) },
        select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true },
      }),
    ]);
    const ackedIds = new Set(acked.map((x) => x.userId));
    return { acknowledged: acked.map((x) => ({ ...x.user, at: x.createdAt })), pending: audience.filter((u) => !ackedIds.has(u.id)) };
  }

  private async checkDept(auth: AuthContext, departmentId?: string | null) {
    if (departmentId && !(await this.prisma.department.count({ where: { id: departmentId, organizationId: auth.organizationId } }))) {
      throw new BadRequestException('Unknown department');
    }
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  async create(@Auth() auth: AuthContext, @Body(new ZodPipe(announcementSchema)) body: AnnouncementInput) {
    await this.checkDept(auth, body.departmentId);
    const a = await this.prisma.announcement.create({
      data: {
        organizationId: auth.organizationId,
        authorId: auth.userId,
        title: body.title,
        body: body.body,
        category: body.category,
        priority: body.priority,
        departmentId: body.departmentId ?? null,
        pinned: body.pinned,
        requireAck: body.requireAck,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      include,
    });
    await this.audit.log(auth, 'announcement.published', 'announcement', a.id, { title: a.title, departmentId: a.departmentId });
    const audience = await this.prisma.user.findMany({
      where: { organizationId: auth.organizationId, status: 'ACTIVE', ...(a.departmentId ? { departmentId: a.departmentId } : {}) },
      select: { id: true },
    });
    void this.notifications.notify({
      organizationId: auth.organizationId,
      userIds: audience.map((u) => u.id),
      actorId: auth.userId,
      type: 'announcement',
      title: a.requireAck ? `Please read: ${a.title}` : a.title,
      body: a.body.slice(0, 200),
      link: `/app/announcements?open=${a.id}`,
    });
    this.realtime.server?.to(`org:${auth.organizationId}`).emit(RT.ANNOUNCEMENTS_CHANGED, {});
    return a;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  async update(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(announcementSchema.partial())) body: Partial<AnnouncementInput>) {
    const existing = await this.prisma.announcement.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!existing) throw new NotFoundException('Announcement not found');
    await this.checkDept(auth, body.departmentId);
    const a = await this.prisma.announcement.update({
      where: { id },
      data: { ...body, expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt ? new Date(body.expiresAt) : null },
      include,
    });
    await this.audit.log(auth, 'announcement.updated', 'announcement', id, { fields: Object.keys(body) });
    this.realtime.server?.to(`org:${auth.organizationId}`).emit(RT.ANNOUNCEMENTS_CHANGED, {});
    return a;
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  async remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    const existing = await this.prisma.announcement.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!existing) throw new NotFoundException('Announcement not found');
    await this.prisma.announcement.delete({ where: { id } });
    await this.audit.log(auth, 'announcement.deleted', 'announcement', id, { title: existing.title });
    this.realtime.server?.to(`org:${auth.organizationId}`).emit(RT.ANNOUNCEMENTS_CHANGED, {});
    return { ok: true };
  }
}
