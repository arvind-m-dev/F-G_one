import {
  accessGains,
  allowBlockReason,
  gainsBlockReason,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  resolveGrants,
  roleBlockReason,
  type AccessActor,
  type CatalogEntry,
  type Grant,
  type GrantMap,
  type Scope,
} from '@fg/shared';
import { isLiveCatalogPermission } from '@/lib/live-modules';
import type { AccessValue, Me, Role } from '@/lib/types';

/**
 * Pure helpers behind the Access section and the creation wizard. The escalation rules come from
 * @fg/shared, so what is greyed out here is exactly what the API refuses.
 */

export const actorFromMe = (me: Pick<Me, 'isSuperAdmin' | 'role' | 'grants'>): AccessActor => ({ isSuperAdmin: me.isSuperAdmin, rank: me.role.rank, grants: me.grants });

/** The roles a value assigns (main first), skipping ids that are not in the list. */
export function assignedRoles(roles: Role[], v: AccessValue): Role[] {
  const ids = [v.roleId, ...v.extraRoleIds.filter((id) => id !== v.roleId)];
  return ids.map((id) => roles.find((r) => r.id === id)).filter((r): r is Role => !!r);
}

/** Effective access for a value, with the same resolution as the API (roles, then ALLOW, then DENY). */
export function effectiveAccess(roles: Role[], v: AccessValue): GrantMap {
  return resolveGrants(
    assignedRoles(roles, v).map((r) => ({ archivedAt: r.archivedAt ? new Date(r.archivedAt) : null, grants: r.grants as Grant[] })),
    v.overrides.map((o) => ({ permission: o.permission, effect: o.effect, scope: (o.scope as Scope | null) ?? null })),
  );
}

export interface PreviewItem {
  entry: CatalogEntry;
  scope: Scope;
  /** Plain-language reasons they have it: role names, or "an exception". */
  sources: string[];
}

/**
 * What they will be able to do, grouped by module, plus what is blocked for them.
 * Permissions for features that do not exist yet are left out (`grants` still holds everything).
 */
export function accessPreview(roles: Role[], v: AccessValue) {
  const grants = effectiveAccess(roles, v);
  const assigned = assignedRoles(roles, v).filter((r) => !r.archivedAt);
  const items: PreviewItem[] = PERMISSION_CATALOG.filter((e) => grants[e.key] && isLiveCatalogPermission(e.key)).map((entry) => {
    const sources = assigned.filter((r) => r.grants.some((g) => g.permission === entry.key)).map((r) => `${r.name} role`);
    if (v.overrides.some((o) => o.permission === entry.key && o.effect === 'ALLOW')) sources.push('an exception for this person');
    return { entry, scope: grants[entry.key]!, sources };
  });
  const modules = Object.entries(PERMISSION_MODULES)
    .map(([key, label]) => ({ key, label, items: items.filter((i) => i.entry.module === key) }))
    .filter((m) => m.items.length);
  const blocked = v.overrides.filter((o) => o.effect === 'DENY').map((o) => PERMISSION_CATALOG.find((e) => e.key === o.permission)).filter((e): e is CatalogEntry => !!e);
  return { grants, modules, blocked, count: items.length };
}

const hasRole = (v: AccessValue | null | undefined, id: string) => !!v && (v.roleId === id || v.extraRoleIds.includes(id));

/** Why the actor can't give this role (null when they can, or when the person already has it). */
export function roleBlock(actor: AccessActor, role: Role, baseline?: AccessValue | null): string | null {
  if (hasRole(baseline, role.id)) return null;
  return roleBlockReason(actor, role);
}

/** Why the actor can't allow this permission at this scope (null when they can, or when it is unchanged). */
export function allowBlock(actor: AccessActor, permission: string, scope: Scope, baseline?: AccessValue | null): string | null {
  const prev = baseline?.overrides.find((o) => o.permission === permission);
  if (prev && prev.effect === 'ALLOW' && prev.scope === scope) return null;
  return allowBlockReason(actor, permission, scope);
}

/** The first reason the API would refuse this value, or null. Mirrors EmployeesService.planAccess. */
export function accessProblem(actor: AccessActor, roles: Role[], baseline: AccessValue | null, v: AccessValue): string | null {
  for (const role of assignedRoles(roles, v)) {
    const why = roleBlock(actor, role, baseline);
    if (why) return `You can't give the ${role.name} role. ${why}.`;
  }
  for (const o of v.overrides) {
    if (o.effect !== 'ALLOW') continue;
    const why = allowBlock(actor, o.permission, (o.scope ?? 'ORG') as Scope, baseline);
    if (why) return `${why}.`;
  }
  if (actor.isSuperAdmin) return null;
  const why = gainsBlockReason(actor, accessGains(baseline ? effectiveAccess(roles, baseline) : {}, effectiveAccess(roles, v)));
  return why ? `This would give them more access than you have. ${why}.` : null;
}

/** True when two values assign the same access (order of extra roles and exceptions ignored). */
export function sameAccess(a: AccessValue, b: AccessValue) {
  const key = (v: AccessValue) =>
    JSON.stringify([v.roleId, [...v.extraRoleIds].sort(), v.overrides.map((o) => `${o.permission}:${o.effect}:${o.effect === 'DENY' ? '' : (o.scope ?? '')}`).sort()]);
  return key(a) === key(b);
}
