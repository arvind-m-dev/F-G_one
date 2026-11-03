import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { holidaySchema, PERMISSIONS, type HolidayInput } from '@fg/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Auth, AuthContext, RequirePermissions } from '../common/auth-context';
import { toDbDate } from '../common/tz';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const yearQ = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const out = (h: { date: Date } & Record<string, unknown>) => ({ ...h, date: h.date.toISOString().slice(0, 10) });

@Controller('holidays')
export class HolidaysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query(new ZodPipe(yearQ)) q: z.infer<typeof yearQ>) {
    const year = q.year ?? new Date().getUTCFullYear();
    const rows = await this.prisma.holiday.findMany({
      where: { organizationId: auth.organizationId, date: { gte: toDbDate(`${year}-01-01`), lte: toDbDate(`${year}-12-31`) } },
      orderBy: { date: 'asc' },
    });
    return { year, items: rows.map(out) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.HOLIDAYS_MANAGE)
  async create(@Auth() auth: AuthContext, @Body(new ZodPipe(holidaySchema)) body: HolidayInput) {
    try {
      const h = await this.prisma.holiday.create({ data: { organizationId: auth.organizationId, name: body.name, date: toDbDate(body.date), type: body.type, description: body.description ?? null } });
      await this.audit.log(auth, 'holiday.created', 'holiday', h.id, { name: h.name, date: body.date });
      return out(h);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('That holiday already exists on this date');
      throw e;
    }
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.HOLIDAYS_MANAGE)
  async update(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(holidaySchema.partial())) body: Partial<HolidayInput>) {
    const h = await this.prisma.holiday.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!h) throw new NotFoundException('Holiday not found');
    const u = await this.prisma.holiday.update({ where: { id }, data: { ...body, date: body.date ? toDbDate(body.date) : undefined } });
    await this.audit.log(auth, 'holiday.updated', 'holiday', id, { fields: Object.keys(body) });
    return out(u);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.HOLIDAYS_MANAGE)
  async remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    const h = await this.prisma.holiday.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!h) throw new NotFoundException('Holiday not found');
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.log(auth, 'holiday.deleted', 'holiday', id, { name: h.name });
    return { ok: true };
  }
}
