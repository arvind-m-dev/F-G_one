/**
 * Permission engine v2 (Super Admin PRD, Phase 2a).
 *
 * - The catalogue (what can be granted) is code, because each entry needs enforcement code.
 * - Roles and their grants are data (RoleGrant rows), so roles can be edited without code.
 * - A grant is a permission at a data scope. The widest scope across a user's roles wins;
 *   an explicit DENY override always wins; default is deny.
 *
 * During migration every v2 grant also maps back to the legacy flat permissions
 * (`permissions.ts`), so existing `@RequirePermissions(PERMISSIONS.X)` checks keep working.
 * A catalogue entry only lists the scopes that the API actually enforces today.
 */
import { DEFAULT_ROLE_DEFINITIONS, PERMISSIONS, type Permission } from './permissions';

export const SCOPES = ['CLIENT', 'OWN', 'ASSIGNED', 'PROJECT', 'TEAM', 'DEPARTMENT', 'ORG'] as const;
export type Scope = (typeof SCOPES)[number];
const RANK: Record<Scope, number> = Object.fromEntries(SCOPES.map((s, i) => [s, i])) as Record<Scope, number>;

export const SCOPE_LABELS: Record<Scope, string> = {
  CLIENT: 'Their client projects',
  OWN: 'Only their own',
  ASSIGNED: 'Assigned to them',
  PROJECT: 'Their projects',
  TEAM: 'Their team',
  DEPARTMENT: 'Their department',
  ORG: 'Everyone in the company',
};

/** True when `has` covers `needed` (a wider scope implies the narrower ones). CLIENT is only satisfied by CLIENT. */
export function scopeCovers(has: Scope, needed: Scope): boolean {
  if (needed === 'CLIENT') return has === 'CLIENT';
  if (has === 'CLIENT') return false;
  return RANK[has] >= RANK[needed];
}
export const widerScope = (a: Scope, b: Scope): Scope => (RANK[a] >= RANK[b] ? a : b);

export interface CatalogEntry {
  key: string;
  module: string;
  action: string;
  scopes: Scope[];
  label: string;
  help: string;
  /** Only a Super Admin may grant it (enforced from Phase 4). */
  sensitive?: boolean;
}

export const PERMISSION_MODULES: Record<string, string> = {
  dashboard: 'Dashboard',
  employees: 'Employees',
  departments: 'Departments',
  attendance: 'Attendance',
  leave: 'Leave',
  updates: 'Daily updates',
  chat: 'Chat',
  announcements: 'Announcements',
  calendar: 'Calendar & holidays',
  documents: 'Documents',
  campaigns: 'Campaigns',
  ai: 'AI assistant',
  admin: 'Administration',
};

