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
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
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
  role: { key: string; rank: number };
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
