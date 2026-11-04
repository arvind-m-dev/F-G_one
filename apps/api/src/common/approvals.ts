import { ForbiddenException } from '@nestjs/common';
import { hasPermission, PERMISSIONS } from '@fg/shared';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from './auth-context';
import { usersWithLegacyPermission } from './authz';

/**
 * Who may decide on someone's leave or attendance correction:
 *  - HR / admins (employees.manage) for anyone in the organization
 *  - a manager with `perm` for their direct reports
 * Never yourself.
 */
export async function assertCanDecide(prisma: Prisma.TransactionClient, auth: AuthContext, requesterId: string, perm: 'leave' | 'attendance') {
  if (requesterId === auth.userId) throw new ForbiddenException('You cannot approve your own request');
  if (hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE)) return;
  const needed = perm === 'leave' ? PERMISSIONS.LEAVE_APPROVE : PERMISSIONS.ATTENDANCE_VIEW_TEAM;
  if (hasPermission(auth.permissions, needed)) {
    const ok = await prisma.user.count({ where: { id: requesterId, organizationId: auth.organizationId, managerId: auth.userId } });
    if (ok) return;
  }
  throw new ForbiddenException('Only their manager or HR can decide on this request');
}

/** Filter for requests the caller may decide on. */
export function deciderScope(auth: AuthContext, perm: 'leave' | 'attendance') {
  if (hasPermission(auth.permissions, PERMISSIONS.EMPLOYEES_MANAGE)) return { organizationId: auth.organizationId, NOT: { userId: auth.userId } };
  const needed = perm === 'leave' ? PERMISSIONS.LEAVE_APPROVE : PERMISSIONS.ATTENDANCE_VIEW_TEAM;
  if (hasPermission(auth.permissions, needed)) return { organizationId: auth.organizationId, user: { managerId: auth.userId } };
  return null;
}

/** Active HR/admin users (employees.manage), excluding someone. */
export function hrUsers(prisma: Prisma.TransactionClient, organizationId: string, excludeId: string) {
  return usersWithLegacyPermission(prisma, organizationId, PERMISSIONS.EMPLOYEES_MANAGE, excludeId);
}

/** People who should be told about a new request: the requester's manager, or HR if there is none. */
export async function approversFor(prisma: Prisma.TransactionClient, organizationId: string, requesterId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: requesterId }, select: { manager: { select: { id: true, status: true, organizationId: true } } } });
  // A deactivated manager can't decide: route to HR instead so the request doesn't wait forever.
  const m = u.manager;
  return m && m.status === 'ACTIVE' && m.organizationId === organizationId ? [m.id] : hrUsers(prisma, organizationId, requesterId);
}
