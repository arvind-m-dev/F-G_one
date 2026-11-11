import { PERMISSIONS, type Permission } from '@fg/shared';

/** Anyone holding a permission behind an admin page may open the admin portal (each page and route checks its own). */
export const ADMIN_PERMS: Permission[] = [
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.EMPLOYEES_MANAGE,
  PERMISSIONS.DEPARTMENTS_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.ATTENDANCE_VIEW_ALL,
  PERMISSIONS.HOLIDAYS_MANAGE,
  PERMISSIONS.ANNOUNCEMENTS_MANAGE,
];
