'use client';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { AuditList, type AuditEntry } from '@/components/admin/audit-list';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import type { Paged } from '@/lib/types';

export default function AuditPage() {
  const can = useCan();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(q); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [q]);
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
      <PageHeader title="Audit log" description="Tamper-evident trail of sign-ins, account changes and administrative actions." />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action, e.g. employee.deactivated" className="pl-9" aria-label="Filter audit log" />
          </div>
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="sm:w-48" aria-label="Entity type">
            <option value="">All entities</option>
            {['user', 'department', 'organization', 'channel', 'message'].map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </Select>
        </div>
        {list.isLoading ? <Skeleton className="m-4 h-64" /> : list.data?.items.length ? <AuditList items={list.data.items} /> : <EmptyState icon={<ScrollText />} title="No matching events" />}
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
