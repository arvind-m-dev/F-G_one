import { z } from 'zod';

export const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #4f46e5');

export const MODULE_KEYS = [
  'chat',
  'attendance',
  'dailyUpdates',
  'leave',
  'holidays',
  'announcements',
  'documents',
  'campaigns',
  'events',
  'polls',
  'tasks',
  'recognition',
  'ai',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  chat: 'Chat & channels',
  attendance: 'Attendance',
  dailyUpdates: 'Daily updates',
  leave: 'Leave management',
  holidays: 'Holiday calendar',
  announcements: 'Announcements',
  documents: 'Documents',
  campaigns: 'Campaigns & noticeboard',
  events: 'Events calendar',
  polls: 'Polls & surveys',
  tasks: 'Work (projects and tasks)',
  recognition: 'Recognition & celebrations',
  ai: 'Ask FG One (AI)',
};

/** Dashboard widgets that exist today. New widgets register here and in the web widget registry. */
export const WIDGET_KEYS = [
  'welcome',
  'gettingStarted',
  'quickActions',
  'attendance',
  'clock',
  'recentChats',
  'announcements',
  'team',
  'holidays',
  'celebrations',
  'orgStats',
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

export const WIDGET_LABELS: Record<WidgetKey, string> = {
  welcome: 'Greeting & status',
  gettingStarted: 'Getting started checklist',
  attendance: 'Attendance (check in / out)',
  clock: 'Day timeline',
  team: 'Team pulse',
  announcements: 'Announcements',
  holidays: 'Upcoming holidays',
  celebrations: 'Celebrations',
  recentChats: 'Needs your attention',
  quickActions: 'Quick actions',
  orgStats: 'Company snapshot',
};

/** True when the runtime knows this IANA time zone (an unknown one would break every date calculation). */
export function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Same check as `isTimeZone` (kept for callers that use this name). */
export const isValidTimeZone = isTimeZone;

export const organizationSettingsSchema = z.object({
  branding: z
    .object({
      defaultTheme: z.enum(['light', 'dark', 'system']).default('system'),
      tagline: z.string().max(120).default('One workspace for everything Futurist Global'),
    })
    .default({}),
  modules: z
    .object(Object.fromEntries(MODULE_KEYS.map((k) => [k, z.boolean().default(true)])) as Record<ModuleKey, z.ZodDefault<z.ZodBoolean>>)
    .default({}),
  dashboard: z
    .object({
      defaultWidgets: z.array(z.enum(WIDGET_KEYS)).default([...WIDGET_KEYS]),
      allowPersonalLayout: z.boolean().default(true),
    })
    .default({}),
  navigation: z
    .object({
      sidebarCollapsedByDefault: z.boolean().default(false),
      showChatInSidebar: z.boolean().default(true),
    })
    .default({}),
  attendance: z
    .object({
      workdayStart: time.default('09:30'),
      workdayEnd: time.default('18:30'),
      graceMinutes: z.number().int().min(0).max(180).default(15),
      allowedLocations: z.array(z.enum(['WFO', 'WFH', 'ON_DUTY'])).min(1).default(['WFO', 'WFH', 'ON_DUTY']),
      workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      /** IANA time zone that defines the attendance day and "late" */
      timezone: z.string().min(1).max(60).refine(isTimeZone, 'Choose a valid time zone, such as Asia/Kolkata').default('Asia/Kolkata'),
      breaksEnabled: z.boolean().default(true),
      /** Allow checking in again after checking out on the same day (split shifts). */
      multipleSessions: z.boolean().default(false),
      /** On opening FG One without having checked in: do nothing, show a reminder, or check in automatically. */
      checkInMode: z.enum(['manual', 'prompt', 'auto']).default('prompt'),
      /** Location used by automatic check-in (falls back to the first allowed location). */
      autoCheckInLocation: z.enum(['WFO', 'WFH', 'ON_DUTY']).default('WFO'),
      /** Close shifts people forgot to end. Each rule is off at 0; the earliest enabled rule wins. */
      autoCheckOut: z
        .object({
          /** Hours after the workday ends (only for shifts that started before it ended). */
          afterWorkdayEndHours: z.number().int().min(0).max(12).default(0),
          /** Longest a single shift may run. */
          maxShiftHours: z.number().int().min(0).max(24).default(0),
          /** Minutes with no activity in FG One (not counted while on a break). */
          idleMinutes: z.number().int().min(0).max(480).default(0),
        })
        .default({}),
    })
    .default({}),
  leave: z
    .object({
      yearStartMonth: z.number().int().min(1).max(12).default(1),
      allowHalfDay: z.boolean().default(true),
      requireManagerApproval: z.boolean().default(true),
      /** "Sandwich" rule: weekends and holidays between the first and last leave day count as leave. */
      countDaysOffInside: z.boolean().default(false),
    })
    .default({}),
  auth: z
    .object({
      allowedEmailDomains: z.array(z.string().min(3)).min(1).default(['futuristglobal.com']),
      selfRegistration: z.boolean().default(false),
      sessionTtlHours: z.number().int().min(1).max(720).default(168),
      /**
       * false (default): only admins set and change passwords; people sign in with what the admin gave them.
       * true: admin-set passwords are temporary and people choose their own at first sign-in and in their profile.
       */
      selfServicePassword: z.boolean().default(false),
    })
    .default({}),
  security: z
    .object({
      /** How many Super Admins the organization may have (1 to SUPER_ADMIN_HARD_LIMIT). */
      superAdminLimit: z.number().int().min(1).max(4).default(4),
    })
    .default({}),
});
/** System maximum for Super Admins per organization; the org setting can only lower it. */
export const SUPER_ADMIN_HARD_LIMIT = 4;
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export function parseOrganizationSettings(raw: unknown): OrganizationSettings {
  const parsed = organizationSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : organizationSettingsSchema.parse({});
}

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Enter a company name of at least 2 characters').max(80).optional(),
  /** Only web addresses: the logo is shown on the public sign-in page. */
  logoUrl: z.string().trim().url('Enter a full web address starting with https://').max(500).refine((u) => /^https?:\/\//i.test(u), 'Enter a full web address starting with https://').nullable().optional(),
  primaryColor: HEX_COLOR.optional(),
  secondaryColor: HEX_COLOR.optional(),
  settings: organizationSettingsSchema.deepPartial().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/** Per-user preferences (theme, layout). */
export const userPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  accent: HEX_COLOR.nullable().optional(),
  sidebarCollapsed: z.boolean().optional(),
  chatPanelOpen: z.boolean().optional(),
  dashboardWidgets: z.array(z.enum(WIDGET_KEYS)).optional(),
  fontSize: z.enum(['sm', 'md', 'lg']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
  enterToSend: z.boolean().optional(),
  onboardingDismissed: z.boolean().optional(),
  notifications: z
    .object({
      dm: z.boolean().optional(),
      mentions: z.boolean().optional(),
      threads: z.boolean().optional(),
      announcements: z.boolean().optional(),
      requests: z.boolean().optional(),
      work: z.boolean().optional(),
    })
    .optional(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
