import { likeContains } from '../common/like';
import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const querySchema = z.object({
  q: z.string().max(80).optional(),
  entityType: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  async list(@Auth() auth: AuthContext, @Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>) {
    const where = {
      organizationId: auth.organizationId,
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.q ? { action: likeContains(q.q) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
