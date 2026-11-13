import { ALL_PERMISSIONS, MODULE_KEYS, PERMISSION_CATALOG, PERMISSIONS } from '@fg/shared';
import { describe, expect, it } from 'vitest';
import { isLiveCatalogPermission, isLivePermission, isLivePermissionModule, LIVE_MODULE_KEYS, LIVE_MODULES } from './live-modules';

describe('live modules (the one list that switches a feature on in the admin portal)', () => {
  it('lists only real module keys, in settings order', () => {
    for (const k of LIVE_MODULES) expect(MODULE_KEYS).toContain(k);
    expect(LIVE_MODULE_KEYS).toEqual(MODULE_KEYS.filter((k) => LIVE_MODULES.includes(k)));
    // Not built yet: these must not show up as switches or permissions.
    for (const k of ['dailyUpdates', 'documents', 'campaigns', 'events', 'polls', 'ai'] as const) expect(LIVE_MODULES).not.toContain(k);
    // Work (projects and tasks) shipped with the Work hub.
    expect(LIVE_MODULES).toContain('tasks');
  });

  it('hides permissions of features that do not exist yet, and keeps core administration', () => {
    for (const p of [PERMISSIONS.AI_USE, PERMISSIONS.AI_MANAGE, PERMISSIONS.DOCUMENTS_MANAGE, PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.UPDATES_VIEW_TEAM, PERMISSIONS.UPDATES_VIEW_ALL]) expect(isLivePermission(p)).toBe(false);
    for (const p of [PERMISSIONS.EMPLOYEES_MANAGE, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_READ, PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.LEAVE_APPROVE, PERMISSIONS.HOLIDAYS_MANAGE, PERMISSIONS.CHANNELS_CREATE, PERMISSIONS.WORK_MANAGE_TEAM, PERMISSIONS.WORK_MANAGE_ALL]) expect(isLivePermission(p)).toBe(true);
    expect(isLivePermission('not.a.permission')).toBe(false);
    expect(ALL_PERMISSIONS.filter(isLivePermission).length).toBe(ALL_PERMISSIONS.length - 6);
  });

  it('applies the same rule to the permission catalogue', () => {
    expect(isLivePermissionModule('admin')).toBe(true);
    expect(isLivePermissionModule('documents')).toBe(false);
    expect(isLivePermissionModule('work')).toBe(true);
    expect(PERMISSION_CATALOG.filter((e) => !isLiveCatalogPermission(e.key)).map((e) => e.key).sort()).toEqual(['ai.configure', 'ai.use', 'campaigns.manage', 'documents.manage', 'updates.view']);
  });
});
