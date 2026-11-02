'use client';
import { LayoutGrid, Rows3, Search, Users } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessageButton } from '@/components/message-button';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { StatusLine, UserAvatar } from '@/components/user-avatar';
import { useDepartments, useEmployeeList } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export default function DirectoryPage() {
  const me = useSession();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [dept, setDept] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const depts = useDepartments();
  const list = useEmployeeList({ q: debounced || undefined, departmentId: dept || undefined, page, pageSize: 30 });
  const pages = list.data ? Math.ceil(list.data.total / list.data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader className="px-0 pt-0 sm:px-0" title="Directory" description={list.data ? `${list.data.total} people at ${me.organization.name}` : 'Everyone at your company'} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or designation"
            aria-label="Search people"
            className="h-9 w-full rounded-lg bg-surface-2 pr-3 pl-9 text-sm outline-none placeholder:text-subtle focus:ring-2 focus:ring-primary-soft"
          />
        </div>
        <div className="inline-flex shrink-0 rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Layout">
          {([
            ['list', Rows3],
            ['grid', LayoutGrid],
          ] as const).map(([v, Icon]) => (
            <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cn('grid size-8 place-items-center rounded-md transition', view === v ? 'bg-canvas text-foreground shadow-sm' : 'text-muted')} aria-label={`${v} view`}>
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin mb-6 flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Filter by department">
        {[{ id: '', name: 'Everyone', color: 'var(--muted)', memberCount: undefined as number | undefined }, ...(depts.data ?? [])].map((d) => (
          <button
            key={d.id || 'all'}
            role="radio"
            aria-checked={dept === d.id}
            onClick={() => {
              setDept(d.id);
              setPage(1);
            }}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition', dept === d.id ? 'border-foreground/20 bg-foreground text-canvas' : 'text-muted hover:border-border-strong hover:text-foreground')}
          >
            {d.id && <span className="size-1.5 rounded-full" style={{ background: d.color }} />}
            {d.name}
            {d.memberCount !== undefined && <span className="tabular-nums opacity-60">{d.memberCount}</span>}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : list.data?.items.length === 0 ? (
        <EmptyState icon={<Users />} title="No one found" description="Try another name or department." />
      ) : view === 'list' ? (
        <div className="overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_88px] gap-4 border-b bg-surface-2/50 px-4 py-2 text-[11px] font-medium text-muted lg:grid">
            <span>Name</span>
            <span>Department</span>
            <span>Email</span>
            <span>Reports to</span>
            <span />
          </div>
          <ul className="divide-y">
            {list.data?.items.map((p) => (
              <li key={p.id} className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 transition hover:bg-surface-2/50 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_88px]">
                <Link href={`/app/people/${p.id}`} className="flex min-w-0 items-center gap-3 after:absolute after:inset-0">
                  <UserAvatar person={p} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{p.designation ?? '—'}</span>
                  </span>
                </Link>
                <span className="hidden min-w-0 lg:block">
                  {p.department ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px]">
                      <span className="size-1.5 rounded-full" style={{ background: p.department.color }} />
                      <span className="truncate">{p.department.name}</span>
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                  <StatusLine person={p} className="mt-0.5 flex" />
                </span>
                <span className="hidden truncate text-[13px] text-muted lg:block">{p.email}</span>
                <span className="hidden truncate text-[13px] text-muted lg:block">{p.manager ? `${p.manager.firstName} ${p.manager.lastName}` : '—'}</span>
                <span className="relative z-10 flex justify-end">
                  {p.id !== me.user.id && <MessageButton userId={p.id} size="sm" variant="ghost" label="Message" className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100" />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.data?.items.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}>
              <Link href={`/app/people/${p.id}`} className="group block h-full rounded-xl border bg-surface p-4 transition hover:border-border-strong hover:shadow-md">
                <div className="flex items-start justify-between">
                  <UserAvatar person={p} size="lg" />
                  {p.department && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                      <span className="size-1.5 rounded-full" style={{ background: p.department.color }} />
                      {p.department.name}
                    </span>
                  )}
                </div>
                <p className="mt-3 truncate text-sm font-semibold">{p.name}</p>
                <p className="truncate text-[13px] text-muted">{p.designation ?? '—'}</p>
                <StatusLine person={p} className="mt-3 flex" />
              </Link>
            </motion.div>
          ))}
        </div>
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
