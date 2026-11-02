'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ChannelSummary, Department, Employee, Paged, Role } from './types';

export const useChannels = (enabled = true) => useQuery({ queryKey: ['channels'], queryFn: () => api<ChannelSummary[]>('/channels'), enabled });
export const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });
export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api<{ roles: Role[]; permissionLabels: Record<string, string> }>('/roles') });
export const useEmployeeList = (q: { q?: string; departmentId?: string; status?: string; page?: number; pageSize?: number }) =>
  useQuery({ queryKey: ['employees', q], queryFn: () => api<Paged<Employee>>('/employees', { query: q }), placeholderData: (prev) => prev });

/** Display name for a channel row (DMs use participant names). */
export function channelLabel(c: Pick<ChannelSummary, 'type' | 'name' | 'participants'>) {
  if (c.type !== 'DIRECT') return c.name ?? 'channel';
  if (!c.participants.length) return 'Just you';
  return c.participants.map((p) => (c.participants.length > 1 ? p.firstName : p.name)).join(', ');
}
