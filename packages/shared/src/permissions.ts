/**
 * Permission catalogue. Permissions are the unit of authorization on the API;
 * roles are just named bundles of permissions stored per organization.
 */
export const PERMISSIONS = {
  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_MANAGE: 'employees.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  ROLES_MANAGE: 'roles.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_READ: 'audit.read',
  ANALYTICS_VIEW: 'analytics.view',
  ANNOUNCEMENTS_MANAGE: 'announcements.manage',
  HOLIDAYS_MANAGE: 'holidays.manage',
  CHANNELS_CREATE: 'channels.create',
  CHANNELS_MANAGE: 'channels.manage',
  ATTENDANCE_VIEW_TEAM: 'attendance.view_team',
  ATTENDANCE_VIEW_ALL: 'attendance.view_all',
  LEAVE_APPROVE: 'leave.approve',
  UPDATES_VIEW_TEAM: 'updates.view_team',
  UPDATES_VIEW_ALL: 'updates.view_all',
  CAMPAIGNS_MANAGE: 'campaigns.manage',
  DOCUMENTS_MANAGE: 'documents.manage',
  AI_USE: 'ai.use',
  AI_MANAGE: 'ai.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'employees.read': 'View employee directory',
  'employees.manage': 'Create, edit and deactivate employees and set their passwords',
  'departments.manage': 'Manage departments',
  'roles.manage': 'Manage roles and permissions',
  'settings.manage': 'Manage company settings and branding',
  'audit.read': 'View audit logs',
  'analytics.view': 'View company analytics',
  'announcements.manage': 'Publish announcements',
  'holidays.manage': 'Manage holiday calendar',
  'channels.create': 'Create channels and groups',
  'channels.manage': 'Manage any channel',
  'attendance.view_team': 'View team attendance',
  'attendance.view_all': 'View all attendance',
  'leave.approve': 'Approve leave requests',
  'updates.view_team': 'View team daily updates',
  'updates.view_all': 'View all daily updates',
  'campaigns.manage': 'Manage campaigns and promotions',
  'documents.manage': 'Manage document library',
  'ai.use': 'Use Ask FG One assistant',
  'ai.manage': 'Configure AI providers and limits',
};

export const SYSTEM_ROLES = {
  /** Ordinary assignable role. Super Admin authority is a separate flag (User.isSuperAdmin). */
  ADMINISTRATOR: 'administrator',
  HR_ADMIN: 'hr_admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
} as const;
export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const P = PERMISSIONS;
const EMPLOYEE_PERMS: Permission[] = [P.EMPLOYEES_READ, P.CHANNELS_CREATE, P.AI_USE];
const MANAGER_PERMS: Permission[] = [
  ...EMPLOYEE_PERMS,
  P.ATTENDANCE_VIEW_TEAM,
  P.LEAVE_APPROVE,
  P.UPDATES_VIEW_TEAM,
];
const HR_PERMS: Permission[] = [
  ...MANAGER_PERMS,
  P.EMPLOYEES_MANAGE,
  P.DEPARTMENTS_MANAGE,
  P.AUDIT_READ,
  P.ANALYTICS_VIEW,
  P.ANNOUNCEMENTS_MANAGE,
  P.HOLIDAYS_MANAGE,
  P.ATTENDANCE_VIEW_ALL,
  P.UPDATES_VIEW_ALL,
  P.CAMPAIGNS_MANAGE,
  P.DOCUMENTS_MANAGE,
  P.CHANNELS_MANAGE,
];

export const DEFAULT_ROLE_DEFINITIONS: {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: Permission[];
  rank: number;
}[] = [
  { key: 'administrator', name: 'Administrator', description: 'Runs company administration. Super Admin authority is separate.', permissions: ALL_PERMISSIONS, rank: 90 },
  { key: 'hr_admin', name: 'Admin / HR', description: 'People operations and company administration', permissions: HR_PERMS, rank: 75 },
  { key: 'manager', name: 'Manager', description: 'Leads a team; approves leave and reviews updates', permissions: MANAGER_PERMS, rank: 50 },
  { key: 'employee', name: 'Employee', description: 'Standard workspace member', permissions: EMPLOYEE_PERMS, rank: 10 },
];

export function hasPermission(granted: readonly string[], required: Permission | Permission[]): boolean {
  const req = Array.isArray(required) ? required : [required];
  return req.every((p) => granted.includes(p));
}
