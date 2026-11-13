'use client';
import { useMemo } from 'react';
import { Tooltip } from '@/components/ui/misc';
import { addDaysYmd, daysBetween, fmtDay, fmtEffort, type ProjectRef, type TaskPlan } from '@/lib/work';
import { cn } from '@/lib/utils';
import './work.css';

export interface LaneTask {
  id: string;
  title: string;
  ref: string | null;
  hidden?: boolean;
  project: ProjectRef | null;
  remainingDays: number;
  dueDate: string | null;
  plan: TaskPlan | null;
}

/**
 * One person's next two weeks as a single lane: each open task takes the days the plan gives it,
 * in the order it will be done. Work that runs past its due date is striped.
 */
export function PlanLane({
  tasks,
  today,
  windowEnd,
  workingDays,
  onOpen,
  compact,
  className,
}: {
  tasks: LaneTask[];
  today: string;
  windowEnd: string;
  /** 0 = Sunday … 6 = Saturday, from the company's settings. */
  workingDays: number[];
  onOpen?: (id: string) => void;
  compact?: boolean;
  className?: string;
}) {
  const total = daysBetween(today, windowEnd) + 1;
  const days = useMemo(() => Array.from({ length: total }, (_, i) => addDaysYmd(today, i)), [today, total]);
  const segments = useMemo(() => {
    const planned = tasks.filter((t) => t.plan).sort((a, b) => (a.plan!.start < b.plan!.start ? -1 : a.plan!.start > b.plan!.start ? 1 : a.plan!.end < b.plan!.end ? -1 : 1));
    let used = 0;
    return planned
      .map((t, i) => {
        const next = planned[i + 1];
        const rawStart = daysBetween(today, t.plan!.start);
        // A task that shares its last day with the next one ends mid-day.
        const sharesEnd = next && next.plan!.start === t.plan!.end;
        const start = Math.max(rawStart, used);
        const end = Math.max(start + 0.4, daysBetween(today, t.plan!.end) + (sharesEnd ? 0.5 : 1));
        used = end;
        return { t, start, end };
      })
      .filter((s) => s.start < total);
  }, [tasks, today, total]);
  const beyond = tasks.filter((t) => t.plan && daysBetween(today, t.plan.start) >= total).length;

  return (
    <div className={cn('min-w-0', className)}>
      <div className={cn('relative overflow-hidden rounded-lg border bg-surface', compact ? 'h-7' : 'h-11')}>
        <div className="absolute inset-0 flex" aria-hidden>
          {days.map((d) => {
            const off = !workingDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay());
            return <div key={d} className={cn('h-full flex-1 border-r border-border/70 last:border-r-0', off && 'work-dayoff bg-surface-2/60')} />;
          })}
        </div>
        {segments.map(({ t, start, end }) => {
          const left = (start / total) * 100;
          const width = ((Math.min(end, total) - start) / total) * 100;
          const color = t.hidden ? 'var(--subtle)' : (t.project?.color ?? 'var(--brand)');
          const label = t.hidden ? 'Other work' : `${t.ref ? `${t.ref} · ` : ''}${t.title}`;
          const tip = (
            <span className="block max-w-56">
              <span className="block font-medium">{label}</span>
              <span className="block opacity-80">
                {fmtDay(t.plan!.start)} to {fmtDay(t.plan!.end)} · {fmtEffort(t.remainingDays)} left
              </span>
              {t.plan!.late && t.dueDate && <span className="block">Finishes after its due date of {fmtDay(t.dueDate)}</span>}
            </span>
          );
          const Tag = onOpen && !t.hidden ? 'button' : 'div';
          return (
            <Tooltip key={t.id} content={tip} side="top">
              <Tag
                {...(Tag === 'button' ? { type: 'button' as const, onClick: () => onOpen!(t.id), 'aria-label': `${label}. Planned ${fmtDay(t.plan!.start)} to ${fmtDay(t.plan!.end)}${t.plan!.late ? ', late' : ''}. Open` } : {})}
                className={cn(
                  'work-anim absolute inset-y-1 flex items-center overflow-hidden rounded-md px-1.5 text-left text-[11px] font-medium outline-none transition-[filter] focus-visible:ring-2 focus-visible:ring-ring',
                  Tag === 'button' && 'cursor-pointer hover:brightness-95',
                  t.plan!.late && 'work-hatch',
                )}
                style={{
                  left: `calc(${left}% + 2px)`,
                  width: `calc(${width}% - 4px)`,
                  background: t.plan!.late ? undefined : `color-mix(in oklab, ${color} 22%, var(--surface))`,
                  color: t.plan!.late ? 'var(--danger)' : `color-mix(in oklab, ${color} 75%, var(--foreground))`,
                  boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${t.plan!.late ? 'var(--danger)' : color} 45%, transparent)`,
                }}
              >
                {!compact && <span className={cn('truncate', t.plan!.late && 'rounded bg-surface/85 px-1 text-danger')}>{t.hidden ? 'Other work' : (t.ref ?? t.title)}</span>}
              </Tag>
            </Tooltip>
          );
        })}
      </div>
      {!compact && (
        <div className="mt-1 flex text-[10px] text-subtle" aria-hidden>
          {days.map((d, i) => {
            const date = new Date(`${d}T00:00:00Z`);
            const off = !workingDays.includes(date.getUTCDay());
            return (
              <span key={d} className={cn('flex-1 text-center tabular-nums', i === 0 && 'font-semibold text-foreground', off && 'opacity-50')}>
                {i === 0 ? 'Today' : date.getUTCDate()}
              </span>
            );
          })}
        </div>
      )}
      {beyond > 0 && !compact && <p className="mt-1 text-[11px] text-muted">{beyond === 1 ? '1 more task starts' : `${beyond} more tasks start`} after {fmtDay(windowEnd)}.</p>}
    </div>
  );
}
