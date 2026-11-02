import { Prisma } from '@prisma/client';
import { fmtDateOnly } from '../common/dates';

/** Columns safe to expose. passwordHash, lockout counters etc. are never selected. */
export const employeeSelect = {
  id: true,
  email: true,
  status: true,
  firstName: true,
  lastName: true,
  displayName: true,
  designation: true,
  employeeCode: true,
  phone: true,
  pronouns: true,
  bio: true,
  avatarUrl: true,
  avatarColor: true,
  timezone: true,
  joinedAt: true,
  birthday: true,
  showBirthday: true,
  presence: true,
  statusEmoji: true,
  statusText: true,
  statusExpiresAt: true,
  lastSeenAt: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, key: true, name: true, rank: true } },
  department: { select: { id: true, name: true, color: true } },
  manager: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, avatarColor: true } },
} satisfies Prisma.UserSelect;

export type EmployeeRow = Prisma.UserGetPayload<{ select: typeof employeeSelect }>;

/** Presence with automatic expiry applied at read time (no cron needed). */
export function effectivePresence(u: { presence: string; statusEmoji: string | null; statusText: string | null; statusExpiresAt: Date | null }) {
  if (u.statusExpiresAt && u.statusExpiresAt.getTime() <= Date.now()) {
    return { presence: 'available', statusEmoji: null, statusText: null, statusExpiresAt: null };
  }
  return { presence: u.presence, statusEmoji: u.statusEmoji, statusText: u.statusText, statusExpiresAt: u.statusExpiresAt };
}

export function toEmployee(u: EmployeeRow, opts: { privileged: boolean; online?: boolean }) {
  const { birthday, showBirthday, lastLoginAt, phone, employeeCode, ...rest } = u;
  const canSeeBirthday = opts.privileged || showBirthday;
  return {
    ...rest,
    ...effectivePresence(u),
    name: u.displayName || `${u.firstName} ${u.lastName}`,
    joinedAt: fmtDateOnly(u.joinedAt),
    // Year is private; colleagues only see month-day.
    birthday: canSeeBirthday && birthday ? (opts.privileged ? fmtDateOnly(birthday) : fmtDateOnly(birthday)!.slice(5)) : null,
    showBirthday: opts.privileged ? showBirthday : undefined,
    phone, // work phone is part of the internal directory
    employeeCode: opts.privileged ? employeeCode : undefined,
    lastLoginAt: opts.privileged ? lastLoginAt : undefined,
    online: opts.online ?? false,
  };
}

/** Compact person shape used in chat, dashboard lists, etc. */
export const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  designation: true,
  avatarUrl: true,
  avatarColor: true,
  presence: true,
  statusEmoji: true,
  statusText: true,
  statusExpiresAt: true,
  department: { select: { id: true, name: true, color: true } },
} satisfies Prisma.UserSelect;

export type PersonRow = Prisma.UserGetPayload<{ select: typeof personSelect }>;

export function toPerson(u: PersonRow, online = false) {
  return {
    id: u.id,
    name: u.displayName || `${u.firstName} ${u.lastName}`,
    firstName: u.firstName,
    lastName: u.lastName,
    designation: u.designation,
    avatarUrl: u.avatarUrl,
    avatarColor: u.avatarColor,
    department: u.department,
    ...effectivePresence(u),
    online,
  };
}
