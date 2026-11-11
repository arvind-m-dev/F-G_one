'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { LeaveStatusBadge } from '@/components/leave/request-leave-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Skeleton, Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useOrgToday } from '@/lib/session';
import type { LeaveRequest } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, plural } from '@/lib/utils';

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
const MAX_LANES = 4;

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const rangeLabel = (l: LeaveRequest) => (l.startDate === l.endDate ? fmtDay(l.startDate) : `${fmtDay(l.startDate)} – ${fmtDay(l.endDate)}`);

type Breakdown = { days: number; calendarDays: number; workingDays: number; weekends: number; holidays: { date: string; name: string }[]; sandwichDays: number };

/** One leave in full: dates, status, and how its days add up (total, leave days, days off, holidays). */
export function LeaveDetails({ leave, onClose }: { leave?: LeaveRequest; onClose: () => void }) {
  const b = useQuery({
    queryKey: ['leave-breakdown', leave?.id],
    queryFn: () => api<Breakdown>('/leave/preview', { body: { typeId: leave!.type.id, startDate: leave!.startDate, endDate: leave!.endDate, halfDay: leave!.halfDay } }),
    enabled: !!leave,
  });
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('text-right tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  );
  return (
    <Dialog open={!!leave} onOpenChange={(o) => !o && onClose()} title="Leave details" description={leave ? rangeLabel(leave) : undefined}>
      {leave && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <UserAvatar person={leave.person} size="md" showPresence={false} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{leave.person.name}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span className="size-2 rounded-full" style={{ backgroundColor: leave.type.color }} />
                {leave.type.name}
                {leave.halfDay !== 'NONE' && ` · ${leave.halfDay === 'FIRST_HALF' ? 'morning' : 'afternoon'} only`}
              </p>
            </div>
            <LeaveStatusBadge status={leave.status} />
          </div>
          {b.isPending ? (
            <Skeleton className="h-36" />
          ) : b.isError ? (
            <p className="text-sm text-danger" role="alert">
              The day-by-day breakdown couldn&apos;t be loaded.{' '}
              <button type="button" onClick={() => void b.refetch()} className="font-medium text-primary hover:underline">
                Try again
              </button>
            </p>
          ) : (
            <dl className="divide-y rounded-xl border text-[13px]">
              {row('Days in total', b.data.calendarDays)}
              {row('Leave days used', leave.days, true)}
              {row('Weekly days off', b.data.weekends || 'None')}
              {row('Holidays', b.data.holidays.length ? b.data.holidays.map((h) => `${h.name} (${fmtDay(h.date)})`).join(', ') : 'None')}
              {leave.days > b.data.workingDays && row('Days off counted as leave', `${leave.days - b.data.workingDays} (company rule)`)}
            </dl>
          )}
          {leave.reason && (
            <p className="text-[13px]">
              <span className="text-muted">Reason: </span>
              {leave.reason}
            </p>
          )}
          {leave.approver && leave.status !== 'PENDING' && (
            <p className="text-xs text-muted">
              {leave.status === 'APPROVED' ? 'Approved' : leave.status === 'REJECTED' ? 'Declined' : 'Decided'} by {leave.approver.firstName} {leave.approver.lastName}
              {leave.decisionNote ? ` · ${leave.decisionNote}` : ''}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Everyone away on one day: opened from "+N more" when a day has more leaves than the grid can show. */
function DayAway({ day, leaves, onPick, onClose }: { day: string; leaves: LeaveRequest[]; onPick: (id: string) => void; onClose: () => void }) {
  const away = day ? leaves.filter((l) => l.startDate <= day && l.endDate >= day) : [];
  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()} title={day ? `Away on ${fmtDay(day)}` : 'Away'} description={day ? plural(away.length, 'person', 'people') : undefined} className="max-w-md">
      {away.length === 0 ? (
        <p className="text-sm text-muted">No one is away that day.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {away.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => onPick(l.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-2">
                <UserAvatar person={l.person} size="sm" showPresence={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{l.person.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.type.color }} aria-hidden />
                    <span className="truncate">
                      {l.type.name} · {rangeLabel(l)}
                    </span>
                  </span>
                </span>
                {l.status === 'PENDING' && <LeaveStatusBadge status={l.status} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** A 3px line, rounded where the leave starts and ends (square where it continues into another week). */
function LeaveLine({ color, starts, ends, dashed }: { color: string; starts: boolean; ends: boolean; dashed?: boolean }) {
  return <span className={cn('h-[3px]', starts && 'rounded-l-full', ends && 'rounded-r-full')} style={dashed ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 10px)` } : { backgroundColor: color }} aria-hidden />;
}

/** Places each leave overlapping this week as a bar in the first free lane; counts per-day overflow beyond MAX_LANES. */
function layoutWeek(week: (string | null)[], leaves: LeaveRequest[]) {
  const days = week.map((d, i) => ({ d, i })).filter((x): x is { d: string; i: number } => !!x.d);
  if (!days.length) return { bars: [], hidden: week.map(() => 0) };
  const first = days[0]!.d;
  const last = days[days.length - 1]!.d;
  const segs = leaves
    .filter((l) => l.startDate <= last && l.endDate >= first)
    .map((l) => {
      const cols = days.filter((x) => x.d >= l.startDate && x.d <= l.endDate);
      return { l, from: cols[0]!.i, to: cols[cols.length - 1]!.i, starts: l.startDate >= first, ends: l.endDate <= last };
    })
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const laneEnds: number[] = [];
  const bars: ((typeof segs)[number] & { lane: number })[] = [];
  const hidden = week.map(() => 0);
  for (const s of segs) {
    let lane = laneEnds.findIndex((end) => end < s.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = s.to;
    if (lane < MAX_LANES) bars.push({ ...s, lane });
    else for (let c = s.from; c <= s.to; c++) hidden[c]!++;
  }
  return { bars, hidden };
}

/** Month grid of who is away. Colleagues see dates only; reasons stay private. */
export function LeaveCalendar() {
  const [get, set] = useUrlState({ month: '', leave: '', day: '' });
  const todayStr = useOrgToday().today();
  // An edited link with a month that doesn't exist shows this month instead of an error.
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(get('month')) ? get('month') : '';
  const q = useQuery({ queryKey: ['leave-calendar', month], queryFn: () => api<Calendar>('/leave/calendar', { query: { month: month || undefined } }), placeholderData: (p) => p });
  const cal = q.data;
  if (q.isError && !cal)
    return <EmptyState icon={<CalendarDays />} title="The calendar couldn't be loaded" description={errorMessage(q.error)} action={<Button variant="outline" onClick={() => void q.refetch()}>Try again</Button>} />;
  if (!cal) return <Skeleton className="h-96" />;
  const [y, m] = cal.month.split('-').map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const daysIn = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${cal.month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
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
        {month && (
          <Button variant="ghost" size="sm" onClick={() => set({ month: null })}>
            This month
          </Button>
        )}
        <span className="ml-auto text-xs text-muted">{cal.leaves.length ? `${plural(cal.leaves.length, 'leave')} this month` : 'No one is away this month'}</span>
      </div>

      {/* Desktop/tablet: month grid */}
      <div className="hidden overflow-hidden rounded-xl border sm:block">
        <div className="grid grid-cols-7 border-b bg-surface-2/50 text-center text-[11px] font-medium text-muted">
          {WEEK.map((d, i) => (
            <span key={d} className={cn('py-2', !cal.workingDays.includes((i + 1) % 7) && 'text-subtle')}>
              {d}
              {!cal.workingDays.includes((i + 1) % 7) && <span className="ml-1 font-normal">· off</span>}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => {
          const { bars, hidden } = layoutWeek(week, cal.leaves);
          // Weekly days off and public/company holidays are shaded; a special working day is a normal day.
          const dayKind = (d: string) => {
            const hs = cal.holidays.filter((h) => h.date === d);
            if (hs.some((h) => h.type === 'SPECIAL_WORKING_DAY')) return 'work';
            if (hs.some((h) => h.type === 'MANDATORY' || h.type === 'COMPANY')) return 'holiday';
            return cal.workingDays.includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ? 'work' : 'off';
          };
          return (
            <div key={wi} className="relative border-b last:border-b-0">
              {/* day backgrounds */}
              <div className="absolute inset-0 grid grid-cols-7" aria-hidden>
                {week.map((d, i) => (
                  <span
                    key={i}
                    className={cn(
                      'border-r last:border-r-0',
                      !d ? 'bg-surface-2/30' : dayKind(d) === 'off' ? 'bg-[repeating-linear-gradient(135deg,var(--color-surface-2)_0_6px,transparent_6px_12px)]' : dayKind(d) === 'holiday' && 'bg-success/[0.07]',
                    )}
                  />
                ))}
              </div>
              {/* dates and holidays */}
              <div className="relative grid grid-cols-7">
                {week.map((d, i) => (
                  <div key={i} className="min-w-0 px-1.5 pt-1.5">
                    {d && (
                      <>
                        <p className={cn('mb-1 text-xs tabular-nums', d === todayStr ? 'inline-grid size-5 place-items-center rounded-full bg-primary font-semibold text-primary-foreground' : 'text-muted')}>{Number(d.slice(8))}</p>
                        {cal.holidays
                          .filter((h) => h.date === d)
                          .map((h) => (
                            <p key={h.id} className={cn('mb-0.5 truncate rounded px-1 text-[10px] font-medium', h.type === 'SPECIAL_WORKING_DAY' ? 'bg-info/12 text-info-ink' : 'bg-success/12 text-success-ink')} title={h.name}>
                              {h.name}
                            </p>
                          ))}
                      </>
                    )}
                  </div>
                ))}
              </div>
              {/* leave lines: name, then the person's colour, then the leave type's colour (dashed while pending) */}
              <div className="relative grid min-h-12 grid-cols-7 content-start gap-y-1.5 pt-1 pb-2" style={{ gridAutoRows: '1.75rem' }}>
                {bars.map(({ l, from, to, lane, starts, ends }) => {
                  const pending = l.status === 'PENDING';
                  return (
                    <Tooltip key={`${l.id}-${wi}`} side="top" content={`${l.person.name} · ${l.type.name} · ${rangeLabel(l)}${pending ? ' · waiting for approval' : ''}`}>
                      <button
                        type="button"
                        onClick={() => set({ leave: l.id })}
                        aria-label={`${l.person.name}, ${l.type.name}, ${rangeLabel(l)}. Show details`}
                        className={cn('flex min-w-0 flex-col justify-center gap-[3px] rounded-sm text-left transition hover:opacity-80', starts ? 'ml-1.5' : '-ml-px', ends ? 'mr-1.5' : '-mr-px', pending && 'opacity-75')}
                        style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: lane + 1 }}
                      >
                        <span className="flex min-w-0 items-center gap-1 text-[11px] leading-none font-medium">
                          {starts ? <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: l.person.avatarColor }} aria-hidden /> : <ChevronRight className="size-3 shrink-0 text-muted" aria-hidden />}
                          <span className="truncate">{l.person.name}</span>
                          {ends && l.startDate !== l.endDate && <span className="ml-auto shrink-0 text-[10px] text-muted tabular-nums">{l.days}d</span>}
                        </span>
                        <LeaveLine color={l.person.avatarColor} starts={starts} ends={ends} />
                        <LeaveLine color={l.type.color} starts={starts} ends={ends} dashed={pending} />
                      </button>
                    </Tooltip>
                  );
                })}
                {hidden.map((n, i) =>
                  n ? (
                    <button
                      key={`more-${i}`}
                      type="button"
                      onClick={() => set({ day: week[i] })}
                      className="mx-1 rounded px-1 text-left text-[10px] font-medium text-primary hover:bg-primary-soft hover:underline"
                      style={{ gridColumn: i + 1, gridRow: MAX_LANES + 1 }}
                      aria-label={`${n} more away on ${week[i] ? fmtDay(week[i]!) : 'this day'}. Show everyone`}
                    >
                      +{n} more
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
      {cal.leaves.length > 0 && (
        <div className="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted sm:flex">
          <span className="font-medium text-foreground">Top line: the person · Bottom line: type of leave</span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border bg-[repeating-linear-gradient(135deg,var(--color-surface-2)_0_3px,transparent_3px_6px)]" />
            Day off
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border bg-success/15" />
            Holiday
          </span>
          {[...new Map(cal.leaves.map((l) => [l.type.id, l.type])).values()].map((t) => (
            <span key={t.id} className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </span>
          ))}
          {cal.leaves.some((l) => l.status === 'PENDING') && (
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-4" style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px)' }} />
              Waiting for approval
            </span>
          )}
        </div>
      )}

      {/* Mobile: agenda list */}
      <ul className="divide-y rounded-xl border sm:hidden">
        {cal.leaves.length === 0 && cal.holidays.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No one is away this month.</li>}
        {cal.holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
            <span className="font-medium">{h.name}</span>
            <span className="text-muted">{fmtDay(h.date)}</span>
          </li>
        ))}
        {cal.leaves.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => set({ leave: l.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
            <UserAvatar person={l.person} size="sm" showPresence={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{l.person.name}</span>
              <span className="text-xs text-muted">
                {l.type.name} · {rangeLabel(l)}
                {l.status === 'PENDING' && ' · waiting for approval'}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted tabular-nums">{plural(l.days, 'day')}</span>
            </button>
          </li>
        ))}
      </ul>
      {cal.leaves.length > 0 && (
        <p className="mt-2 text-xs text-subtle">
          Select a leave to see how its days add up.
          {cal.leaves.some((l) => l.status === 'PENDING') && <span className="hidden sm:inline"> Dashed lines are requests still waiting for approval; only HR and managers see those.</span>}
        </p>
      )}
      <LeaveDetails leave={cal.leaves.find((l) => l.id === get('leave'))} onClose={() => set({ leave: null })} />
      <DayAway day={/^\d{4}-\d{2}-\d{2}$/.test(get('day')) ? get('day') : ''} leaves={cal.leaves} onPick={(id) => set({ day: null, leave: id })} onClose={() => set({ day: null })} />
    </div>
  );
}
