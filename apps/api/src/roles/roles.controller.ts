import { Controller, Get } from '@nestjs/common';
import { PERMISSION_LABELS } from '@fg/shared';
import { Auth, AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Roles with their permissions; `assignable` tells the UI which ones the caller may grant. */
  @Get()
  async list(@Auth() auth: AuthContext) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { rank: 'desc' },
      include: { _count: { select: { users: { where: { status: { not: 'DEACTIVATED' } } } } } },
    });
    return {
      roles: roles.map(({ _count, ...r }) => ({
        ...r,
        memberCount: _count.users,
        assignable: auth.roleKey === 'super_admin' || r.rank < auth.rank,
      })),
      permissionLabels: PERMISSION_LABELS,
    };
  }
}
