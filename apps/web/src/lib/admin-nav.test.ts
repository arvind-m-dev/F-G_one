import { PERMISSIONS, type Permission } from '@fg/shared';
import { describe, expect, it } from 'vitest';
import { firstAdminPage } from './admin-nav';

const canOnly =
  (...held: Permission[]) =>
  (p: Permission) =>
    held.includes(p);

describe('first admin page a person may open', () => {
  it('is the overview for people who can see company analytics', () => {
    expect(firstAdminPage(canOnly(PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.HOLIDAYS_MANAGE), false)).toBe('/admin');
  });
  it('is the first page they manage when they cannot see the overview', () => {
    expect(firstAdminPage(canOnly(PERMISSIONS.HOLIDAYS_MANAGE, PERMISSIONS.ANNOUNCEMENTS_MANAGE), false)).toBe('/admin/holidays');
    expect(firstAdminPage(canOnly(PERMISSIONS.AUDIT_READ), false)).toBe('/admin/audit');
    expect(firstAdminPage(canOnly(PERMISSIONS.EMPLOYEES_MANAGE), false)).toBe('/admin/employees');
  });
  it('is the Super Admins page for a Super Admin with no other admin permission, and nothing for anyone else', () => {
    expect(firstAdminPage(canOnly(), true)).toBe('/admin/super-admins');
    expect(firstAdminPage(canOnly(), false)).toBeNull();
  });
});
