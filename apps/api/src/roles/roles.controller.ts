import { Controller, Get } from '@nestjs/common';
import { legacyFromGrants, mergeGrants, PERMISSION_CATALOG, PERMISSION_LABELS, PERMISSION_MODULES, SCOPE_LABELS, type Scope } from '@fg/shared';
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
      include: { grants: { select: { permission: true, scope: true } }, _count: { select: { users: { where: { status: { not: 'DEACTIVATED' } } } } } },
    });
    return {
      roles: roles.map(({ _count, permissions: _legacyColumn, grants, ...r }) => ({
        ...r,
        grants,
        /** Legacy flat permissions derived from the grants (the column is deprecated). */
        permissions: legacyFromGrants(mergeGrants(grants.map((g) => ({ permission: g.permission, scope: g.scope as Scope })))),
        memberCount: _count.users,
        assignable: auth.roleKey === 'super_admin' || r.rank < auth.rank,
      })),
      permissionLabels: PERMISSION_LABELS,
      catalog: PERMISSION_CATALOG,
      modules: PERMISSION_MODULES,
      scopeLabels: SCOPE_LABELS,
    };
  }
}
