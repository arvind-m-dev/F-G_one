'use client';
import { CircleAlert, Megaphone, Pin, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { Suspense, useEffect, useState } from 'react';
import { ANNOUNCEMENT_CATEGORIES } from '@fg/shared';
import { AnnouncementReader, categoryLabel, priorityLabel, priorityTone } from '@/components/announcements/announcement-reader';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { useAnnouncements } from '@/lib/hooks';
import type { Announcement } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, timeAgo } from '@/lib/utils';

function NeedsAck({ a }: { a: Announcement }) {
  if (!a.requireAck || a.acknowledgedAt) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
      <CircleAlert className="size-3" /> Please confirm
    </span>
  );
}

function Feed() {
  const [get, set] = useUrlState({ category: '', q: '', open: '' });
  const [q, setQ] = useState(get('q'));
  useEffect(() => {
    const t = setTimeout(() => set({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const list = useAnnouncements({ category: get('category') || undefined, q: get('q') || undefined });
  const items = list.data ?? [];
  const [lead, ...rest] = items;
  const pending = items.filter((a) => a.requireAck && !a.acknowledgedAt).length;

  return (
    <div className="mx-auto max-w-[900px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader className="px-0 pt-0 sm:px-0" title="Announcements" description="News and notices from across the company. Some ask you to confirm you've read them." />
      {pending > 0 && (
        <p className="mb-5 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-2.5 text-[13px]">
          <CircleAlert className="size-4 text-amber-600" /> {pending} announcement{pending === 1 ? '' : 's'} need{pending === 1 ? 's' : ''} your confirmation.
        </p>
      )}
      <div className="mb-3 relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search announcements" aria-label="Search announcements" className="h-9 w-full rounded-lg bg-surface-2 pr-3 pl-9 text-sm outline-none placeholder:text-subtle focus:ring-2 focus:ring-primary-soft" />
      </div>
      <div className="scrollbar-thin -mx-1 mb-8 flex gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Category">
        {[{ key: '', label: 'All' }, ...ANNOUNCEMENT_CATEGORIES].map((c) => (
          <button
            key={c.key || 'all'}
            role="radio"
            aria-checked={get('category') === c.key}
            onClick={() => set({ category: c.key })}
            className={cn('shrink-0 rounded-full border px-3 py-1 text-[13px] transition', get('category') === c.key ? 'border-foreground/20 bg-foreground text-canvas' : 'text-muted hover:border-border-strong hover:text-foreground')}
          >
            {c.label}
          </button>
        ))}
      </div>

      {list.isError ? (
        <EmptyState icon={<CircleAlert />} title="Announcements could not be loaded" description="Check your connection and try again." action={<Button variant="outline" onClick={() => void list.refetch()}>Try again</Button>} />
      ) : list.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : !lead ? (
        <EmptyState icon={<Megaphone />} title="Nothing here yet" description={get('q') || get('category') ? 'Try another search or category.' : 'New announcements will appear here.'} />
      ) : (
        <>
          <motion.button initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} onClick={() => set({ open: lead.id }, { push: true })} className="group relative mb-8 block w-full overflow-hidden rounded-2xl border bg-surface p-6 text-left transition hover:border-border-strong hover:shadow-md sm:p-8">
            <div className="bg-aurora pointer-events-none absolute inset-0 opacity-80" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-medium text-primary-ink">{categoryLabel(lead.category)}</span>
                {lead.pinned && (
                  <span className="flex items-center gap-1">
                    <Pin className="size-3" /> Pinned
                  </span>
                )}
                {lead.priority !== 'NORMAL' && <Badge tone={priorityTone[lead.priority]}>{priorityLabel[lead.priority]}</Badge>}
                <NeedsAck a={lead} />
              </div>
              <h2 className="mt-3 text-2xl leading-tight font-semibold tracking-tight break-words group-hover:text-primary-ink sm:text-[1.75rem]">{lead.title}</h2>
              <p className="mt-3 line-clamp-3 max-w-2xl text-[15px] leading-relaxed break-words text-muted">{lead.body}</p>
              <p className="mt-5 text-xs text-subtle">
                {lead.author ? `${lead.author.firstName} ${lead.author.lastName}` : 'Company'} · {lead.department?.name ?? 'Everyone'} · {timeAgo(lead.publishedAt)}
              </p>
            </div>
          </motion.button>
          <ul className="divide-y border-y">
            {rest.map((a, i) => (
              <motion.li key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
                <button onClick={() => set({ open: a.id }, { push: true })} className="group grid w-full gap-1 py-5 text-left sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                  <span className="text-xs text-muted">
                    <span className="block font-medium text-foreground/80">{categoryLabel(a.category)}</span>
                    {new Date(a.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 text-[15px] font-semibold break-words group-hover:text-primary-ink">{a.title}</span>
                      {a.priority !== 'NORMAL' && <Badge tone={priorityTone[a.priority]}>{priorityLabel[a.priority]}</Badge>}
                      <NeedsAck a={a} />
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm break-words text-muted">{a.body}</span>
                    <span className="mt-1.5 block text-xs text-subtle">
                      {a.author ? `${a.author.firstName} ${a.author.lastName}` : 'Company'} · {a.department?.name ?? 'Everyone'}
                    </span>
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        </>
      )}
      <AnnouncementReader id={get('open') || null} onClose={() => set({ open: null })} />
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <Suspense>
      <Feed />
    </Suspense>
  );
}
