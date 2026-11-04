import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { departmentSchema, DepartmentInput, PERMISSIONS } from '@fg/shared';
import { AuditService } from '../audit/audit.service';
import { Auth, AuthContext, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext) {
    const rows = await this.prisma.department.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { name: 'asc' },
      include: {
        head: { select: { id: true, firstName: true, lastName: true, avatarColor: true, avatarUrl: true } },
        _count: { select: { members: { where: { status: 'ACTIVE' } }, announcements: true } },
      },
    });
    return rows.map(({ _count, ...d }) => ({ ...d, memberCount: _count.members, announcementCount: _count.announcements }));
  }

  private async checkHead(auth: AuthContext, headId?: string | null) {
    // Only people who can still work here can head a department (not suspended, deactivated or archived).
    if (headId && !(await this.prisma.user.count({ where: { id: headId, organizationId: auth.organizationId, status: { in: ['ACTIVE', 'INVITED'] } } }))) {
      throw new BadRequestException('Unknown department head');
    }
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  async create(@Auth() auth: AuthContext, @Body(new ZodPipe(departmentSchema)) body: DepartmentInput) {
    await this.checkHead(auth, body.headId);
    if (await this.prisma.department.count({ where: { organizationId: auth.organizationId, name: body.name } })) {
      throw new ConflictException('A department with this name already exists');
    }
    const d = await this.prisma.department.create({ data: { ...body, organizationId: auth.organizationId } });
    await this.audit.log(auth, 'department.created', 'department', d.id, { name: d.name });
    return d;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  async update(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(departmentSchema.partial())) body: Partial<DepartmentInput>) {
    const existing = await this.prisma.department.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!existing) throw new NotFoundException('Department not found');
    if (body.headId !== existing.headId) await this.checkHead(auth, body.headId); // keeping the current head is always fine
    if (body.name && body.name !== existing.name && (await this.prisma.department.count({ where: { organizationId: auth.organizationId, name: body.name } }))) {
      throw new ConflictException('A department with this name already exists');
    }
    const d = await this.prisma.department.update({ where: { id }, data: body });
    await this.audit.log(auth, 'department.updated', 'department', id, { fields: Object.keys(body) });
    return d;
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  async remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    const existing = await this.prisma.department.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!existing) throw new NotFoundException('Department not found');
    // Deleting would silently delete announcements aimed at this department (cascade). Ask first.
    const announcements = await this.prisma.announcement.count({ where: { organizationId: auth.organizationId, departmentId: id } });
    if (announcements) {
      throw new ConflictException(`${announcements} announcement${announcements === 1 ? ' is' : 's are'} addressed to this department. Delete them or send them to everyone first.`);
    }
    await this.prisma.department.delete({ where: { id } }); // members' departmentId is set to null
    await this.audit.log(auth, 'department.deleted', 'department', id, { name: existing.name });
    return { ok: true };
  }
}
