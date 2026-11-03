import {
  ALL_PERMISSIONS, CATALOG_BY_KEY, DEFAULT_ROLE_DEFINITIONS, DEFAULT_ROLE_GRANTS, hasGrant, LEGACY_PERMISSION_MAP,
  legacyFromGrants, legacyToGrants, mergeGrants, PERMISSION_CATALOG, resolveGrants, scopeCovers,
} from '@fg/shared';

const g = (permission: string, scope: any) => ({ permission, scope });

describe('permission engine v2', () => {
  it('maps every legacy permission to catalogue entries with supported scopes', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(LEGACY_PERMISSION_MAP[p].length).toBeGreaterThan(0);
      for (const x of LEGACY_PERMISSION_MAP[p]) expect(CATALOG_BY_KEY[x.permission]?.scopes).toContain(x.scope);
    }
    expect(new Set(PERMISSION_CATALOG.map((e) => e.key)).size).toBe(PERMISSION_CATALOG.length);
  });

  it('default roles keep exactly their legacy permissions (migration equivalence)', () => {
    for (const r of DEFAULT_ROLE_DEFINITIONS) {
      expect(legacyFromGrants(mergeGrants(DEFAULT_ROLE_GRANTS[r.key]!)).sort()).toEqual([...r.permissions].sort());
    }
  });

  it('scope ordering: wider covers narrower, CLIENT is separate', () => {
    expect(scopeCovers('ORG', 'TEAM')).toBe(true);
    expect(scopeCovers('TEAM', 'ORG')).toBe(false);
    expect(scopeCovers('CLIENT', 'OWN')).toBe(false);
    expect(scopeCovers('ORG', 'CLIENT')).toBe(false);
    expect(scopeCovers('CLIENT', 'CLIENT')).toBe(true);
  });

  it('unions roles and keeps the widest scope', () => {
    const map = resolveGrants([{ grants: [g('attendance.view', 'TEAM')] }, { grants: [g('attendance.view', 'ORG'), g('ai.use', 'ORG')] }]);
    expect(map).toEqual({ 'attendance.view': 'ORG', 'ai.use': 'ORG' });
    expect(legacyFromGrants(map)).toEqual(expect.arrayContaining(['attendance.view_team', 'attendance.view_all', 'ai.use']));
  });

  it('ignores archived roles and unknown permissions (default deny)', () => {
    const map = resolveGrants([{ archivedAt: new Date(), grants: [g('roles.manage', 'ORG')] }, { grants: [g('made.up', 'ORG')] }]);
    expect(map).toEqual({});
    expect(hasGrant(map, 'roles.manage')).toBe(false);
  });

  it('explicit DENY beats every role; ALLOW adds at its scope', () => {
    const roles = [{ grants: legacyToGrants(['employees.manage', 'employees.read']) }, { grants: [g('employees.edit', 'ORG')] }];
    const map = resolveGrants(roles, [
      { permission: 'employees.edit', effect: 'DENY' },
      { permission: 'leave.approve', effect: 'ALLOW', scope: 'TEAM' },
    ]);
    expect(map['employees.edit']).toBeUndefined();
    expect(legacyFromGrants(map)).not.toContain('employees.manage'); // partial bundle = not held
    expect(legacyFromGrants(map)).toEqual(expect.arrayContaining(['employees.read', 'leave.approve']));
  });

  it('a TEAM grant does not satisfy an ORG legacy permission', () => {
    const map = resolveGrants([{ grants: [g('attendance.view', 'TEAM')] }]);
    expect(legacyFromGrants(map)).toContain('attendance.view_team');
    expect(legacyFromGrants(map)).not.toContain('attendance.view_all');
  });
});