export const PERMISSION_CATALOG: CatalogEntry[] = [
  { key: 'dashboard.view_org', module: 'dashboard', action: 'view', scopes: ['ORG'], label: 'See company analytics', help: 'Headcount, attendance and activity charts for the whole company.' },
  { key: 'employees.view', module: 'employees', action: 'view', scopes: ['ORG'], label: 'View the employee directory', help: 'Names, titles, departments and work contact details. Not private HR records.' },
  { key: 'employees.create', module: 'employees', action: 'create', scopes: ['ORG'], label: 'Add employees', help: 'Create accounts with a work email and a password to hand over.' },
  { key: 'employees.edit', module: 'employees', action: 'edit', scopes: ['ORG'], label: 'Edit employee details', help: 'Change job details, department, manager and role (only roles below their own).' },
  { key: 'employees.deactivate', module: 'employees', action: 'archive', scopes: ['ORG'], label: 'Deactivate and reactivate accounts', help: 'Deactivated people cannot sign in. Their history is kept.' },
  { key: 'departments.manage', module: 'departments', action: 'manage', scopes: ['ORG'], label: 'Manage departments', help: 'Create, rename and remove departments and set their heads.' },
  { key: 'attendance.view', module: 'attendance', action: 'view', scopes: ['TEAM', 'ORG'], label: 'See other people’s attendance', help: 'Everyone always sees their own. Team = people who report to them.' },
  { key: 'leave.approve', module: 'leave', action: 'approve', scopes: ['TEAM'], label: 'Approve leave', help: 'Approve or decline leave for people who report to them. HR can decide for anyone.' },
  { key: 'updates.view', module: 'updates', action: 'view', scopes: ['TEAM', 'ORG'], label: 'Read other people’s daily updates', help: 'Team = people who report to them.' },
  { key: 'chat.create_channel', module: 'chat', action: 'create', scopes: ['ORG'], label: 'Create channels and groups', help: 'Start new public or private conversations.' },
  { key: 'chat.manage', module: 'chat', action: 'manage', scopes: ['ORG'], label: 'Moderate any channel', help: 'Edit any channel, manage members and remove messages.' },
  { key: 'announcements.publish', module: 'announcements', action: 'publish', scopes: ['ORG'], label: 'Publish announcements', help: 'Write, edit, pin and remove company announcements.' },
  { key: 'calendar.manage_holidays', module: 'calendar', action: 'manage', scopes: ['ORG'], label: 'Manage holidays', help: 'Add and change company holidays and special working days.' },
  { key: 'documents.manage', module: 'documents', action: 'manage', scopes: ['ORG'], label: 'Manage company documents', help: 'Upload and organise the document library.' },
  { key: 'campaigns.manage', module: 'campaigns', action: 'manage', scopes: ['ORG'], label: 'Manage campaigns', help: 'Create and run company campaigns.' },
  { key: 'ai.use', module: 'ai', action: 'view', scopes: ['ORG'], label: 'Use the AI assistant', help: 'Ask questions about company information they can already see.' },
  { key: 'ai.configure', module: 'ai', action: 'configure', scopes: ['ORG'], label: 'Configure the AI assistant', help: 'Choose providers and usage limits.', sensitive: true },
  { key: 'roles.manage', module: 'admin', action: 'manage', scopes: ['ORG'], label: 'Manage roles and permissions', help: 'Create and edit roles and what they allow.', sensitive: true },
  { key: 'settings.configure', module: 'admin', action: 'configure', scopes: ['ORG'], label: 'Change company settings', help: 'Branding, working hours, policies and security settings.', sensitive: true },
  { key: 'audit.view', module: 'admin', action: 'view', scopes: ['ORG'], label: 'View audit logs', help: 'The record of administrative and security events.', sensitive: true },
];
export const CATALOG_BY_KEY: Record<string, CatalogEntry> = Object.fromEntries(PERMISSION_CATALOG.map((e) => [e.key, e]));

export interface Grant {
  permission: string;
  scope: Scope;
}
/** permission key → widest scope held */
export type GrantMap = Record<string, Scope>;

/** Legacy flat permission → the v2 grants it means. A legacy permission is held only when all of them are. */
export const LEGACY_PERMISSION_MAP: Record<Permission, Grant[]> = {
  [PERMISSIONS.EMPLOYEES_READ]: [{ permission: 'employees.view', scope: 'ORG' }],
  [PERMISSIONS.EMPLOYEES_MANAGE]: [
    { permission: 'employees.create', scope: 'ORG' },
    { permission: 'employees.edit', scope: 'ORG' },
    { permission: 'employees.deactivate', scope: 'ORG' },
  ],
  [PERMISSIONS.DEPARTMENTS_MANAGE]: [{ permission: 'departments.manage', scope: 'ORG' }],
  [PERMISSIONS.ROLES_MANAGE]: [{ permission: 'roles.manage', scope: 'ORG' }],
  [PERMISSIONS.SETTINGS_MANAGE]: [{ permission: 'settings.configure', scope: 'ORG' }],
  [PERMISSIONS.AUDIT_READ]: [{ permission: 'audit.view', scope: 'ORG' }],
  [PERMISSIONS.ANALYTICS_VIEW]: [{ permission: 'dashboard.view_org', scope: 'ORG' }],
  [PERMISSIONS.ANNOUNCEMENTS_MANAGE]: [{ permission: 'announcements.publish', scope: 'ORG' }],
  [PERMISSIONS.HOLIDAYS_MANAGE]: [{ permission: 'calendar.manage_holidays', scope: 'ORG' }],
  [PERMISSIONS.CHANNELS_CREATE]: [{ permission: 'chat.create_channel', scope: 'ORG' }],
  [PERMISSIONS.CHANNELS_MANAGE]: [{ permission: 'chat.manage', scope: 'ORG' }],
  [PERMISSIONS.ATTENDANCE_VIEW_TEAM]: [{ permission: 'attendance.view', scope: 'TEAM' }],
  [PERMISSIONS.ATTENDANCE_VIEW_ALL]: [{ permission: 'attendance.view', scope: 'ORG' }],
  [PERMISSIONS.LEAVE_APPROVE]: [{ permission: 'leave.approve', scope: 'TEAM' }],
  [PERMISSIONS.UPDATES_VIEW_TEAM]: [{ permission: 'updates.view', scope: 'TEAM' }],
  [PERMISSIONS.UPDATES_VIEW_ALL]: [{ permission: 'updates.view', scope: 'ORG' }],
  [PERMISSIONS.CAMPAIGNS_MANAGE]: [{ permission: 'campaigns.manage', scope: 'ORG' }],
  [PERMISSIONS.DOCUMENTS_MANAGE]: [{ permission: 'documents.manage', scope: 'ORG' }],
  [PERMISSIONS.AI_USE]: [{ permission: 'ai.use', scope: 'ORG' }],
  [PERMISSIONS.AI_MANAGE]: [{ permission: 'ai.configure', scope: 'ORG' }],
};

