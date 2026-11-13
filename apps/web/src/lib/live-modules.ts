import { CATALOG_BY_KEY, LEGACY_PERMISSION_MAP, MODULE_KEYS, type ModuleKey, type Permission } from '@fg/shared';

/**
 * Modules that work end to end today. This is the one place to switch a module on in the admin
 * portal: System settings (Modules), the Roles & permissions matrix and the per-person Exceptions
 * list all read it. Add the module key here when its feature ships.
 */
export const LIVE_MODULES: readonly ModuleKey[] = ['chat', 'attendance', 'leave', 'holidays', 'announcements', 'tasks', 'recognition'];

const live = new Set<ModuleKey>(LIVE_MODULES);

/** Live modules in the order they are listed in settings. */
export const LIVE_MODULE_KEYS: ModuleKey[] = MODULE_KEYS.filter((k) => live.has(k));

/**
 * Permission-catalog module → the workspace module it belongs to.
 * Catalog modules that are not listed (employees, departments, dashboard, admin) are core and always shown.
 */
const PERMISSION_MODULE_FEATURE: Record<string, ModuleKey> = {
  attendance: 'attendance',
  leave: 'leave',
  work: 'tasks',
  chat: 'chat',
  announcements: 'announcements',
  calendar: 'holidays',
  updates: 'dailyUpdates',
  documents: 'documents',
  campaigns: 'campaigns',
  ai: 'ai',
};

/** Whether a permission-catalog module (for example "documents") belongs to a feature that exists today. */
export function isLivePermissionModule(module: string): boolean {
  const feature = PERMISSION_MODULE_FEATURE[module];
  return !feature || live.has(feature);
}

/** Whether a catalog permission (for example "ai.use") belongs to a feature that exists today. */
export function isLiveCatalogPermission(key: string): boolean {
  const entry = CATALOG_BY_KEY[key];
  return !!entry && isLivePermissionModule(entry.module);
}

/** Whether a flat permission (for example "documents.manage") belongs to a feature that exists today. */
export function isLivePermission(permission: string): boolean {
  const grants = LEGACY_PERMISSION_MAP[permission as Permission];
  return !!grants && grants.every((g) => isLiveCatalogPermission(g.permission));
}
