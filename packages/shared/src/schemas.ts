import { z } from 'zod';
import { PRESENCE_KEYS, REACTION_KEYS } from './presence';
import { HEX_COLOR, isTimeZone } from './settings';
import { CATALOG_BY_KEY, SCOPES } from './authz';

/** Request contracts shared by the API (validation) and the web app (forms). */

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Demo only (remove before go-live): one-click sign-in for a listed demo account, no password.
 * The server honours it only when DEMO_PASSWORDLESS_LOGIN is on, outside production, for an
 * allow-listed demo email. See the DEMO_PASSWORDLESS_LOGIN docs.
 */
export const demoLoginSchema = z.object({ email: emailSchema });
export type DemoLoginInput = z.infer<typeof demoLoginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

const name = z.string().trim().min(1).max(60);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalId = z.string().min(1).max(40).nullable().optional();
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()
  .optional();

export const createEmployeeSchema = z.object({
  email: emailSchema,
  firstName: name,
  lastName: name,
  roleId: z.string().min(1),
  departmentId: optionalId,
  managerId: optionalId,
  designation: optionalText(80),
  employeeCode: optionalText(30),
  joinedAt: optionalDate,
  /** Temporary password set by the admin; the employee must change it at first sign-in. */
  password: passwordSchema,
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const setEmployeePasswordSchema = z.object({ password: passwordSchema });

export const updateEmployeeSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  roleId: z.string().min(1).optional(),
  departmentId: optionalId,
  managerId: optionalId,
  designation: optionalText(80),
  employeeCode: optionalText(30),
  phone: optionalText(30),
  joinedAt: optionalDate,
  birthday: optionalDate,
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const updateProfileSchema = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  displayName: optionalText(60),
  phone: optionalText(30),
  bio: optionalText(280),
  pronouns: optionalText(30),
  timezone: z.string().max(60).refine(isTimeZone, 'Choose a time zone from the list').optional(),
  avatarUrl: z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Use a web address that starts with https://').nullable().optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  birthday: optionalDate,
  showBirthday: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const setStatusSchema = z.object({
  presence: z.enum(PRESENCE_KEYS),
  /** Legacy field; presence icons are derived from `presence`. */
  emoji: z.string().max(16).nullable().optional(),
  text: z.string().trim().max(100).nullable().optional(),
  expiry: z.enum(['never', '30m', '1h', '4h', 'today']).default('never'),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: optionalText(240),
  headId: optionalId,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const listEmployeesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  departmentId: z.string().max(40).optional(),
  /** ALL leaves out archived accounts; ask for ARCHIVED explicitly. */
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/* ---------------- chat ---------------- */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Use lowercase letters, numbers, - and _');

export const createChannelSchema = z.object({
  name: slug,
  description: optionalText(240),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  memberIds: z.array(z.string().min(1)).max(500).default([]),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: slug.optional(),
  description: optionalText(240),
  topic: optionalText(160),
});

export const openDirectMessageSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(8),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message is empty').max(4000),
  parentId: z.string().max(40).nullable().optional(),
  clientId: z.string().max(60).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const channelMembersSchema = z.object({ userIds: z.array(z.string().min(1)).min(1).max(200) });

export const reactionSchema = z.object({ emoji: z.enum(REACTION_KEYS) });

/* ---------------- attendance ---------------- */
export const WORK_LOCATIONS = [
  { key: 'WFO', label: 'Office', description: 'Working from the office' },
  { key: 'WFH', label: 'Home', description: 'Working from home' },
  { key: 'ON_DUTY', label: 'Client site', description: 'On duty or at a client location' },
] as const;
export type WorkLocationKey = (typeof WORK_LOCATIONS)[number]['key'];

export const checkInSchema = z.object({
  location: z.enum(['WFO', 'WFH', 'ON_DUTY']),
  remarks: z.string().trim().max(200).nullable().optional(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({ remarks: z.string().trim().max(200).nullable().optional() });

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30, 2026-13-01). */
export function isCalendarDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(isCalendarDate, 'Enter a real date');
/** Days between two YYYY-MM-DD dates (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
/** Longest range a history, export or leave request may cover. */
export const MAX_RANGE_DAYS = 366;
export const attendanceRangeSchema = z
  .object({ from: ymd.optional(), to: ymd.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { path: ['from'], message: '"from" must be on or before "to"' })
  .refine((v) => !v.from || !v.to || daysBetween(v.from, v.to) < MAX_RANGE_DAYS, { path: ['from'], message: `Choose at most ${MAX_RANGE_DAYS} days` });
export const attendanceBoardSchema = z.object({ date: ymd.optional() });

/* ---------------- announcements ---------------- */
export const ANNOUNCEMENT_CATEGORIES = [
  { key: 'COMPANY_NEWS', label: 'Company news' },
  { key: 'IMPORTANT_UPDATE', label: 'Important update' },
  { key: 'HOLIDAY', label: 'Holidays' },
  { key: 'NEW_FEATURE', label: 'New feature' },
  { key: 'POLICY', label: 'Policy change' },
  { key: 'EVENT', label: 'Event' },
  { key: 'TEAM_UPDATE', label: 'Team update' },
  { key: 'URGENT', label: 'Urgent notice' },
] as const;
export type AnnouncementCategoryKey = (typeof ANNOUNCEMENT_CATEGORIES)[number]['key'];

export const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Add a short title').max(140),
  body: z.string().trim().min(1, 'Write the announcement').max(8000),
  category: z.enum(['COMPANY_NEWS', 'IMPORTANT_UPDATE', 'HOLIDAY', 'NEW_FEATURE', 'POLICY', 'EVENT', 'TEAM_UPDATE', 'URGENT']).default('COMPANY_NEWS'),
  priority: z.enum(['NORMAL', 'IMPORTANT', 'CRITICAL']).default('NORMAL'),
  departmentId: z.string().max(40).nullable().optional(),
  pinned: z.boolean().default(false),
  requireAck: z.boolean().default(false),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const notificationsQuerySchema = z.object({
  filter: z.enum(['all', 'unread', 'mentions']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const markReadSchema = z.object({ ids: z.array(z.string().min(1)).max(200).optional(), all: z.boolean().optional() });

/* ---------------- holidays ---------------- */
export const HOLIDAY_TYPES = [
  { key: 'MANDATORY', label: 'Public holiday', description: 'Office closed for everyone' },
  { key: 'COMPANY', label: 'Company holiday', description: 'Closed by company decision' },
  { key: 'OPTIONAL', label: 'Optional holiday', description: 'Take it as leave if you choose' },
  { key: 'SPECIAL_WORKING_DAY', label: 'Special working day', description: 'A normally off day that is a working day' },
] as const;
export type HolidayTypeKey = (typeof HOLIDAY_TYPES)[number]['key'];

export const holidaySchema = z.object({
  name: z.string().trim().min(2, 'Add a name').max(80),
  date: ymd,
  type: z.enum(['MANDATORY', 'OPTIONAL', 'COMPANY', 'SPECIAL_WORKING_DAY']).default('MANDATORY'),
  description: z.string().trim().max(240).nullable().optional(),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

/* ---------------- leave ---------------- */
export const leaveTypeSchema = z.object({
  name: z.string().trim().min(2).max(40),
  code: z.string().trim().toUpperCase().min(2).max(10).regex(/^[A-Z0-9_]+$/, 'Letters, numbers and _ only'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  annualAllowance: z.coerce.number().min(0).max(365),
  paid: z.boolean().default(true),
  active: z.boolean().default(true),
  description: z.string().trim().max(200).nullable().optional(),
});
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;

const leaveRequestBase = z.object({
  typeId: z.string().min(1, 'Choose a leave type'),
  startDate: ymd,
  endDate: ymd,
  halfDay: z.enum(['NONE', 'FIRST_HALF', 'SECOND_HALF']).default('NONE'),
  reason: z.string().trim().max(500).nullable().optional(),
});
export const leaveRequestSchema = leaveRequestBase
  .refine((v) => v.startDate <= v.endDate, { path: ['endDate'], message: 'End date must be on or after the start date' })
  .refine((v) => v.endDate < v.startDate || daysBetween(v.startDate, v.endDate) < MAX_RANGE_DAYS, { path: ['endDate'], message: `Leave can cover at most ${MAX_RANGE_DAYS} days in one request` })
  .refine((v) => v.halfDay === 'NONE' || v.startDate === v.endDate, { path: ['halfDay'], message: 'Half days are for a single date' });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
/** HR records leave for someone; it is approved straight away. */
export const recordLeaveSchema = leaveRequestBase
  .extend({ userId: z.string().min(1, 'Choose an employee') })
  .refine((v) => v.startDate <= v.endDate, { path: ['endDate'], message: 'End date must be on or after the start date' })
  .refine((v) => v.endDate < v.startDate || daysBetween(v.startDate, v.endDate) < MAX_RANGE_DAYS, { path: ['endDate'], message: `Leave can cover at most ${MAX_RANGE_DAYS} days in one request` })
  .refine((v) => v.halfDay === 'NONE' || v.startDate === v.endDate, { path: ['halfDay'], message: 'Half days are for a single date' });
export type RecordLeaveInput = z.infer<typeof recordLeaveSchema>;

export const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(300).nullable().optional(),
});

export const leaveListSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL']).default('ALL'),
  scope: z.enum(['mine', 'approvals', 'all']).default('mine'),
});
export const leaveCalendarSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional() });

/* ---------------- attendance corrections ---------------- */
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const correctionSchema = z
  .object({
    date: ymd,
    checkIn: hm,
    checkOut: hm.nullable().optional(),
    location: z.enum(['WFO', 'WFH', 'ON_DUTY']),
    reason: z.string().trim().min(5, 'Explain briefly what needs fixing').max(500),
  })
  .refine((v) => !v.checkOut || v.checkOut > v.checkIn, { path: ['checkOut'], message: 'Check-out must be after check-in' });
export type CorrectionInput = z.infer<typeof correctionSchema>;

// ───────────── Super Admins (Phase 2b) ─────────────
/** Sensitive Super Admin actions require the caller's current password (re-authentication). */
export const superAdminInviteSchema = z.object({ userId: z.string().min(1), password: z.string().min(1).max(200) });
export type SuperAdminInviteInput = z.infer<typeof superAdminInviteSchema>;
export const superAdminConfirmSchema = z.object({ password: z.string().min(1).max(200) });
export type SuperAdminConfirmInput = z.infer<typeof superAdminConfirmSchema>;
export const superAdminAcceptSchema = z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) });
export type SuperAdminAcceptInput = z.infer<typeof superAdminAcceptSchema>;
/** The nominee looks up their own nomination before accepting. */
export const superAdminTokenSchema = z.object({ token: z.string().min(10).max(200) });
export type SuperAdminTokenInput = z.infer<typeof superAdminTokenSchema>;

// ───────── two-step verification and re-authentication (Phase 2c) ─────────

/** A 6-digit authenticator code, or a recovery code like `k3f9-2xq7-mm4p`. */
export const mfaCodeSchema = z.object({ code: z.string().trim().min(6, 'Enter the code').max(20) });
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

/** Prove identity again before a sensitive action. `code` is required when two-step verification is on. */
export const reauthSchema = z.object({ password: z.string().min(1, 'Enter your password').max(200), code: z.string().trim().max(20).optional() });
export type ReauthInput = z.infer<typeof reauthSchema>;

// ───────── employee 360 (admin) ─────────
/** An admin changes someone's work email. It must use a company domain; the person is signed out everywhere. */
export const changeEmployeeEmailSchema = z.object({ email: emailSchema });
export type ChangeEmployeeEmailInput = z.infer<typeof changeEmployeeEmailSchema>;

// ───────── user management (Super Admin Phase 3) ─────────

/** Suspend an account (reversible). The reason is shown to admins only. */
export const suspendEmployeeSchema = z.object({ reason: z.string().trim().max(300).nullable().optional() });
export type SuspendEmployeeInput = z.infer<typeof suspendEmployeeSchema>;

/** One exception for one person. DENY removes the permission whatever their roles say; ALLOW adds it at `scope`. */
export const permissionOverrideSchema = z
  .object({
    permission: z.string().min(1).max(80).refine((p) => !!CATALOG_BY_KEY[p], 'Unknown permission'),
    effect: z.enum(['ALLOW', 'DENY']),
    scope: z.enum(SCOPES).nullable().optional(),
  })
  .refine((o) => o.effect === 'DENY' || !o.scope || !CATALOG_BY_KEY[o.permission] || CATALOG_BY_KEY[o.permission]!.scopes.includes(o.scope), {
    path: ['scope'],
    message: 'This permission is not available at that reach',
  });
export type PermissionOverrideInput = z.infer<typeof permissionOverrideSchema>;

const accessFields = {
  extraRoleIds: z
    .array(z.string().min(1).max(40))
    .max(20)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, 'Each extra role can only be added once'),
  overrides: z
    .array(permissionOverrideSchema)
    .max(60)
    .default([])
    .refine((os) => new Set(os.map((o) => o.permission)).size === os.length, 'Add at most one exception per permission'),
};

/** Replace one person's access: main role, extra roles and exceptions. */
export const updateEmployeeAccessSchema = z.object({ roleId: z.string().min(1).max(40).optional(), ...accessFields });
export type UpdateEmployeeAccessInput = z.infer<typeof updateEmployeeAccessSchema>;

/** Account creation wizard: person, access and password in one request (created atomically). */
export const createAccountSchema = createEmployeeSchema.extend(accessFields);
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
/** Wizard step 1 (the person) and step 3 (the password) validate these slices of the same contract. */
export const accountPersonSchema = createEmployeeSchema.pick({ firstName: true, lastName: true, email: true, designation: true, departmentId: true, managerId: true, employeeCode: true, joinedAt: true });
export const accountPasswordSchema = createEmployeeSchema.pick({ password: true });

/* ---------------- work: projects, tasks, timeline requests ---------------- */
export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: 'Later',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};
/** Statuses that still need work (they count towards someone's workload). */
export const OPEN_TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW'];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { LOW: 'Low', MEDIUM: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export const TASK_KINDS = ['TASK', 'BUG', 'ENHANCEMENT'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_KIND_LABELS: Record<TaskKind, string> = { TASK: 'Task', BUG: 'Bug', ENHANCEMENT: 'Improvement' };

export const TASK_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type TaskSize = (typeof TASK_SIZES)[number];
/** Working days of effort each size stands for. The planner and workload figures use these. */
export const TASK_SIZE_DAYS: Record<TaskSize, number> = { XS: 0.5, S: 1, M: 2, L: 5, XL: 10 };
export const TASK_SIZE_LABELS: Record<TaskSize, string> = {
  XS: 'Tiny · half a day',
  S: 'Small · 1 day',
  M: 'Medium · 2 days',
  L: 'Large · 1 week',
  XL: 'Huge · 2 weeks',
};

export const PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = { ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };

const optionalYmd = ymd.nullable().optional();
const idList = z.array(z.string().min(1).max(40)).max(100).refine((ids) => new Set(ids).size === ids.length, 'Each person can only be added once');

export const projectSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the project a name of at least 2 characters').max(80),
    /** Short code shown before task numbers, such as WEB in WEB-12. */
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Use 2 to 6 letters or numbers, starting with a letter'),
    description: z.string().trim().max(2000).nullable().optional(),
    color: HEX_COLOR.default('#6366f1'),
    status: z.enum(PROJECT_STATUSES).default('ACTIVE'),
    leadId: z.string().min(1).max(40).nullable().optional(),
    memberIds: idList.default([]),
    startDate: optionalYmd,
    targetDate: optionalYmd,
  })
  .refine((v) => !v.startDate || !v.targetDate || v.startDate <= v.targetDate, { path: ['targetDate'], message: 'The target date must be on or after the start date' });
