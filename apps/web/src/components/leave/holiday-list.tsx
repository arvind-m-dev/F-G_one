'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HOLIDAY_TYPES } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { useHolidays } from '@/lib/hooks';
import type { Holiday } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, parseDateOnly } from '@/lib/utils';

export const holidayLabel = (t: string) => HOLIDAY_TYPES.find((x) => x.key === t)?.label ?? t;
export const holidayTone = { MANDATORY: 'success', COMPANY: 'brand', OPTIONAL: 'muted', SPECIAL_WORKING_DAY: 'warning' } as const;

/** Year view of holidays grouped by month; `actions` renders per-row admin controls. */
export function HolidayList({ actions }: { actions?: (h: Holiday) => React.ReactNode }) {
  const [get, set] = useUrlState({ year: String(new Date().getFullYear()) });
  const year = Number(get('year'));
  const q = useHolidays(year);
  const today = new Date().toLocaleDateString('en-CA');
  const byMonth = new Map<number, Holiday[]>();
  for (const h of q.data?.items ?? []) {
    const m = Number(h.date.slice(5, 7));
    byMonth.set(m, [...(byMonth.get(m) ?? []), h]);
  }
  const next = q.data?.items.find((h) => h.date >= today && h.type !== 'SPECIAL_WORKING_DAY');

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous year" onClick={() => set({ year: String(year - 1) })}>
          <ChevronLeft />
        </Button>
        <span className="w-14 text-center text-sm font-semibold tabular-nums">{year}</span>
        <Button variant="outline" size="icon-sm" aria-label="Next year" onClick={() => set({ year: String(year + 1) })}>
          <ChevronRight />
        </Button>
        <span className="ml-2 flex flex-wrap gap-1.5">
          {HOLIDAY_TYPES.map((t) => (
            <Badge key={t.key} tone={holidayTone[t.key]} title={t.description}>
              {t.label}
            </Badge>
          ))}
        </span>
      </div>
      {next && (
        <div className="bg-aurora mb-8 rounded-2xl border p-5">
          <p className="text-xs text-muted">Next holiday</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{next.name}</p>
          <p className="text-sm text-muted">
            {parseDateOnly(next.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {Math.round((parseDateOnly(next.date).getTime() - parseDateOnly(today).getTime()) / 86400_000) || 'today'}
            {next.date !== today ? ' days to go' : ''}
          </p>
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : !q.data?.items.length ? (
        <EmptyState title={`No holidays added for ${year}`} description="HR adds the company holiday calendar here." />
      ) : (
        <div className="space-y-8">
          {[...byMonth.entries()].map(([m, items]) => (
            <section key={m}>
              <h3 className="mb-2 text-[13px] font-semibold text-muted">{new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' })}</h3>
              <ul className="divide-y rounded-xl border">
                {items.map((h) => {
                  const d = parseDateOnly(h.date);
                  return (
                    <li key={h.id} className={cn('flex items-center gap-4 px-4 py-3', h.date < today && 'opacity-60')}>
                      <span className="w-11 shrink-0 text-center">
                        <span className="block text-[10px] font-medium text-subtle uppercase">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                        <span className="block text-lg leading-tight font-semibold tabular-nums">{d.getDate()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{h.name}</span>
                        {h.description && <span className="block truncate text-xs text-muted">{h.description}</span>}
                      </span>
                      <Badge tone={holidayTone[h.type]}>{holidayLabel(h.type)}</Badge>
                      {actions?.(h)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
