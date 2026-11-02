'use client';
import { LayoutGrid, List, Search, Users } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessageButton } from '@/components/message-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { StatusLine, UserAvatar } from '@/components/user-avatar';
import { useDepartments, useEmployeeList } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export default function PeoplePage() {
  const me = useSession();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dept, setDept] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const depts = useDepartments();
  const list = useEmployeeList({ q: debounced || undefined, departmentId: dept || undefined, page, pageSize: 24 });
  const pages = list.data ? Math.ceil(list.data.total / list.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="font-display text-xl font-bold">People</h2>
        <p className="text-sm text-muted">{list.data ? `${list.data.total} colleagues at ${me.organization.name}` : 'Directory'}</p>
      </div>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or designation" className="pl-9" aria-label="Search people" />
        </div>
        <Select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} className="sm:w-56" aria-label="Filter by department">
          <option value="">All departments</option>
          {depts.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.memberCount})
            </option>
          ))}
        </Select>
        <div className="flex rounded-lg border bg-surface p-0.5">
          {(['grid', 'list'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn('grid size-9 place-items-center rounded-md transition', view === v ? 'bg-primary-soft text-primary' : 'text-muted')} aria-label={`${v} view`} aria-pressed={view === v}>
              {v === 'grid' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : list.data?.items.length === 0 ? (
        <EmptyState icon={<Users />} title="No one found" description="Try another name or department." />
      ) : view === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.data?.items.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.025 }}>
              <Link href={`/people/${p.id}`}>
                <Card className="group relative h-full overflow-hidden p-5 text-center transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                  <div className="absolute inset-x-0 top-0 h-14 opacity-80" style={{ background: `linear-gradient(135deg, ${p.department?.color ?? '#6366f1'}33, transparent)` }} />
                  <UserAvatar person={p} size="lg" className="relative mx-auto" />
                  <p className="mt-3 truncate font-semibold">{p.name}</p>
                  <p className="truncate text-sm text-muted">{p.designation ?? '—'}</p>
                  {p.department && (
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${p.department.color}1f`, color: p.department.color }}>
                      <span className="size-1.5 rounded-full" style={{ background: p.department.color }} /> {p.department.name}
                    </span>
                  )}
                  <div className="mt-3 flex justify-center">
                    <StatusLine person={p} />
                  </div>
                  {p.id !== me.user.id && (
                    <div className="mt-3 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                      <MessageButton userId={p.id} size="sm" variant="secondary" className="w-full" />
                    </div>
                  )}
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <Card className="divide-y overflow-hidden">
          {list.data?.items.map((p) => (
            <Link key={p.id} href={`/people/${p.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-surface-2/60">
              <UserAvatar person={p} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="truncate text-sm text-muted">{[p.designation, p.department?.name].filter(Boolean).join(' · ')}</p>
              </div>
              <StatusLine person={p} className="hidden w-48 md:inline-flex" />
              <span className="hidden w-64 truncate text-sm text-muted lg:block">{p.email}</span>
              {p.id !== me.user.id && <MessageButton userId={p.id} size="sm" variant="ghost" label="" aria-label={`Message ${p.name}`} />}
            </Link>
          ))}
        </Card>
      )}

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
