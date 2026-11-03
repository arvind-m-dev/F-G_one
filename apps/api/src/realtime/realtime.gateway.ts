import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RT, type PresenceEvent, type TypingEvent } from '@fg/shared';
import { AuthService } from '../auth/auth.service';
import { env } from '../common/env';
import { PrismaService } from '../prisma/prisma.service';

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

interface SocketData {
  userId: string;
  organizationId: string;
  name: string;
  sessionId: string;
}

/**
 * Single Socket.IO gateway. Rooms:
 *   org:<id>      every connected member of an organization (presence fan-out)
 *   user:<id>     all tabs/devices of one user
 *   channel:<id>  members of a chat channel
 * Authorization happens at handshake (session cookie) and room membership is only
 * granted from the server side, so clients can never subscribe to foreign rooms.
 * For horizontal scaling add @socket.io/redis-adapter (see docs/DEPLOYMENT.md).
 */
@WebSocketGateway({
  path: '/socket.io',
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('Realtime');
  /** userId -> open socket count (single-instance online tracking) */
  private readonly online = new Map<string, number>();

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  isOnline(userId: string) {
    return (this.online.get(userId) ?? 0) > 0;
  }

  onlineIds() {
    return [...this.online.keys()];
  }

  async handleConnection(socket: Socket) {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const token = cookies[env().SESSION_COOKIE_NAME];
      const ctx = token ? await this.auth.validateSession(token) : null;
      // Client accounts never join internal rooms (org-wide presence, channels, announcements).
      // Sessions still owing the second sign-in step get no live connection either.
      if (!ctx || ctx.accountType !== 'INTERNAL' || ctx.mfaPending) {
        socket.emit('error', 'unauthorized');
        socket.disconnect(true);
        return;
      }
      const user = await this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true } });
      (socket.data as SocketData) = { userId: ctx.userId, organizationId: ctx.organizationId, name: `${user?.firstName} ${user?.lastName}`, sessionId: ctx.sessionId };
      const memberships = await this.prisma.channelMember.findMany({ where: { userId: ctx.userId }, select: { channelId: true } });
      await socket.join([`org:${ctx.organizationId}`, `user:${ctx.userId}`, `session:${ctx.sessionId}`, ...memberships.map((m) => `channel:${m.channelId}`)]);

      const count = (this.online.get(ctx.userId) ?? 0) + 1;
      this.online.set(ctx.userId, count);
      if (count === 1) this.emitPresence(ctx.organizationId, { userId: ctx.userId, online: true });
      socket.emit(RT.ONLINE_SNAPSHOT, { userIds: this.onlineIds() });
    } catch (err) {
      this.logger.warn(`Socket auth failed: ${(err as Error).message}`);
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    const data = socket.data as SocketData | undefined;
    if (!data?.userId) return;
    const count = (this.online.get(data.userId) ?? 1) - 1;
    if (count <= 0) {
      this.online.delete(data.userId);
      this.emitPresence(data.organizationId, { userId: data.userId, online: false });
      await this.prisma.user.update({ where: { id: data.userId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    } else {
      this.online.set(data.userId, count);
    }
  }

  @SubscribeMessage(RT.TYPING)
  onTyping(@ConnectedSocket() socket: Socket, @MessageBody() body: { channelId?: string; typing?: boolean }) {
    const data = socket.data as SocketData;
    if (!body?.channelId || !socket.rooms.has(`channel:${body.channelId}`)) return; // only members
    const evt: TypingEvent = { channelId: body.channelId, userId: data.userId, name: data.name, typing: !!body.typing };
    socket.to(`channel:${body.channelId}`).emit(RT.TYPING, evt);
  }

  // ── server-side helpers used by services ──
  emitPresence(organizationId: string, evt: PresenceEvent) {
    this.server?.to(`org:${organizationId}`).emit(RT.PRESENCE_UPDATED, evt);
  }
  toChannel(channelId: string, event: string, payload: unknown) {
    this.server?.to(`channel:${channelId}`).emit(event, payload);
  }
  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
  joinChannel(userIds: string[], channelId: string) {
    for (const id of userIds) this.server?.in(`user:${id}`).socketsJoin(`channel:${channelId}`);
  }
  leaveChannel(userIds: string[], channelId: string) {
    for (const id of userIds) this.server?.in(`user:${id}`).socketsLeave(`channel:${channelId}`);
  }
  /** Kick every socket of a user (deactivation, sign out everywhere). `exceptSessionId` keeps the caller's own device connected. */
  disconnectUser(userId: string, exceptSessionId?: string) {
    if (!this.server) return;
    if (!exceptSessionId) return void this.server.in(`user:${userId}`).disconnectSockets(true);
    this.server.in(`user:${userId}`).except(`session:${exceptSessionId}`).disconnectSockets(true);
  }
  /** Kick the sockets opened with one session (sign out, session revoked). */
  disconnectSession(sessionId: string) {
    this.server?.in(`session:${sessionId}`).disconnectSockets(true);
  }
}