export type ProjectInput = z.infer<typeof projectSchema>;
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the project a name of at least 2 characters').max(80).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    color: HEX_COLOR.optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    leadId: z.string().min(1).max(40).nullable().optional(),
    memberIds: idList.optional(),
    startDate: optionalYmd,
    targetDate: optionalYmd,
  })
  .refine((v) => !v.startDate || !v.targetDate || v.startDate <= v.targetDate, { path: ['targetDate'], message: 'The target date must be on or after the start date' });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** A link on a task, for example a pull request or a design file. Web addresses only. */
export const taskLinkSchema = z.object({
  label: z.string().trim().max(80).default(''),
  url: z.string().trim().url('Enter a full web address starting with https://').max(500).refine((u) => /^https?:\/\//i.test(u), 'Enter a full web address starting with https://'),
});
export type TaskLink = z.infer<typeof taskLinkSchema>;

const taskFields = {
  title: z.string().trim().min(2, 'Describe the task in a few words').max(200),
  description: z.string().trim().max(8000).nullable().optional(),
  projectId: z.string().min(1).max(40).nullable().optional(),
  kind: z.enum(TASK_KINDS).default('TASK'),
  status: z.enum(TASK_STATUSES).default('TODO'),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
  size: z.enum(TASK_SIZES).default('M'),
  assigneeId: z.string().min(1).max(40).nullable().optional(),
  startDate: optionalYmd,
  dueDate: optionalYmd,
  links: z.array(taskLinkSchema).max(10).default([]),
};
const datesInOrder = (v: { startDate?: string | null; dueDate?: string | null }) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate;
const datesMessage = { path: ['dueDate'], message: 'The due date must be on or after the start date' };
export const taskSchema = z.object(taskFields).refine(datesInOrder, datesMessage);
export type TaskInput = z.infer<typeof taskSchema>;
/** Partial update. `position` orders cards within a board column. `projectId` cannot change after creation. */
export const updateTaskSchema = z
  .object({
    title: taskFields.title.optional(),
    description: taskFields.description,
    kind: z.enum(TASK_KINDS).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    size: z.enum(TASK_SIZES).optional(),
    assigneeId: taskFields.assigneeId,
    startDate: optionalYmd,
    dueDate: optionalYmd,
    links: z.array(taskLinkSchema).max(10).optional(),
    position: z.number().finite().optional(),
  })
  .refine(datesInOrder, datesMessage);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskListSchema = z.object({
  /** mine: assigned to me. team: people who report to me. all: everything I may see. */
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  projectId: z.string().max(40).optional(),
  assigneeId: z.string().max(40).optional(),
  status: z.enum([...TASK_STATUSES, 'OPEN', 'ALL']).default('ALL'),
  q: z.string().trim().max(80).optional(),
});
export type TaskListQuery = z.infer<typeof taskListSchema>;

export const taskCommentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment first').max(4000) });

export const WORK_REQUEST_KINDS = ['MOVE_DATE', 'REASSIGN'] as const;
export type WorkRequestKind = (typeof WORK_REQUEST_KINDS)[number];
/** "I can't finish this on time": ask for a later date or for someone else to take it. A lead or manager decides. */
export const workRequestSchema = z
  .object({
    kind: z.enum(WORK_REQUEST_KINDS),
    reason: z.string().trim().min(5, 'Say briefly why, so your lead can decide quickly').max(500),
    proposedDueDate: optionalYmd,
    proposedAssigneeId: z.string().min(1).max(40).nullable().optional(),
  })
  .refine((v) => v.kind !== 'MOVE_DATE' || !!v.proposedDueDate, { path: ['proposedDueDate'], message: 'Choose the new date' });
export type WorkRequestInput = z.infer<typeof workRequestSchema>;
export const workRequestListSchema = z.object({
  scope: z.enum(['mine', 'approvals']).default('mine'),
  status: z.enum(['PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'ALL']).default('ALL'),
});
/** Decision on a request. When the person asking named nobody, the approver chooses who takes the task. */
export const workDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(300).nullable().optional(),
  assigneeId: z.string().min(1).max(40).nullable().optional(),
});
