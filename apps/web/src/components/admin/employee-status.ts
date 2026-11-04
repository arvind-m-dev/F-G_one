import type { Employee } from '@/lib/types';

/** Plain-language account status labels shared by the employees list and the employee page. */
export const STATUS_LABEL: Record<Employee['status'], string> = {
  ACTIVE: 'Active',
  INVITED: 'Waiting for password',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
  ARCHIVED: 'Archived',
};

export const STATUS_TONE = { ACTIVE: 'success', INVITED: 'warning', SUSPENDED: 'danger', DEACTIVATED: 'muted', ARCHIVED: 'muted' } as const satisfies Record<Employee['status'], string>;
