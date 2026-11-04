'use client';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { AuditList, type AuditEntry } from '@/components/admin/audit-list';
import { Forbidden, LoadError, PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import type { Paged } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';

/** Kinds of records the log is about, in plain words. */
const ENTITIES: [string, string][] = [
  ['user', 'People and sign-ins'],
  ['session', 'Signed-in devices'],
  ['department', 'Departments'],
  ['organization', 'Company settings'],
  ['announcement', 'Announcements'],
  ['holiday', 'Holidays'],
  ['leave_request', 'Leave requests'],
  ['leave_type', 'Leave types'],
  ['attendance', 'Attendance exports'],
  ['attendance_correction', 'Attendance corrections'],
  ['channel', 'Channels'],
  ['message', 'Messages'],
];

function AuditPage() {
  const can = useCan();
  // Filters live in the URL so a view can be refreshed or shared.
  const [get, set] = useUrlState({ q: '', entity: '', page: '1' });
  const debounced = get('q');
  const entity = get('entity');
  const page = Math.max(1, Number(get('page')) || 1);
  const setPage = (fn: (p: number) => number) => set({ page: String(fn(page)) });
  const [q, setQ] = useState(debounced);
  useEffect(() => {
    if (q === debounced) return;
    const t = setTimeout(() => set({ q, page: null }), 250);
    return () => clearTimeout(t);
  }, [q, debounced, set]);
  const list = useQuery({
    queryKey: ['audit', debounced, entity, page],
    queryFn: () => api<Paged<AuditEntry>>('/audit-logs', { query: { q: debounced, entityType: entity, page, pageSize: 30 } }),
    enabled: can(PERMISSIONS.AUDIT_READ),
    placeholderData: (p) => p,
  });
  if (!can(PERMISSIONS.AUDIT_READ)) return <Forbidden />;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader title="Audit log" description="A record of sign-ins, account changes and administrative actions." />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions, for example login or deactivated" className="pl-9" aria-label="Filter audit log" />
          </div>
          <Select value={entity} onChange={(e) => set({ entity: e.target.value, page: null })} className="sm:w-56" aria-label="What it is about">
            <option value="">Everything</option>
            {ENTITIES.map(([x, label]) => (
              <option key={x} value={x}>{label}</option>
            ))}
          </Select>
        </div>
        {list.isPending ? (
          <Skeleton className="m-4 h-64" />
        ) : list.isError ? (
          <div className="p-4">
            <LoadError what="the audit log" error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : list.data.items.length ? (
          <AuditList items={list.data.items} />
        ) : (
          <EmptyState icon={<ScrollText />} title="No matching events" description={debounced || entity ? 'Try another search or clear the filter.' : 'Sign-ins and admin actions will appear here.'} />
        )}
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted">
          <span>{list.data?.total ?? 0} events</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span>{page} / {pages}</span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}
