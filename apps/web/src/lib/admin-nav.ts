import { PERMISSIONS, type Permission } from '@fg/shared';
import { useCan, useSession } from '@/lib/session';

/**
 * Admin pages in navigation order with the permission each one needs.
 * Mirrors the admin list in `components/shell/workspace-shell.tsx` (`useNav`): keep the two in step.
 */
const ADMIN_PAGES: { href: string; perm?: Permission; superAdmin?: boolean }[] = [
  { href: '/admin', perm: PERMISSIONS.ANALYTICS_VIEW },
  { href: '/admin/employees', perm: PERMISSIONS.EMPLOYEES_MANAGE },
  { href: '/admin/departments', perm: PERMISSIONS.DEPARTMENTS_MANAGE },
  { href: '/admin/roles', perm: PERMISSIONS.EMPLOYEES_MANAGE },
  { href: '/admin/attendance', perm: PERMISSIONS.ATTENDANCE_VIEW_ALL },
  { href: '/admin/leave', perm: PERMISSIONS.EMPLOYEES_MANAGE },
  { href: '/admin/holidays', perm: PERMISSIONS.HOLIDAYS_MANAGE },
  { href: '/admin/announcements', perm: PERMISSIONS.ANNOUNCEMENTS_MANAGE },
  { href: '/admin/settings', perm: PERMISSIONS.SETTINGS_MANAGE },
  { href: '/admin/audit', perm: PERMISSIONS.AUDIT_READ },
  { href: '/admin/super-admins', superAdmin: true },
];

/** The first admin page this person may open, or null when there is none. */
export function firstAdminPage(can: (p: Permission) => boolean, superAdmin: boolean): string | null {
  return ADMIN_PAGES.find((p) => (p.superAdmin ? superAdmin : !p.perm || can(p.perm)))?.href ?? null;
}

/** Where "Admin portal" should take the signed-in person: the overview if they may see it, else their first page. */
export function useAdminHome(): string | null {
  const can = useCan();
  const me = useSession();
  return firstAdminPage(can, me.isSuperAdmin || me.superAdminNeedsMfa);
}
