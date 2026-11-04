import { Body, Controller, Patch, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { setStatusSchema, SetStatusInput, updateProfileSchema, UpdateProfileInput, userPreferencesSchema, UserPreferences } from '@fg/shared';
import { Auth, AuthContext } from '../common/auth-context';
import { toDateOnly } from '../common/dates';
import { addDays, localDate, localToUtc } from '../common/tz';
import { ZodPipe } from '../common/zod.pipe';
import { employeeSelect, toEmployee } from '../employees/employee.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** End of today in the person's own time zone (falls back to the server's day if the zone is unknown). */
function endOfToday(tz: string): Date {
  try {
    return new Date(localToUtc(addDays(localDate(tz), 1), '00:00', tz).getTime() - 1);
  } catch {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }
}

function expiryDate(expiry: SetStatusInput['expiry'], tz: string): Date | null {
  const now = Date.now();
  switch (expiry) {
    case '30m': return new Date(now + 30 * 60_000);
    case '1h': return new Date(now + 3600_000);
    case '4h': return new Date(now + 4 * 3600_000);
    case 'today':
      return endOfToday(tz);
    default: return null;
  }
}

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Patch('profile')
  async profile(@Auth() auth: AuthContext, @Body(new ZodPipe(updateProfileSchema)) body: UpdateProfileInput) {
    const { birthday, ...rest } = body;
    const u = await this.prisma.user.update({
      where: { id: auth.userId },
      data: { ...rest, birthday: toDateOnly(birthday) },
      select: employeeSelect,
    });
    return toEmployee(u, { privileged: true, online: true });
  }

  @Patch('preferences')
  async preferences(@Auth() auth: AuthContext, @Body(new ZodPipe(userPreferencesSchema)) body: UserPreferences) {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { preferences: true } });
    const previous = (current.preferences ?? {}) as UserPreferences;
    // Per-type notification switches merge one level deeper, so turning one off keeps the others.
    const merged = {
      ...previous,
      ...body,
      ...(body.notifications ? { notifications: { ...(previous.notifications ?? {}), ...body.notifications } } : {}),
    };
    await this.prisma.user.update({ where: { id: auth.userId }, data: { preferences: merged as Prisma.InputJsonValue } });
    return merged;
  }

  /** Presence/status only — attendance records are never touched here. */
  @Put('status')
  async status(@Auth() auth: AuthContext, @Body(new ZodPipe(setStatusSchema)) body: SetStatusInput) {
    const { timezone } = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { timezone: true } });
    const u = await this.prisma.user.update({
      where: { id: auth.userId },
      data: {
        presence: body.presence,
        statusEmoji: body.emoji ?? null,
        statusText: body.text || null,
        statusExpiresAt: expiryDate(body.expiry, timezone),
      },
      select: { presence: true, statusEmoji: true, statusText: true, statusExpiresAt: true },
    });
    this.realtime.emitPresence(auth.organizationId, {
      userId: auth.userId,
      online: this.realtime.isOnline(auth.userId),
      ...u,
      statusExpiresAt: u.statusExpiresAt?.toISOString() ?? null,
    });
    return u;
  }
}
