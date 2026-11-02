import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../common/auth-context';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    actor: Pick<AuthContext, 'organizationId' | 'userId' | 'ip'> | { organizationId: string; userId?: string | null; ip?: string },
    action: string,
    entityType: string,
    entityId?: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.userId ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        metadata: metadata as Prisma.InputJsonValue,
        ip: actor.ip ?? null,
      },
    });
  }
}
