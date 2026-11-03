import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { grantScope, legacyFromGrants, LEGACY_PERMISSION_MAP, resolveGrants, type Permission, type Scope } from '@fg/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from './auth-context';

/**
 * Central authorization helpers (Phase 2a). Effective grants are resolved once per request
 * in AuthService.validateSession and carried on `auth.grants`.
 *
 * Scope semantics implemented today:
 *   ORG  → anyone in the caller's organization
 *   TEAM → the caller's direct reports (User.managerId)
 *   OWN  → only the caller
 * Other scopes are added with the modules that need them (projects, clients).
 */
export function scopeOf(auth: AuthContext, permission: string): Scope | null {
  return grantScope(auth.grants, permission);
}

/** Prisma filter for the people whose records the caller may act on under `permission`. Throws when not granted. */
export function userScopeWhere(auth: AuthContext, permission: string, message = 'You do not have permission to do that'): Prisma.UserWhereInput {
  const scope = scopeOf(auth, permission);
  switch (scope) {
    case 'ORG':
      return { organizationId: auth.organizationId };
    case 'TEAM':
      return { organizationId: auth.organizationId, managerId: auth.userId };
    case 'OWN':
      return { organizationId: auth.organizationId, id: auth.userId };
    default:
      // Default deny: no grant, or a scope this resource does not support yet.
      throw new ForbiddenException(message);
  }
}

/**
 * Active users in an organization who hold a legacy permission after full resolution
 * (primary + extra roles, overrides). Used to find notification recipients such as HR.
 */
export async function usersWithLegacyPermission(prisma: PrismaService, organizationId: string, permission: Permission, excludeId?: string): Promise<string[]> {
  const needed = LEGACY_PERMISSION_MAP[permission].map((g) => g.permission);
  const roleHas = { grants: { some: { permission: { in: needed } } } };
  const candidates = await prisma.user.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ role: roleHas }, { extraRoles: { some: { role: roleHas } } }, { permissionOverrides: { some: { permission: { in: needed }, effect: 'ALLOW' } } }],
    },
    select: {
      id: true,
      organizationId: true,
      role: { select: { archivedAt: true, grants: true } },
      extraRoles: { select: { role: { select: { organizationId: true, archivedAt: true, grants: true } } } },
      permissionOverrides: true,
    },
  });
  return candidates
    .filter((u) => {
      const roles = [u.role, ...u.extraRoles.map((x) => x.role).filter((r) => r.organizationId === u.organizationId)];
      return legacyFromGrants(resolveGrants(roles, u.permissionOverrides)).includes(permission);
    })
    .map((u) => u.id);
}
