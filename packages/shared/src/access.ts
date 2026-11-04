/**
 * Escalation rules for changing one person's access (Super Admin PRD §2.5, Phase 3).
 * Shared so the API enforces exactly what the admin UI shows as "you can't give this".
 *
 * - Super Admins may give anything (they still cannot change their own access).
 * - Everyone else:
 *   - may give a role only when it ranks below their own and every grant in it is within their own access (the ceiling);
 *   - may ALLOW a permission only when they hold it themselves at the same or a wider scope,
 *     and never a sensitive one (roles, settings, audit, AI configuration) — those are Super Admin only;
 *   - may not widen anyone's effective access beyond their own (covers removing a "blocked" exception).
 * DENY exceptions only take access away and are always allowed.
 */
import { CATALOG_BY_KEY, scopeCovers, SCOPE_LABELS, type Grant, type GrantMap, type Scope } from './authz';

export interface AccessActor {
  isSuperAdmin: boolean;
  rank: number;
  /** The actor's own effective grants. */
  grants: Record<string, string>;
}

export interface AssignableRole {
  rank: number;
  archivedAt?: Date | string | null;
  grants: { permission: string; scope: string }[];
}

const label = (permission: string) => CATALOG_BY_KEY[permission]?.label ?? permission;

/** Why the actor's own access does not cover `permission` at `scope`, or null when it does. */
function ceilingReason(actor: AccessActor, permission: string, scope: Scope): string | null {
  if (actor.isSuperAdmin) return null;
  const held = actor.grants[permission] as Scope | undefined;
  if (!held) return `You don't have “${label(permission)}” yourself`;
  if (!scopeCovers(held, scope)) return `You only have “${label(permission)}” for ${SCOPE_LABELS[held].toLowerCase()}`;
  return null;
}

/** Why the actor may not give this role to someone, or null when they may. */
export function roleBlockReason(actor: AccessActor, role: AssignableRole): string | null {
  if (role.archivedAt) return 'This role is archived';
  if (actor.isSuperAdmin) return null;
  if (role.rank >= actor.rank) return 'Only someone with a higher role than yours can give this role';
  for (const g of role.grants) {
    if (!CATALOG_BY_KEY[g.permission]) continue;
    const r = ceilingReason(actor, g.permission, g.scope as Scope);
    if (r) return `It includes more than you can give: ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
  }
  return null;
}

/** Why the actor may not add an "allowed" exception for `permission` at `scope`, or null when they may. */
export function allowBlockReason(actor: AccessActor, permission: string, scope: Scope): string | null {
  const entry = CATALOG_BY_KEY[permission];
  if (!entry) return 'Unknown permission';
  if (!entry.scopes.includes(scope)) return `“${entry.label}” can't be given for ${SCOPE_LABELS[scope].toLowerCase()}`;
  if (actor.isSuperAdmin) return null;
  if (entry.sensitive) return 'Only a Super Admin can give this';
  return ceilingReason(actor, permission, scope);
}

/** Permissions that are new or wider in `after` than in `before`. */
export function accessGains(before: GrantMap, after: GrantMap): Grant[] {
  return Object.entries(after)
    .filter(([p, s]) => !before[p] || !scopeCovers(before[p]!, s))
    .map(([permission, scope]) => ({ permission, scope }));
}

/** First reason the actor may not cause these gains, or null. */
export function gainsBlockReason(actor: AccessActor, gains: Grant[]): string | null {
  for (const g of gains) {
    const r = ceilingReason(actor, g.permission, g.scope);
    if (r) return r;
  }
  return null;
}

/** The widest scope a catalogue permission supports (the default for a new "allowed" exception). */
export function widestScope(permission: string): Scope {
  const scopes = CATALOG_BY_KEY[permission]?.scopes ?? ['ORG'];
  return scopes[scopes.length - 1]!;
}
