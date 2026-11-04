import { Prisma } from '@prisma/client';
import { hasPermission, parseOrganizationSettings, PERMISSIONS, resolveGrants, SUPER_ADMIN_HARD_LIMIT, type Scope } from '@fg/shared';
import type { AuthContext } from '../common/auth-context';
import { personSelect, toPerson } from '../employees/employee.mapper';
import type { PrismaService } from '../prisma/prisma.service';

/** v2 grants that make an account an administrator for the "no two-step verification" warning. */
const ADMIN_GRANTS = ['employees.create', 'employees.edit', 'employees.deactivate', 'roles.manage', 'settings.configure', 'audit.view'];
const SHOW = 5;

const noMfa: Prisma.UserWhereInput = { OR: [{ mfaEnabledAt: null }, { mfaSecretEnc: null }] };

/**
 * "Access and security" on the admin Overview. Tenant-scoped; only for people who manage accounts
 * (employees.manage) or Super Admins. The Super Admin numbers are shown to Super Admins only.
 */
export async function accessSummary(prisma: PrismaService, auth: AuthContext) {
  if (!auth.isSuperAdmin && !hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE)) return null;
  const org = auth.organizationId;
  const now = new Date();
  const [statusCounts, locked, lockedCount, suspended, candidates, superAdmins] = await Promise.all([
    prisma.user.groupBy({ by: ['status'], where: { organizationId: org }, _count: true }),
    prisma.user.findMany({ where: { organizationId: org, status: 'ACTIVE', lockedUntil: { gt: now } }, select: { ...personSelect, lockedUntil: true }, orderBy: { lockedUntil: 'desc' }, take: SHOW }),
    prisma.user.count({ where: { organizationId: org, status: 'ACTIVE', lockedUntil: { gt: now } } }),
    prisma.user.findMany({ where: { organizationId: org, status: 'SUSPENDED' }, select: personSelect, orderBy: { firstName: 'asc' }, take: SHOW }),
    // Active internal accounts without two-step verification; filtered below to the ones with admin access.
    prisma.user.findMany({
      where: { organizationId: org, status: 'ACTIVE', accountType: 'INTERNAL', ...noMfa },
      select: {
        ...personSelect,
        isSuperAdmin: true,
        role: { select: { name: true, organizationId: true, archivedAt: true, grants: { select: { permission: true, scope: true } } } },
        extraRoles: { select: { role: { select: { organizationId: true, archivedAt: true, grants: { select: { permission: true, scope: true } } } } } },
        permissionOverrides: { select: { permission: true, effect: true, scope: true } },
      },
      orderBy: { firstName: 'asc' },
    }),
    auth.isSuperAdmin
      ? Promise.all([
          prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { settings: true } }),
          prisma.user.count({ where: { organizationId: org, isSuperAdmin: true, status: 'ACTIVE', accountType: 'INTERNAL' } }),
          prisma.superAdminInvitation.count({ where: { organizationId: org, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
        ])
      : null,
  ]);

  const status = Object.fromEntries(statusCounts.map((s) => [s.status, s._count])) as Record<string, number>;
  const adminsWithoutMfa = candidates.filter((u) => {
    if (u.isSuperAdmin) return true;
    const roles = [u.role, ...u.extraRoles.map((x) => x.role)].filter((r) => r.organizationId === org);
    const grants = resolveGrants(
      roles.map((r) => ({ archivedAt: r.archivedAt, grants: r.grants.map((g) => ({ permission: g.permission, scope: g.scope as Scope })) })),
      u.permissionOverrides.map((o) => ({ permission: o.permission, effect: o.effect, scope: o.scope as Scope | null })),
    );
    return ADMIN_GRANTS.some((p) => grants[p]);
  });

  let superAdminSummary: { active: number; pending: number; used: number; limit: number } | null = null;
  if (superAdmins) {
    const [o, active, pending] = superAdmins;
    const limit = Math.min(parseOrganizationSettings(o.settings).security.superAdminLimit, SUPER_ADMIN_HARD_LIMIT);
    superAdminSummary = { active, pending, used: active + pending, limit };
  }

  return {
    accounts: {
      active: status.ACTIVE ?? 0,
      suspended: status.SUSPENDED ?? 0,
      deactivated: status.DEACTIVATED ?? 0,
      archived: status.ARCHIVED ?? 0,
      waitingForPassword: status.INVITED ?? 0,
    },
    suspended: suspended.map((u) => toPerson(u)),
    locked: { count: lockedCount, people: locked.map(({ lockedUntil, ...u }) => ({ ...toPerson(u), lockedUntil })) },
    adminsWithoutMfa: {
      count: adminsWithoutMfa.length,
      people: adminsWithoutMfa.slice(0, SHOW).map(({ isSuperAdmin, role, extraRoles: _e, permissionOverrides: _o, ...u }) => ({ ...toPerson(u), roleName: role.name, isSuperAdmin })),
    },
    superAdmins: superAdminSummary,
  };
}
