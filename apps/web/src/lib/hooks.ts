'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ChannelSummary, Department, Employee, Paged, Role } from './types';

export const useChannels = (enabled = true) => useQuery({ queryKey: ['channels'], queryFn: () => api<ChannelSummary[]>('/channels'), enabled });
export const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api<{ roles: Role[]; permissionLabels: Record<string, string> }>('/roles') });
export const useEmployeeList = (q: { q?: string; departmentId?: string; status?: string; page?: number; pageSize?: number }, enabled = true) =>
  useQuery({ queryKey: ['employees', q], queryFn: () => api<Paged<Employee>>('/employees', { query: q }), placeholderData: (prev) => prev, enabled });

/** Display name for a channel row (DMs use participant names). */
export function channelLabel(c: Pick<ChannelSummary, 'type' | 'name' | 'participants'>) {
  if (c.type !== 'DIRECT') return c.name ?? 'channel';
  if (!c.participants.length) return 'Just you';
  return c.participants.map((p) => (c.participants.length > 1 ? p.firstName : p.name)).join(', ');
}

/* ───── attendance / announcements / notifications ───── */
import type { Announcement, AppNotification, AttendanceToday } from './types';

export const useAttendanceToday = (enabled = true) => useQuery({ queryKey: ['attendance-today'], queryFn: () => api<AttendanceToday>('/attendance/today'), refetchInterval: 60_000, enabled });
export const useAnnouncements = (q: { category?: string; q?: string; include?: string } = {}) =>
  useQuery({ queryKey: ['announcements', q], queryFn: () => api<Announcement[]>('/announcements', { query: q }), placeholderData: (p) => p });
export const useNotifications = (filter: 'all' | 'unread' | 'mentions', enabled = true) =>
  useQuery({ queryKey: ['notifications', filter], queryFn: () => api<{ items: AppNotification[]; unread: number }>('/notifications', { query: { filter } }), enabled });
export const useUnreadNotifications = () => useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api<{ unread: number }>('/notifications/unread-count'), refetchInterval: 120_000 });

export const fmtDuration = (min: number) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`);

/* ───── leave / holidays / approvals ───── */
import type { Correction, Holiday, LeaveBalance, LeaveRequest, LeaveType } from './types';

export const useLeaveTypes = (all = false) => useQuery({ queryKey: ['leave-types', all], queryFn: () => api<LeaveType[]>('/leave/types', { query: { include: all ? 'all' : 'active' } }) });
/** Your balances, or someone else's (HR, managers) when `userId` is given. */
export const useLeaveBalances = (userId?: string, enabled = true) =>
  useQuery({ queryKey: ['leave-balances', userId ?? 'me'], queryFn: () => api<{ year: { start: string; end: string }; items: LeaveBalance[] }>('/leave/balances', { query: userId ? { userId } : {} }), enabled });
export const useLeaveRequests = (scope: 'mine' | 'approvals' | 'all', status = 'ALL', enabled = true) =>
  useQuery({ queryKey: ['leave-requests', scope, status], queryFn: () => api<LeaveRequest[]>('/leave/requests', { query: { scope, status } }), enabled, placeholderData: (p) => p });
export const useHolidays = (year: number) => useQuery({ queryKey: ['holidays', year], queryFn: () => api<{ year: number; items: Holiday[] }>('/holidays', { query: { year } }), placeholderData: (p) => p });
export const useApprovalsCount = () => useQuery({ queryKey: ['approvals-count'], queryFn: () => api<{ canApprove: boolean; leave: number; corrections: number; total: number }>('/approvals/count'), refetchInterval: 120_000 });
export const useCorrections = (scope: 'mine' | 'approvals', enabled = true) => useQuery({ queryKey: ['corrections', scope], queryFn: () => api<Correction[]>('/attendance/corrections', { query: { scope } }), enabled });

export const fmtDays = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;
export function fmtRange(start: string, end: string) {
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (start === end) return s.toLocaleDateString(undefined, { weekday: 'short', ...o });
  return `${s.toLocaleDateString(undefined, o)} – ${e.toLocaleDateString(undefined, { ...o, year: s.getFullYear() !== e.getFullYear() ? 'numeric' : undefined })}`;
}
