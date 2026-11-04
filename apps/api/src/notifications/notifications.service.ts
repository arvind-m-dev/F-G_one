import { Injectable, Logger } from '@nestjs/common';
import { RT } from '@fg/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export type NotificationType = 'dm' | 'mention' | 'thread' | 'announcement' | 'leave' | 'correction';
const PREF_KEY: Record<NotificationType, 'dm' | 'mentions' | 'threads' | 'announcements' | 'requests'> = {
  dm: 'dm',
  mention: 'mentions',
  thread: 'threads',
  announcement: 'announcements',
  leave: 'requests',
  correction: 'requests',
};

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  actorId?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Merge into an existing unread notification with this key (e.g. one per DM conversation). */
  groupKey?: string;
}

/**
 * Creates in-app notifications, honouring each user's notification preferences,
 * merging repeated unread items, and pushing them over Socket.IO.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Returns the ids of the people who were actually notified (after preferences). */
  async notify(input: NotifyInput): Promise<string[]> {
    const ids = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
    if (!ids.length) return [];
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids }, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true, preferences: true },
      });
      const key = PREF_KEY[input.type];
      const recipients = users.filter((u) => (u.preferences as { notifications?: Record<string, boolean> })?.notifications?.[key] !== false);
      for (const u of recipients) {
        let n;
        const existing = input.groupKey
          ? await this.prisma.notification.findFirst({ where: { userId: u.id, groupKey: input.groupKey, readAt: null } })
          : null;
        if (existing) {
          n = await this.prisma.notification.update({
            where: { id: existing.id },
            data: { count: { increment: 1 }, body: input.body?.slice(0, 280) ?? null, title: input.title, actorId: input.actorId ?? null, createdAt: new Date() },
          });
        } else {
          n = await this.prisma.notification.create({
            data: {
              organizationId: input.organizationId,
              userId: u.id,
              actorId: input.actorId ?? null,
              type: input.type,
              title: input.title,
              body: input.body?.slice(0, 280) ?? null,
              link: input.link ?? null,
              groupKey: input.groupKey ?? null,
            },
          });
        }
        this.realtime.toUser(u.id, RT.NOTIFICATION_NEW, { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link });
      }
      return recipients.map((u) => u.id);
    } catch (err) {
      // Notifications must never break the action that triggered them.
      this.logger.warn(`notify failed: ${(err as Error).message}`);
      return [];
    }
  }
}
