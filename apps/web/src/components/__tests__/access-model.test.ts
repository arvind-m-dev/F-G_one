import { DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, legacyFromGrants, mergeGrants } from '@fg/shared';
import type { Role } from '@/lib/types';
import { accessPreview, accessProblem, effectiveAccess, roleBlock, sameAccess } from '../admin/access-model';

const roles: Role[] = DEFAULT_ROLE_DEFINITIONS.map((r) => ({
  id: r.key,
  key: r.key,
  name: r.name,
  description: r.description,
  permissions: r.permissions,
  rank: r.rank,
  isSystem: true,
  memberCount: 0,
  assignable: true,
  grants: DEFAULT_ROLE_GRANTS[r.key]!,
  archivedAt: null,
}));
const hrGrants = mergeGrants(DEFAULT_ROLE_GRANTS.hr_admin!);
const hr = { isSuperAdmin: false, rank: 75, grants: hrGrants };
const superAdmin = { isSuperAdmin: true, rank: 90, grants: {} };

describe('access model (mirrors the API escalation rules)', () => {
  it('resolves roles, then allowed exceptions, then blocks', () => {
    const g = effectiveAccess(roles, {
      roleId: 'employee',
      extraRoleIds: ['manager'],
      overrides: [
        { permission: 'announcements.publish', effect: 'ALLOW', scope: 'ORG' },
        { permission: 'employees.view', effect: 'DENY', scope: null },
      ],
    });
    expect(g['leave.approve']).toBe('TEAM');
    expect(g['announcements.publish']).toBe('ORG');
    expect(g['employees.view']).toBeUndefined();
    expect(legacyFromGrants(g)).toContain('announcements.manage');
  });

  it('greys out roles at or above your rank, unless they already have it', () => {
    const admin = roles.find((r) => r.key === 'administrator')!;
    const manager = roles.find((r) => r.key === 'manager')!;
    expect(roleBlock(hr, admin)).toMatch(/higher role/);
    expect(roleBlock(hr, manager)).toBeNull();
    expect(roleBlock(hr, admin, { roleId: 'administrator', extraRoleIds: [], overrides: [] })).toBeNull();
    expect(roleBlock(superAdmin, admin)).toBeNull();
  });

  it('refuses sensitive or unheld exceptions for non-Super Admins', () => {
    const base = { roleId: 'employee', extraRoleIds: [] };
    expect(accessProblem(hr, roles, null, { ...base, overrides: [{ permission: 'roles.manage', effect: 'ALLOW', scope: 'ORG' }] })).toMatch(/Super Admin/);
    expect(accessProblem(hr, roles, null, { ...base, overrides: [{ permission: 'announcements.publish', effect: 'ALLOW', scope: 'ORG' }] })).toBeNull();
    expect(accessProblem(hr, roles, null, { ...base, overrides: [{ permission: 'ai.use', effect: 'DENY', scope: null }] })).toBeNull();
    expect(accessProblem(superAdmin, roles, null, { ...base, overrides: [{ permission: 'roles.manage', effect: 'ALLOW', scope: 'ORG' }] })).toBeNull();
    // Keeping an exception a Super Admin gave is fine; adding it is not.
    const given = { ...base, overrides: [{ permission: 'audit.view', effect: 'ALLOW' as const, scope: 'ORG' }] };
    expect(accessProblem(hr, roles, given, given)).toBeNull();
  });

  it('lists where each permission comes from', () => {
    const p = accessPreview(roles, { roleId: 'employee', extraRoleIds: [], overrides: [{ permission: 'announcements.publish', effect: 'ALLOW', scope: 'ORG' }, { permission: 'ai.use', effect: 'DENY', scope: null }] });
    const ann = p.modules.find((m) => m.key === 'announcements')!.items[0]!;
    expect(ann.sources).toEqual(['an exception for this person']);
    expect(p.blocked.map((e) => e.key)).toEqual(['ai.use']);
  });

  it('leaves features that do not exist yet out of the preview', () => {
    // The Employee role carries "Use the AI assistant", which is not built.
    const p = accessPreview(roles, { roleId: 'employee', extraRoleIds: [], overrides: [] });
    expect(p.grants['ai.use']).toBe('ORG');
    expect(p.modules.map((m) => m.key)).not.toContain('ai');
    expect(p.count).toBe(p.modules.reduce((n, m) => n + m.items.length, 0));
  });

  it('compares values ignoring order', () => {
    const a = { roleId: 'employee', extraRoleIds: ['manager', 'x'], overrides: [{ permission: 'a', effect: 'DENY' as const, scope: null }, { permission: 'b', effect: 'ALLOW' as const, scope: 'ORG' }] };
    expect(sameAccess(a, { ...a, extraRoleIds: ['x', 'manager'], overrides: [...a.overrides].reverse() })).toBe(true);
    expect(sameAccess(a, { ...a, extraRoleIds: ['manager'] })).toBe(false);
  });
});
