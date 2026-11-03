import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { markReadSchema, notificationsQuerySchema } from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query(new ZodPipe(notificationsQuerySchema)) q: z.infer<typeof notificationsQuerySchema>) {
    const where = {
      userId: auth.userId,
      organizationId: auth.organizationId,
      ...(q.filter === 'unread' ? { readAt: null } : {}),
      ...(q.filter === 'mentions' ? { type: { in: ['mention', 'thread'] } } : {}),
    };
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        include: { actor: { select: { id: true, firstName: true, lastName: true, displayName: true, avatarColor: true, avatarUrl: true } } },
      }),
      this.prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  @Get('unread-count')
  async unread(@Auth() auth: AuthContext) {
    return { unread: await this.prisma.notification.count({ where: { userId: auth.userId, readAt: null } }) };
  }

  @Post('read')
  @HttpCode(200)
  async read(@Auth() auth: AuthContext, @Body(new ZodPipe(markReadSchema)) body: z.infer<typeof markReadSchema>) {
    await this.prisma.notification.updateMany({
      where: { userId: auth.userId, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
      data: { readAt: new Date() },
    });
    return { unread: await this.prisma.notification.count({ where: { userId: auth.userId, readAt: null } }) };
  }
}