/** Merge grants, keeping the widest scope per permission. Unknown permissions are dropped. */
export function mergeGrants(grants: Iterable<Grant>): GrantMap {
  const out: GrantMap = {};
  for (const g of grants) {
    if (!CATALOG_BY_KEY[g.permission]) continue;
    const cur = out[g.permission];
    out[g.permission] = cur ? widerScope(cur, g.scope) : g.scope;
  }
  return out;
}

export function legacyToGrants(perms: readonly Permission[]): Grant[] {
  const map = mergeGrants(perms.flatMap((p) => LEGACY_PERMISSION_MAP[p] ?? []));
  return Object.entries(map).map(([permission, scope]) => ({ permission, scope }));
}

export function legacyFromGrants(map: GrantMap): Permission[] {
  return (Object.keys(LEGACY_PERMISSION_MAP) as Permission[]).filter((p) =>
    LEGACY_PERMISSION_MAP[p].every((g) => map[g.permission] !== undefined && scopeCovers(map[g.permission]!, g.scope)),
  );
}

export interface OverrideInput {
  permission: string;
  effect: 'ALLOW' | 'DENY';
  scope?: Scope | null;
}

/**
 * Effective grants for a user. Deterministic:
 * 1. union of all non-archived roles, widest scope per permission;
 * 2. ALLOW overrides add at their scope (widest wins);
 * 3. DENY overrides remove the permission, whatever the roles say.
 * Super Admins get everything at ORG; client accounts are masked to CLIENT-scoped permissions.
 */
export function resolveGrants(
  roles: { archivedAt?: Date | null; grants: Grant[] }[],
  overrides: OverrideInput[] = [],
  subject: { isSuperAdmin?: boolean; accountType?: 'INTERNAL' | 'CLIENT' } = {},
): GrantMap {
  // Client accounts: only permissions that support the CLIENT scope, always at CLIENT.
  // Checked first so a client can never become a Super Admin through bad data.
  if (subject.accountType === 'CLIENT') {
    const out: GrantMap = {};
    const merged = resolveGrants(roles, overrides);
    for (const k of Object.keys(merged)) if (CATALOG_BY_KEY[k]?.scopes.includes('CLIENT')) out[k] = 'CLIENT';
    return out;
  }
  // Super Admin: every catalogue permission at ORG. Overrides do not apply.
  if (subject.isSuperAdmin) return Object.fromEntries(PERMISSION_CATALOG.map((e) => [e.key, 'ORG' as Scope]));
  const all: Grant[] = roles.filter((r) => !r.archivedAt).flatMap((r) => r.grants);
  for (const o of overrides) if (o.effect === 'ALLOW') all.push({ permission: o.permission, scope: o.scope ?? 'ORG' });
  const map = mergeGrants(all);
  for (const o of overrides) if (o.effect === 'DENY') delete map[o.permission];
  return map;
}

/** Scope held for a permission, or null (default deny). */
export function grantScope(map: GrantMap, permission: string): Scope | null {
  return map[permission] ?? null;
}
export function hasGrant(map: GrantMap, permission: string, atLeast: Scope = 'OWN'): boolean {
  const s = map[permission];
  return s !== undefined && scopeCovers(s, atLeast);
}

/** The default system roles expressed as v2 grants. */
export const DEFAULT_ROLE_GRANTS: Record<string, Grant[]> = Object.fromEntries(
  DEFAULT_ROLE_DEFINITIONS.map((r) => [r.key, legacyToGrants(r.permissions)]),
);
