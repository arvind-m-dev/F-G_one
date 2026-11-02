import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Auth, AuthContext } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { personSelect, toPerson } from '../employees/employee.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const q = z.object({ q: z.string().trim().min(1).max(100) });

/** Global search. Every result set is limited to what the caller is allowed to see. */
@Controller('search')
export class SearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async search(@Auth() auth: AuthContext, @Query(new ZodPipe(q)) { q: term }: { q: string }) {
    const contains = { contains: term, mode: 'insensitive' as const };
    const [people, channels, messages] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          organizationId: auth.organizationId,
          status: 'ACTIVE',
          OR: [{ firstName: contains }, { lastName: contains }, { displayName: contains }, { email: contains }, { designation: contains }],
        },
        select: personSelect,
        take: 6,
      }),
      this.prisma.channel.findMany({
        where: {
          organizationId: auth.organizationId,
          type: { not: 'DIRECT' },
          archivedAt: null,
          OR: [{ name: contains }, { description: contains }],
          AND: [{ OR: [{ type: 'PUBLIC' }, { members: { some: { userId: auth.userId } } }] }],
        },
        select: { id: true, name: true, type: true, description: true },
        take: 5,
      }),
      this.prisma.message.findMany({
        where: {
          organizationId: auth.organizationId,
          deletedAt: null,
          body: contains,
          channel: { members: { some: { userId: auth.userId } } }, // only conversations the caller belongs to
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          body: true,
          createdAt: true,
          channelId: true,
          channel: { select: { name: true, type: true } },
          author: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);
    return {
      people: people.map((p) => toPerson(p, this.realtime.isOnline(p.id))),
      channels,
      messages: messages.map((m) => ({ ...m, body: m.body.slice(0, 200) })),
    };
  }
}
