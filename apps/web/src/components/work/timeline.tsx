'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { addDaysYmd, daysBetween, fmtDay, type MiniPerson, type Task } from '@/lib/work';
import { cn } from '@/lib/utils';
import { StatusIcon } from './task-bits';
import './work.css';

const DAY = 30; // px per day
const LABEL = 'w-[148px] sm:w-[240px]';

interface Group {
  key: string;
  person: MiniPerson | null;
  tasks: Task[];
}

/**
 * Where the work lands on the calendar. Each bar is the planner's estimate for a task
 * (not just its dates): it starts when its owner can start and ends when they would finish.
 * The diamond is the due date; a bar that runs past it is striped.
 */
export function Timeline({ tasks, today, workingDays, onOpen }: { tasks: Task[]; today: string; workingDays: number[]; onOpen: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => tasks.filter((t) => t.plan || (t.startDate && t.dueDate) || t.dueDate), [tasks]);
  const { start, total } = useMemo(() => {
    const dates = rows.flatMap((t) => [t.plan?.start, t.plan?.end, t.dueDate, t.startDate].filter((d): d is string => !!d));
    const min = dates.reduce((a, b) => (a < b ? a : b), today);
    const max = dates.reduce((a, b) => (a > b ? a : b), today);
    const s = addDaysYmd(min < addDaysYmd(today, -21) ? addDaysYmd(today, -21) : min, -2);
    const e = addDaysYmd(max > addDaysYmd(today, 120) ? addDaysYmd(today, 120) : max, 5);
    return { start: s, total: Math.max(daysBetween(s, e) + 1, 28) };
  }, [rows, today]);
  const days = useMemo(() => Array.from({ length: total }, (_, i) => addDaysYmd(start, i)), [start, total]);
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const t of rows) {
      const key = t.assignee?.id ?? 'none';
      if (!map.has(key)) map.set(key, { key, person: t.assignee, tasks: [] });
      map.get(key)!.tasks.push(t);
    }
    for (const g of map.values()) g.tasks.sort((a, b) => ((a.plan?.start ?? a.startDate ?? a.dueDate ?? '') < (b.plan?.start ?? b.startDate ?? b.dueDate ?? '') ? -1 : 1));
    return [...map.values()].sort((a, b) => (a.person ? (b.person ? a.person.name.localeCompare(b.person.name) : -1) : 1));
  }, [rows]);
  const todayX = daysBetween(start, today) * DAY;
  // Open on today rather than the far left.
  useEffect(() => {
    scroller.current?.scrollTo({ left: Math.max(0, todayX - 3 * DAY) });
  }, [todayX]);
  const x = (ymd: string) => Math.max(0, Math.min(total, daysBetween(start, ymd))) * DAY;
  const months = useMemo(() => {
    const out: { label: string; from: number; span: number }[] = [];
    days.forEach((d, i) => {
      const label = new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const last = out[out.length - 1];
      if (last && last.label === label) last.span++;
      else out.push({ label, from: i, span: 1 });
    });
    return out;
  }, [days]);

  return (
    <div className="overflow-hidden rounded-xl border">
      <div ref={scroller} className="scrollbar-thin overflow-x-auto" tabIndex={0} role="region" aria-label="Timeline. Scroll sideways to see later dates.">
        <style>{`.tl-root{--tl-label:148px}@media (min-width:640px){.tl-root{--tl-label:240px}}`}</style>
        <div className="tl-root relative" style={{ width: `calc(${total * DAY}px + var(--tl-label))` }}>
          <div>
            {/* header */}
            <div className="sticky top-0 z-20 flex border-b bg-surface">
              <div className={cn('sticky left-0 z-10 shrink-0 border-r bg-surface', LABEL)} />
              <div className="relative h-12" style={{ width: total * DAY }}>
                {months.map((m) => (
                  <span key={`${m.label}-${m.from}`} className="absolute top-1 truncate px-2 text-[11px] font-semibold text-muted" style={{ left: m.from * DAY, width: m.span * DAY }}>
                    {m.span >= 3 ? m.label : ''}
                  </span>
                ))}
                {days.map((d, i) => {
                  const date = new Date(`${d}T00:00:00Z`);
                  const off = !workingDays.includes(date.getUTCDay());
                  return (
                    <span key={d} className={cn('absolute bottom-1 text-center text-[10px] tabular-nums', d === today ? 'font-bold text-danger' : off ? 'text-subtle/60' : 'text-subtle')} style={{ left: i * DAY, width: DAY }}>
                      {date.getUTCDate()}
                    </span>
                  );
                })}
              </div>
            </div>
            {/* body */}
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 right-0 flex" style={{ width: total * DAY }} aria-hidden>
                {days.map((d) => (
                  <div key={d} className={cn('h-full border-r border-border/50', !workingDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && 'work-dayoff bg-surface-2/50')} style={{ width: DAY }} />
                ))}
                <div className="absolute inset-y-0 w-px bg-danger" style={{ left: todayX + DAY / 2 }} />
              </div>
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="relative flex border-b bg-surface-2/40">
                    <div className={cn('sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r bg-surface-2 px-3 py-1.5', LABEL)}>
                      {g.person ? <UserAvatar person={g.person} size="xs" showPresence={false} /> : null}
                      <span className="truncate text-xs font-semibold">{g.person?.name ?? 'No owner yet'}</span>
                    </div>
                  </div>
                  {g.tasks.map((t) => {
                    const from = t.plan?.start ?? t.startDate ?? t.dueDate!;
                    const to = t.plan?.end ?? t.dueDate ?? from;
                    const left = x(from);
                    const width = Math.max(DAY, x(addDaysYmd(to, 1)) - left);
                    const color = t.project?.color ?? 'var(--brand)';
                    const late = !!t.plan?.late && !!t.dueDate;
                    const onTimeWidth = late ? Math.max(0, x(addDaysYmd(t.dueDate!, 1)) - left) : width;
                    const label = `${t.ref ? `${t.ref}: ` : ''}${t.title}`;
                    return (
                      <div key={t.id} className="relative flex border-b last:border-b-0">
                        <button type="button" onClick={() => onOpen(t.id)} className={cn('sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r bg-canvas px-3 py-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', LABEL)}>
                          <StatusIcon status={t.status} className="size-3.5" />
                          <span className="truncate text-[12.5px]">{t.title}</span>
                        </button>
                        <div className="relative h-9" style={{ width: total * DAY }}>
                          <Tooltip
                            side="top"
                            content={
                              <span className="block max-w-60">
                                <span className="block font-medium">{label}</span>
                                <span className="block opacity-80">
                                  {t.plan ? `Planned ${fmtDay(from)} to ${fmtDay(to)}` : `${fmtDay(from)} to ${fmtDay(to)} (not planned yet)`}
                                  {t.dueDate ? ` · due ${fmtDay(t.dueDate)}` : ''}
                                </span>
                              </span>
                            }
                          >
                            <button
                              type="button"
                              onClick={() => onOpen(t.id)}
                              aria-label={`${label}. ${t.plan ? `Planned ${fmtDay(from)} to ${fmtDay(to)}` : 'Not planned yet'}${late ? ', finishes after its due date' : ''}. Open`}
                              className="absolute top-2 flex h-5 overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              style={{ left: left + 2, width: width - 4, boxShadow: t.plan ? undefined : `inset 0 0 0 1.5px color-mix(in oklab, ${color} 60%, transparent)` }}
                            >
                              {t.plan && <span className="h-full shrink-0" style={{ width: late ? onTimeWidth : '100%', background: `color-mix(in oklab, ${color} 70%, var(--surface))` }} />}
                              {late && <span className="work-hatch h-full flex-1 text-danger" />}
                            </button>
                          </Tooltip>
                          {t.dueDate && daysBetween(start, t.dueDate) >= 0 && daysBetween(start, t.dueDate) < total && (
                            <span className={cn('pointer-events-none absolute top-[13px] size-2.5 rotate-45 rounded-[2px] border-2 border-canvas', late || t.overdue ? 'bg-danger' : 'bg-foreground/70')} style={{ left: x(t.dueDate) + DAY - 6 }} aria-hidden />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-surface px-3 py-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-primary/70" aria-hidden /> When the owner is expected to work on it
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rotate-45 rounded-[1px] bg-foreground/70" aria-hidden /> Due date
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="work-hatch h-2.5 w-5 rounded-sm text-danger" aria-hidden /> Runs past its due date
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-px bg-danger" aria-hidden /> Today
        </span>
      </p>
    </div>
  );
}
