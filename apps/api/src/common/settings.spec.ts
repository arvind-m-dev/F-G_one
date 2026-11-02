import { DEFAULT_ROLE_DEFINITIONS, hasPermission, organizationSettingsSchema, parseOrganizationSettings, PERMISSIONS } from '@fg/shared';

describe('shared settings & permissions', () => {
  it('fills defaults for an empty settings object', () => {
    const s = parseOrganizationSettings({});
    expect(s.auth.allowedEmailDomains).toEqual(['futuristglobal.com']);
    expect(s.auth.selfRegistration).toBe(false);
    expect(s.modules.chat).toBe(true);
  });
  it('falls back to defaults for invalid stored settings', () => {
    expect(parseOrganizationSettings({ attendance: { workdayStart: '99:99' } }).attendance.workdayStart).toBe('09:30');
  });
  it('rejects invalid colours / times', () => {
    expect(organizationSettingsSchema.safeParse({ attendance: { workdayEnd: '25:00' } }).success).toBe(false);
  });
  it('role hierarchy grants are monotonic', () => {
    const [sa, hr, mgr, emp] = DEFAULT_ROLE_DEFINITIONS;
    for (const p of emp!.permissions) expect(mgr!.permissions).toContain(p);
    for (const p of mgr!.permissions) expect(hr!.permissions).toContain(p);
    for (const p of hr!.permissions) expect(sa!.permissions).toContain(p);
    expect(hasPermission(emp!.permissions, PERMISSIONS.EMPLOYEES_MANAGE)).toBe(false);
    expect(hasPermission(hr!.permissions, PERMISSIONS.ROLES_MANAGE)).toBe(false);
  });
});
