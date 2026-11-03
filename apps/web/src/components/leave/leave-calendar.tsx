'use client';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton, Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api } from '@/lib/api';
import type { LeaveRequest } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

interface Calendar {
  month: string;
  workingDays: number[];
  leaves: LeaveRequest[];
  holidays: { id: string; name: string; date: string; type: string }[];
}

const shiftMonth = (m: string, n: number) => {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y!, mm! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month grid of who is away. Colleagues see dates only; reasons stay private. */
export function LeaveCalendar() {
  const [get, set] = useUrlState({ month: '' });
  const q = useQuery({ queryKey: ['leave-calendar', get('month')], queryFn: () => api<Calendar>('/leave/calendar', { query: { month: get('month') || undefined } }), placeholderData: (p) => p });
  const cal = q.data;
  if (!cal) return <Skeleton className="h-96" />;
  const [y, m] = cal.month.split('-').map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const daysIn = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${cal.month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const todayStr = new Date().toLocaleDateString('en-CA');
  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => set({ month: shiftMonth(cal.month, -1) })}>
          <ChevronLeft />
        </Button>
        <p className="min-w-40 text-center text-sm font-semibold">{label}</p>
        <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => set({ month: shiftMonth(cal.month, 1) })}>
          <ChevronRight />
        </Button>
        {get('month') && (
          <Button variant="ghost" size="sm" onClick={() => set({ month: null })}>
            This month
          </Button>
        )}
        <span className="ml-auto text-xs text-muted">{cal.leaves.length} leave{cal.leaves.length === 1 ? '' : 's'} this month</span>
      </div>

      {/* Desktop/tablet: month grid */}
      <div className="hidden overflow-hidden rounded-xl border sm:block">
        <div className="grid grid-cols-7 border-b bg-surface-2/50 text-center text-[11px] font-medium text-muted">
          {WEEK.map((d) => (
            <span key={d} className="py-2">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="min-h-24 border-r border-b bg-surface-2/30 last:border-r-0 [&:nth-child(7n)]:border-r-0" />;
            const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
            const off = !cal.workingDays.includes(wd);
            const hol = cal.holidays.filter((h) => h.date === d);
            const away = cal.leaves.filter((l) => l.startDate <= d && l.endDate >= d);
            return (
              <div key={d} className={cn('min-h-24 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0', off && 'bg-surface-2/40')}>
                <p className={cn('mb-1 text-xs tabular-nums', d === todayStr ? 'inline-grid size-5 place-items-center rounded-full bg-primary font-semibold text-white' : 'text-muted')}>{Number(d.slice(8))}</p>
                {hol.map((h) => (
                  <p key={h.id} className={cn('mb-0.5 truncate rounded px-1 text-[10px] font-medium', h.type === 'SPECIAL_WORKING_DAY' ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300' : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300')} title={h.name}>
                    {h.name}
                  </p>
                ))}
                <div className="flex flex-wrap gap-0.5">
                  {away.slice(0, 4).map((l) => (
                    <Tooltip key={l.id} side="top" content={`${l.person.name} · ${l.type.name}${l.status === 'PENDING' ? ' (pending)' : ''}`}>
                      <span className={cn('rounded-full', l.status === 'PENDING' && 'opacity-50')}>
                        <UserAvatar person={l.person} size="xs" showPresence={false} />
                      </span>
                    </Tooltip>
                  ))}
                  {away.length > 4 && <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-[10px] font-medium">+{away.length - 4}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: agenda list */}
      <ul className="divide-y rounded-xl border sm:hidden">
        {cal.leaves.length === 0 && cal.holidays.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No one is away this month.</li>}
        {cal.holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
            <span className="font-medium">{h.name}</span>
            <span className="text-muted">{new Date(`${h.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
          </li>
        ))}
        {cal.leaves.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
            <UserAvatar person={l.person} size="sm" showPresence={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{l.person.name}</span>
              <span className="text-xs text-muted">
                {l.type.name} · {l.startDate === l.endDate ? l.startDate.slice(5) : `${l.startDate.slice(5)} → ${l.endDate.slice(5)}`}
                {l.status === 'PENDING' && ' · pending'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-subtle">Faded faces are requests still waiting for approval (visible to HR only).</p>
    </div>
  );
}
