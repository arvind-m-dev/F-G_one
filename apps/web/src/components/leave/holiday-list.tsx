'use client';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { HOLIDAY_TYPES } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Skeleton, Tooltip } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { useHolidays } from '@/lib/hooks';
import { useOrgToday } from '@/lib/session';
import type { Holiday } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, parseDateOnly, relDays } from '@/lib/utils';

export const holidayLabel = (t: string) => HOLIDAY_TYPES.find((x) => x.key === t)?.label ?? t;
export const holidayTone = { MANDATORY: 'success', COMPANY: 'brand', OPTIONAL: 'muted', SPECIAL_WORKING_DAY: 'warning' } as const;

/** Year view of holidays grouped by month; `actions` renders per-row admin controls. */
export function HolidayList({ actions }: { actions?: (h: Holiday) => React.ReactNode }) {
  const today = useOrgToday().today();
  const [get, set] = useUrlState({ year: today.slice(0, 4) });
  // A year that isn't a number (an edited link) falls back to this year.
  const year = /^\d{4}$/.test(get('year')) ? Number(get('year')) : Number(today.slice(0, 4));
  const q = useHolidays(year);
  const byMonth = new Map<number, Holiday[]>();
  for (const h of q.data?.items ?? []) {
    const m = Number(h.date.slice(5, 7));
    byMonth.set(m, [...(byMonth.get(m) ?? []), h]);
  }
  // "Next holiday" only makes sense while looking at the current year.
  const next = year === Number(today.slice(0, 4)) ? q.data?.items.find((h) => h.date >= today && h.type !== 'SPECIAL_WORKING_DAY') : undefined;

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
            <Tooltip key={t.key} content={t.description} side="bottom">
              <Badge tone={holidayTone[t.key]} tabIndex={0} className="cursor-help">
                {t.label}
              </Badge>
            </Tooltip>
          ))}
        </span>
      </div>
      {next && (
        <div className="bg-aurora mb-8 rounded-2xl border p-5">
          <p className="text-xs text-muted">Next holiday</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{next.name}</p>
          <p className="text-sm text-muted">
            {parseDateOnly(next.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {relDays(Math.round((parseDateOnly(next.date).getTime() - parseDateOnly(today).getTime()) / 86400_000))}
          </p>
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <EmptyState icon={<CalendarDays />} title="Holidays couldn't be loaded" description={errorMessage(q.error)} action={<Button variant="outline" onClick={() => void q.refetch()}>Try again</Button>} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<CalendarDays />} title={`No holidays added for ${year} yet`} description="They appear here once HR publishes the holiday calendar for that year." />
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
