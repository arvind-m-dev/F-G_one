import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelMemberRole, Prisma } from '@prisma/client';
import { CreateChannelInput, hasPermission, PERMISSIONS, RT, SendMessageInput } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/auth-context';
import { personSelect, toPerson } from '../employees/employee.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const messageInclude = {
  author: { select: personSelect },
  reactions: { select: { emoji: true, userId: true } },
  _count: { select: { replies: { where: { deletedAt: null } } } },
} satisfies Prisma.MessageInclude;
type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────── serialization ─────────

  toMessage(m: MessageRow) {
    const grouped = new Map<string, string[]>();
    for (const r of m.reactions) grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId]);
    return {
      id: m.id,
      channelId: m.channelId,
      parentId: m.parentId,
      body: m.deletedAt ? '' : m.body,
      deleted: !!m.deletedAt,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
      replyCount: m._count.replies,
      author: m.author ? toPerson(m.author, this.realtime.isOnline(m.author.id)) : null,
      reactions: [...grouped.entries()].map(([emoji, userIds]) => ({ emoji, userIds, count: userIds.length })),
    };
  }

  // ───────── access control ─────────

  /** Loads a channel in the caller's org and their membership. Throws 404 rather than leaking existence. */
  private async access(auth: AuthContext, channelId: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, organizationId: auth.organizationId } });
    if (!channel) throw new NotFoundException('Conversation not found');
    const membership = await this.prisma.channelMember.findUnique({ where: { channelId_userId: { channelId, userId: auth.userId } } });
    if (!membership && channel.type !== 'PUBLIC') throw new NotFoundException('Conversation not found');
    return { channel, membership };
  }

  private async requireMember(auth: AuthContext, channelId: string) {
    const a = await this.access(auth, channelId);
    if (!a.membership) throw new ForbiddenException('Join this channel first');
    return { channel: a.channel, membership: a.membership };
  }

  private canAdminChannel(auth: AuthContext, membership: { role: ChannelMemberRole } | null) {
    return membership?.role === 'ADMIN' || hasPermission(auth.permissions, PERMISSIONS.CHANNELS_MANAGE);
  }

  private async assertColleagues(auth: AuthContext, userIds: string[]) {
    const unique = [...new Set(userIds)];
    const count = await this.prisma.user.count({ where: { id: { in: unique }, organizationId: auth.organizationId, status: 'ACTIVE' } });
    if (count !== unique.length) throw new BadRequestException('One or more people could not be found');
    return unique;
  }

  // ───────── channels ─────────

  async listMine(auth: AuthContext) {
    const memberships = await this.prisma.channelMember.findMany({
      where: { userId: auth.userId, channel: { organizationId: auth.organizationId, archivedAt: null } },
      include: {
        channel: {
          include: {
            members: { where: { userId: { not: auth.userId } }, take: 8, include: { user: { select: personSelect } } },
            _count: { select: { members: true } },
            messages: { where: { deletedAt: null, parentId: null }, orderBy: { createdAt: 'desc' }, take: 1, include: { author: { select: { id: true, firstName: true } } } },
          },
        },
      },
    });
    const unread = await this.prisma.$queryRaw<{ channelId: string; count: number }[]>`
      SELECT cm."channelId", COUNT(m.id)::int AS count
      FROM "ChannelMember" cm
      JOIN "Message" m ON m."channelId" = cm."channelId"
        AND m."createdAt" > cm."lastReadAt"
        AND m."deletedAt" IS NULL
        AND (m."authorId" IS NULL OR m."authorId" <> cm."userId")
      WHERE cm."userId" = ${auth.userId}
      GROUP BY cm."channelId"`;
    const unreadMap = new Map(unread.map((u) => [u.channelId, u.count]));

    return memberships
      .map(({ channel: c, role, muted }) => {
        const last = c.messages[0];
        return {
          id: c.id,
          type: c.type,
          name: c.name,
          description: c.description,
          topic: c.topic,
          isDefault: c.isDefault,
          myRole: role,
          muted,
          memberCount: c._count.members,
          participants: c.type === 'DIRECT' ? c.members.map((m) => toPerson(m.user, this.realtime.isOnline(m.userId))) : [],
          unread: unreadMap.get(c.id) ?? 0,
          lastMessageAt: c.lastMessageAt,
          lastMessage: last ? { body: last.body.slice(0, 140), authorName: last.author?.firstName ?? null, authorId: last.author?.id ?? null, createdAt: last.createdAt } : null,
        };
      })
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }

  async browse(auth: AuthContext) {
    const rows = await this.prisma.channel.findMany({
      where: { organizationId: auth.organizationId, type: 'PUBLIC', archivedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } }, members: { where: { userId: auth.userId }, select: { userId: true } } },
    });
    return rows.map(({ _count, members, ...c }) => ({ ...c, memberCount: _count.members, isMember: members.length > 0 }));
  }

  async create(auth: AuthContext, input: CreateChannelInput) {
    if (await this.prisma.channel.count({ where: { organizationId: auth.organizationId, name: input.name } })) {
      throw new ConflictException('A channel with that name already exists');
    }
    const memberIds = await this.assertColleagues(auth, input.memberIds.filter((id) => id !== auth.userId));
    const channel = await this.prisma.channel.create({
      data: {
        organizationId: auth.organizationId,
        type: input.visibility,
        name: input.name,
        description: input.description ?? null,
        createdById: auth.userId,
        members: {
          create: [{ userId: auth.userId, role: 'ADMIN' }, ...memberIds.map((userId) => ({ userId }))],
        },
      },
    });
    this.realtime.joinChannel([auth.userId, ...memberIds], channel.id);
    for (const id of memberIds) this.realtime.toUser(id, RT.CHANNEL_UPDATED, { channelId: channel.id });
    await this.audit.log(auth, 'channel.created', 'channel', channel.id, { name: channel.name, type: channel.type });
    return channel;
  }

  async openDirect(auth: AuthContext, userIds: string[]) {
    const others = await this.assertColleagues(auth, userIds.filter((id) => id !== auth.userId));
    const participants = [...new Set([auth.userId, ...others])].sort();
    const directKey = participants.join(':');
    const existing = await this.prisma.channel.findUnique({ where: { organizationId_directKey: { organizationId: auth.organizationId, directKey } } });
    if (existing) return existing;
    const channel = await this.prisma.channel.create({
      data: {
        organizationId: auth.organizationId,
        type: 'DIRECT',
        directKey,
        createdById: auth.userId,
        members: { create: participants.map((userId) => ({ userId })) },
      },
    });
    this.realtime.joinChannel(participants, channel.id);
    return channel;
  }

  async details(auth: AuthContext, channelId: string) {
    const { channel, membership } = await this.access(auth, channelId);
    const members = await this.prisma.channelMember.findMany({
      where: { channelId },
      include: { user: { select: personSelect } },
      orderBy: { joinedAt: 'asc' },
    });
    return {
      ...channel,
      directKey: undefined,
      isMember: !!membership,
      myRole: membership?.role ?? null,
      canManage: this.canAdminChannel(auth, membership),
      members: members.map((m) => ({ ...toPerson(m.user, this.realtime.isOnline(m.userId)), role: m.role })),
    };
  }

  async update(auth: AuthContext, channelId: string, input: { name?: string; description?: string | null; topic?: string | null }) {
    const { channel, membership } = await this.access(auth, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('Direct messages cannot be renamed');
    if (!this.canAdminChannel(auth, membership)) throw new ForbiddenException('Only channel admins can edit this channel');
    // Default channels (e.g. #general) keep their name; the UI locks the field too.
    if (channel.isDefault && input.name && input.name !== channel.name) throw new BadRequestException('Default channels cannot be renamed');
    if (input.name && input.name !== channel.name && (await this.prisma.channel.count({ where: { organizationId: auth.organizationId, name: input.name } }))) {
      throw new ConflictException('A channel with that name already exists');
    }
    const updated = await this.prisma.channel.update({ where: { id: channelId }, data: input });
    this.realtime.toChannel(channelId, RT.CHANNEL_UPDATED, { channelId });
    await this.audit.log(auth, 'channel.updated', 'channel', channelId, { fields: Object.keys(input) });
    return updated;
  }

  async join(auth: AuthContext, channelId: string) {
    const { channel, membership } = await this.access(auth, channelId);
    if (membership) return { ok: true };
    if (channel.type !== 'PUBLIC') throw new ForbiddenException('This channel is private');
    await this.prisma.channelMember.create({ data: { channelId, userId: auth.userId } });
    this.realtime.joinChannel([auth.userId], channelId);
    this.realtime.toChannel(channelId, RT.CHANNEL_UPDATED, { channelId });
    return { ok: true };
  }

  async leave(auth: AuthContext, channelId: string) {
    const { channel } = await this.requireMember(auth, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('You cannot leave a direct message');
    if (channel.isDefault) throw new BadRequestException('Everyone stays in company-wide channels');
    await this.removeMember(auth, channelId, auth.userId);
    return { ok: true };
  }

  async addMembers(auth: AuthContext, channelId: string, userIds: string[]) {
    const { channel, membership } = await this.requireMember(auth, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('Start a new group conversation instead');
    if (channel.type === 'PRIVATE' && !this.canAdminChannel(auth, membership)) throw new ForbiddenException('Only group admins can add members');
    const ids = await this.assertColleagues(auth, userIds);
    await this.prisma.channelMember.createMany({ data: ids.map((userId) => ({ channelId, userId })), skipDuplicates: true });
    this.realtime.joinChannel(ids, channelId);
    for (const id of ids) this.realtime.toUser(id, RT.CHANNEL_UPDATED, { channelId });
    this.realtime.toChannel(channelId, RT.CHANNEL_UPDATED, { channelId });
    await this.audit.log(auth, 'channel.members_added', 'channel', channelId, { userIds: ids });
    return this.details(auth, channelId);
  }

  async removeMember(auth: AuthContext, channelId: string, userId: string) {
    const { channel, membership } = await this.requireMember(auth, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('Members cannot be removed from direct messages');
    if (userId !== auth.userId && !this.canAdminChannel(auth, membership)) throw new ForbiddenException('Only group admins can remove members');
    const target = await this.prisma.channelMember.findUnique({ where: { channelId_userId: { channelId, userId } } });
    if (!target) throw new NotFoundException('Not a member');
    let archive = false;
    if (target.role === 'ADMIN') {
      const admins = await this.prisma.channelMember.count({ where: { channelId, role: 'ADMIN' } });
      if (admins <= 1) {
        // The last person in a channel may leave it; the empty channel is archived.
        const members = await this.prisma.channelMember.count({ where: { channelId } });
        if (members > 1 || userId !== auth.userId) throw new BadRequestException('Assign another admin before removing the last one');
        archive = true;
      }
    }
    await this.prisma.channelMember.delete({ where: { channelId_userId: { channelId, userId } } });
    if (archive) await this.prisma.channel.update({ where: { id: channelId }, data: { archivedAt: new Date() } });
    this.realtime.leaveChannel([userId], channelId);
    this.realtime.toUser(userId, RT.CHANNEL_REMOVED, { channelId });
    this.realtime.toChannel(channelId, RT.CHANNEL_UPDATED, { channelId });
    if (userId !== auth.userId) await this.audit.log(auth, 'channel.member_removed', 'channel', channelId, { userId });
    return { ok: true };
  }

  async setMemberRole(auth: AuthContext, channelId: string, userId: string, role: ChannelMemberRole) {
    const { channel, membership } = await this.requireMember(auth, channelId);
    if (channel.type === 'DIRECT') throw new BadRequestException('Not applicable to direct messages');
    if (!this.canAdminChannel(auth, membership)) throw new ForbiddenException('Only group admins can change roles');
    const target = await this.prisma.channelMember.findUnique({ where: { channelId_userId: { channelId, userId } } });
    if (!target) throw new NotFoundException('Not a member');
    if (target.role === role) return { ok: true };
    if (role === 'MEMBER') {
      const admins = await this.prisma.channelMember.count({ where: { channelId, role: 'ADMIN' } });
      if (admins <= 1) throw new BadRequestException('A group needs at least one admin');
    }
    await this.prisma.channelMember.update({ where: { channelId_userId: { channelId, userId } }, data: { role } });
    this.realtime.toChannel(channelId, RT.CHANNEL_UPDATED, { channelId });
    return { ok: true };
  }

  // ───────── messages ─────────

  async messages(auth: AuthContext, channelId: string, q: { before?: string; limit: number; parentId?: string }) {
    await this.access(auth, channelId); // public channels are readable before joining
    const rows = await this.prisma.message.findMany({
      where: {
        channelId,
        parentId: q.parentId ?? null,
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      include: messageInclude,
    });
    const hasMore = rows.length > q.limit;
    return { items: rows.slice(0, q.limit).reverse().map((m) => this.toMessage(m)), hasMore };
  }

  /** DM → participants, @name → mentioned members, thread reply → original author. Respects preferences. */
  private async notifyForMessage(auth: AuthContext, channel: { id: string; type: string; name: string | null }, msg: { id: string; body: string; parentId: string | null }, authorName: string) {
    const members = await this.prisma.channelMember.findMany({
      where: { channelId: channel.id },
      select: { userId: true, user: { select: { firstName: true, lastName: true, displayName: true } } },
    });
    const preview = msg.body.slice(0, 160);
    const where = channel.type === 'DIRECT' ? 'a direct message' : `#${channel.name}`;
    const link = `/app/chat/${channel.id}${msg.parentId ? `?thread=${msg.parentId}` : ''}`;
    const notified = new Set<string>([auth.userId]);

    if (channel.type === 'DIRECT' && !msg.parentId) {
      const ids = members.map((m) => m.userId).filter((id) => !notified.has(id));
      // Only people who actually received a notification are skipped below, so someone who
      // turned one type off still hears about the same message through another (e.g. a thread reply).
      const sent = await this.notifications.notify({ organizationId: auth.organizationId, userIds: ids, actorId: auth.userId, type: 'dm', title: `${authorName} sent you a message`, body: preview, link, groupKey: `dm:${channel.id}` });
      sent.forEach((id) => notified.add(id));
    }

    const tokens = new Set((msg.body.match(/@([A-Za-z][\w.-]*)/g) ?? []).map((t) => t.slice(1).toLowerCase().replace(/[.-]+$/, '')));
    if (tokens.size) {
      const mentioned = members
        .filter((m) => {
          const u = m.user;
          const names = [u.firstName, `${u.firstName}.${u.lastName}`, u.displayName?.replace(/\s+/g, '')].filter(Boolean).map((n) => n!.toLowerCase());
          return names.some((n) => tokens.has(n));
        })
        .map((m) => m.userId)
        .filter((id) => !notified.has(id));
      const sent = await this.notifications.notify({ organizationId: auth.organizationId, userIds: mentioned, actorId: auth.userId, type: 'mention', title: `${authorName} mentioned you in ${where}`, body: preview, link });
      sent.forEach((id) => notified.add(id));
    }

    if (msg.parentId) {
      const parent = await this.prisma.message.findUnique({ where: { id: msg.parentId }, select: { authorId: true } });
      // Only people still in the conversation hear about replies (a removed member must not see private content).
      if (parent?.authorId && !notified.has(parent.authorId) && members.some((m) => m.userId === parent.authorId)) {
        await this.notifications.notify({ organizationId: auth.organizationId, userIds: [parent.authorId], actorId: auth.userId, type: 'thread', title: `${authorName} replied to your message in ${where}`, body: preview, link, groupKey: `thread:${msg.parentId}` });
      }
    }
  }

  async send(auth: AuthContext, channelId: string, input: SendMessageInput) {
    const { channel } = await this.requireMember(auth, channelId);
    if (input.parentId) {
      const parent = await this.prisma.message.findFirst({ where: { id: input.parentId, channelId } });
      if (!parent) throw new BadRequestException('Original message not found');
      // Threads are one level deep: a reply to a reply would never be shown anywhere.
      if (parent.parentId) throw new BadRequestException('Reply in the original thread instead');
    }
    const now = new Date();
    const [msg] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { organizationId: auth.organizationId, channelId, authorId: auth.userId, body: input.body, parentId: input.parentId ?? null, createdAt: now },
        include: messageInclude,
      }),
      this.prisma.channel.update({ where: { id: channelId }, data: { lastMessageAt: now } }),
      this.prisma.channelMember.update({ where: { channelId_userId: { channelId, userId: auth.userId } }, data: { lastReadAt: now } }),
    ]);
    const dto = { ...this.toMessage(msg), clientId: input.clientId };
    this.realtime.toChannel(channelId, RT.MESSAGE_NEW, dto);
    void this.notifyForMessage(auth, channel, msg, dto.author?.name ?? 'Someone').catch(() => undefined); // never fail the send
    if (input.parentId) {
      const parent = await this.prisma.message.findUniqueOrThrow({ where: { id: input.parentId }, include: messageInclude });
      this.realtime.toChannel(channelId, RT.MESSAGE_UPDATED, this.toMessage(parent));
    }
    return dto;
  }

  private async loadMessage(auth: AuthContext, messageId: string) {
    const msg = await this.prisma.message.findFirst({ where: { id: messageId, organizationId: auth.organizationId } });
    if (!msg) throw new NotFoundException('Message not found');
    const { membership } = await this.requireMember(auth, msg.channelId);
    return { msg, membership };
  }

  /** Single message (e.g. to reopen a thread from a link). Membership required. */
  async getMessage(auth: AuthContext, messageId: string) {
    const msg = await this.prisma.message.findFirst({ where: { id: messageId, organizationId: auth.organizationId }, include: messageInclude });
    if (!msg) throw new NotFoundException('Message not found');
    await this.access(auth, msg.channelId);
    return this.toMessage(msg);
  }

  async edit(auth: AuthContext, messageId: string, body: string) {
    const { msg } = await this.loadMessage(auth, messageId);
    if (msg.authorId !== auth.userId) throw new ForbiddenException('You can only edit your own messages');
    if (msg.deletedAt) throw new BadRequestException('Message was deleted');
    const updated = await this.prisma.message.update({ where: { id: messageId }, data: { body, editedAt: new Date() }, include: messageInclude });
    const dto = this.toMessage(updated);
    this.realtime.toChannel(msg.channelId, RT.MESSAGE_UPDATED, dto);
    return dto;
  }

  async remove(auth: AuthContext, messageId: string) {
    const { msg, membership } = await this.loadMessage(auth, messageId);
    const isAuthor = msg.authorId === auth.userId;
    if (!isAuthor && !this.canAdminChannel(auth, membership)) throw new ForbiddenException('You cannot delete this message');
    const updated = await this.prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date() }, include: messageInclude });
    if (!isAuthor) await this.audit.log(auth, 'message.deleted_by_moderator', 'message', messageId, { channelId: msg.channelId, authorId: msg.authorId });
    const dto = this.toMessage(updated);
    this.realtime.toChannel(msg.channelId, RT.MESSAGE_UPDATED, dto);
    return dto;
  }

  async toggleReaction(auth: AuthContext, messageId: string, emoji: string) {
    const { msg } = await this.loadMessage(auth, messageId);
    if (msg.deletedAt) throw new BadRequestException('Message was deleted');
    const key = { messageId_userId_emoji: { messageId, userId: auth.userId, emoji } };
    const existing = await this.prisma.messageReaction.findUnique({ where: key });
    if (existing) await this.prisma.messageReaction.delete({ where: key });
    else await this.prisma.messageReaction.create({ data: { messageId, userId: auth.userId, emoji } });
    const updated = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
    const dto = this.toMessage(updated);
    this.realtime.toChannel(msg.channelId, RT.MESSAGE_UPDATED, dto);
    return dto;
  }

  async markRead(auth: AuthContext, channelId: string) {
    await this.requireMember(auth, channelId);
    await this.prisma.channelMember.update({ where: { channelId_userId: { channelId, userId: auth.userId } }, data: { lastReadAt: new Date() } });
    return { ok: true };
  }
}
