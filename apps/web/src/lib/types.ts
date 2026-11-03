import type { OrganizationSettings, UserPreferences } from '@fg/shared';

export interface Person {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  avatarUrl: string | null;
  avatarColor: string;
  department: { id: string; name: string; color: string } | null;
  presence: string;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  online: boolean;
}

export interface Employee extends Person {
  email: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'ARCHIVED';
  accountType: 'INTERNAL' | 'CLIENT';
  /** System authority, separate from the role. */
  isSuperAdmin: boolean;
  displayName: string | null;
  employeeCode?: string | null;
  phone: string | null;
  pronouns: string | null;
  bio: string | null;
  timezone: string;
  joinedAt: string | null;
  birthday: string | null;
  showBirthday?: boolean;
  lastSeenAt: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  role: { id: string; key: string; name: string; rank: number };
  manager: { id: string; firstName: string; lastName: string; avatarUrl: string | null; avatarColor: string } | null;
  reports?: { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null; designation: string | null }[];
}

export interface Me {
  user: Employee;
  permissions: string[];
  /** Effective scoped grants: permission → widest scope (ORG, TEAM, ...). */
  grants: Record<string, string>;
  role: { key: string; rank: number };
  isSuperAdmin: boolean;
  accountType: 'INTERNAL' | 'CLIENT';
  /** Two-step verification is on for this account. */
  mfaEnabled: boolean;
  /** Signed in with an admin-set password; must choose their own before using the app. */
  mustChangePassword: boolean;
  /** Holds the Super Admin flag, but the authority stays off until two-step verification is on. */
  superAdminNeedsMfa: boolean;
  preferences: UserPreferences;
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    settings: OrganizationSettings;
  };
}

export interface ChannelSummary {
  id: string;
  type: 'PUBLIC' | 'PRIVATE' | 'DIRECT';
  name: string | null;
  description: string | null;
  topic: string | null;
  isDefault: boolean;
  myRole: 'ADMIN' | 'MEMBER';
  muted: boolean;
  memberCount: number;
  participants: Person[];
  unread: number;
  lastMessageAt: string | null;
  lastMessage: { body: string; authorName: string | null; authorId: string | null; createdAt: string } | null;
}

export interface ChannelDetails {
  id: string;
  type: 'PUBLIC' | 'PRIVATE' | 'DIRECT';
  name: string | null;
  description: string | null;
  topic: string | null;
  isDefault: boolean;
  isMember: boolean;
  myRole: 'ADMIN' | 'MEMBER' | null;
  canManage: boolean;
  createdAt: string;
  members: (Person & { role: 'ADMIN' | 'MEMBER' })[];
}

export interface ChatMessage {
  id: string;
  channelId: string;
  parentId: string | null;
  body: string;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  replyCount: number;
  author: Person | null;
  reactions: { emoji: string; userIds: string[]; count: number }[];
  clientId?: string;
  pending?: boolean;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  color: string;
  headId: string | null;
  head: { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null } | null;
  memberCount: number;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  rank: number;
  isSystem: boolean;
  memberCount: number;
  assignable: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AttendanceRecord {
  id: string;
  date: string;
  location: 'WFO' | 'WFH' | 'ON_DUTY';
  remarks: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  checkOutRemarks: string | null;
  late: boolean;
  state: 'working' | 'on_break' | 'checked_out';
  breaks: { id: string; startAt: string; endAt: string | null }[];
  breakMinutes: number;
  workedMinutes: number;
}
export interface AttendanceToday {
  date: string;
  isWorkingDay: boolean;
  policy: { workdayStart: string; workdayEnd: string; graceMinutes: number; timezone: string; allowedLocations: ('WFO' | 'WFH' | 'ON_DUTY')[]; breaksEnabled: boolean };
  record: AttendanceRecord | null;
}
export interface AttendanceHistory {
  from: string;
  to: string;
  timezone: string;
  items: AttendanceRecord[];
  summary: { daysPresent: number; late: number; office: number; home: number; clientSite: number; workedMinutes: number };
}
export interface AttendanceBoard {
  date: string;
  timezone: string;
  isToday: boolean;
  totals: { employees: number; checkedIn: number; office: number; home: number; clientSite: number; onBreak: number; checkedOut: number; notCheckedIn: number; late: number; onLeave: number };
  rows: { person: Person; record: AttendanceRecord | null; leave: { type: string; color: string; halfDay: boolean } | null }[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: 'COMPANY_NEWS' | 'IMPORTANT_UPDATE' | 'HOLIDAY' | 'NEW_FEATURE' | 'POLICY' | 'EVENT' | 'TEAM_UPDATE' | 'URGENT';
  priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  pinned: boolean;
  requireAck: boolean;
  publishedAt: string;
  expiresAt: string | null;
  departmentId: string | null;
  author: { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null; designation: string | null } | null;
  department: { id: string; name: string; color: string } | null;
  ackCount: number;
  acknowledgedAt: string | null;
  audience?: number;
}

export interface AppNotification {
  id: string;
  type: 'dm' | 'mention' | 'thread' | 'announcement' | 'leave' | 'correction';
  title: string;
  body: string | null;
  link: string | null;
  count: number;
  readAt: string | null;
  createdAt: string;
  actor: { id: string; firstName: string; lastName: string; displayName: string | null; avatarColor: string; avatarUrl: string | null } | null;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  color: string;
  annualAllowance: number;
  paid: boolean;
  active: boolean;
  description: string | null;
}
export interface LeaveBalance {
  type: LeaveType;
  allowance: number;
  used: number;
  pending: number;
  remaining: number | null;
}
export interface LeaveRequest {
  id: string;
  type: { id: string; name: string; code: string; color: string; paid: boolean };
  person: Person;
  startDate: string;
  endDate: string;
  halfDay: 'NONE' | 'FIRST_HALF' | 'SECOND_HALF';
  days: number;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approver: { id: string; firstName: string; lastName: string } | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}
export interface Holiday {
  id: string;
  name: string;
  date: string;
  type: 'MANDATORY' | 'OPTIONAL' | 'COMPANY' | 'SPECIAL_WORKING_DAY';
  description: string | null;
}
export interface Correction {
  id: string;
  date: string;
  checkIn: string;
  checkOut: string | null;
  location: 'WFO' | 'WFH' | 'ON_DUTY';
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  person?: Person;
  reviewer: { firstName: string; lastName: string } | null;
}
