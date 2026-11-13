'use client';
import { TASK_KIND_LABELS, TASK_PRIORITY_LABELS, TASK_SIZE_DAYS, TASK_STATUS_LABELS, type TaskKind, type TaskPriority, type TaskSize, type TaskStatus } from '@fg/shared';
import { Bug, Check, ChevronDown, ChevronsUp, ChevronUp, Circle, CircleCheck, CircleDashed, CircleDot, CircleSlash, Equal, Eye, Search, Sparkles, SquareCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { useEmployeeList } from '@/lib/hooks';
import { LOAD_LABEL, fmtEffort, type Load, type LoadLevel, type MiniPerson, type ProjectRef } from '@/lib/work';
import { cn } from '@/lib/utils';
import './work.css';

export const STATUS_ICON: Record<TaskStatus, LucideIcon> = { BACKLOG: CircleDashed, TODO: Circle, IN_PROGRESS: CircleDot, IN_REVIEW: Eye, DONE: CircleCheck, CANCELLED: CircleSlash };
export const STATUS_TONE: Record<TaskStatus, string> = { BACKLOG: 'text-subtle', TODO: 'text-muted', IN_PROGRESS: 'text-info', IN_REVIEW: 'text-warning', DONE: 'text-success', CANCELLED: 'text-subtle' };
/** Columns of the board, in the order work moves through them. */
export const BOARD_STATUSES: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return <Icon className={cn('size-4 shrink-0', STATUS_TONE[status], className)} aria-label={TASK_STATUS_LABELS[status]} />;
}

const PRIORITY_ICON: Record<TaskPriority, LucideIcon> = { URGENT: ChevronsUp, HIGH: ChevronUp, MEDIUM: Equal, LOW: ChevronDown };
const PRIORITY_TONE: Record<TaskPriority, string> = { URGENT: 'text-danger', HIGH: 'text-warning', MEDIUM: 'text-subtle', LOW: 'text-subtle' };
export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <Tooltip content={`${TASK_PRIORITY_LABELS[priority]} priority`} side="top">
      <span className="inline-flex">
        <Icon className={cn('size-4 shrink-0', PRIORITY_TONE[priority], className)} aria-label={`${TASK_PRIORITY_LABELS[priority]} priority`} />
      </span>
    </Tooltip>
  );
}

const KIND_ICON: Record<TaskKind, LucideIcon> = { TASK: SquareCheck, BUG: Bug, ENHANCEMENT: Sparkles };
const KIND_TONE: Record<TaskKind, string> = { TASK: 'text-subtle', BUG: 'text-danger', ENHANCEMENT: 'text-primary' };
export function KindIcon({ kind, className }: { kind: TaskKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={cn('size-3.5 shrink-0', KIND_TONE[kind], className)} aria-label={TASK_KIND_LABELS[kind]} />;
}

/** Effort at a glance: five bars, filled up to the size. */
export function SizeMark({ size, className }: { size: TaskSize; className?: string }) {
  const order: TaskSize[] = ['XS', 'S', 'M', 'L', 'XL'];
  const n = order.indexOf(size) + 1;
  return (
    <Tooltip content={`About ${fmtEffort(TASK_SIZE_DAYS[size])} of work`} side="top">
      <span className={cn('inline-flex items-end gap-px', className)} role="img" aria-label={`Size ${size}: about ${fmtEffort(TASK_SIZE_DAYS[size])} of work`}>
        {order.map((s, i) => (
          <span key={s} className={cn('w-[3px] rounded-[1px]', i < n ? 'bg-foreground/55' : 'bg-border-strong')} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
    </Tooltip>
  );
}

export function ProjectChip({ project, className }: { project: ProjectRef | null; className?: string }) {
  if (!project) return <span className={cn('inline-flex items-center gap-1.5 text-xs text-subtle', className)}>Personal</span>;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-muted', className)}>
      <span className="size-2 shrink-0 rounded-[3px]" style={{ background: project.color }} aria-hidden />
      <span className="truncate">{project.name}</span>
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 'xs' }: { people: MiniPerson[]; max?: number; size?: 'xs' | 'sm' }) {
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <Tooltip key={p.id} content={p.name} side="top">
          <span className={cn('rounded-full ring-2 ring-surface', i > 0 && '-ml-1.5')}>
            <UserAvatar person={p} size={size} showPresence={false} />
          </span>
        </Tooltip>
      ))}
      {people.length > max && <span className="ml-1 text-[11px] font-medium text-muted">+{people.length - max}</span>}
    </span>
  );
}

const LEVEL_BAR: Record<LoadLevel, string> = { free: 'bg-border-strong', light: 'bg-success', steady: 'bg-info', over: 'bg-danger' };
const LEVEL_TEXT: Record<LoadLevel, string> = { free: 'text-subtle', light: 'text-success', steady: 'text-info', over: 'text-danger' };

/**
 * Work against time: the track is the working days available, the fill is the work due.
 * Past 100% the fill is full and the overflow is drawn as a second, hatched segment.
 */
export function LoadMeter({ load, className, showLabel = true }: { load: Load; className?: string; showLabel?: boolean }) {
  const pct = Math.min(load.pct, 200);
  const over = Math.max(0, pct - 100);
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(load.pct, 100)}
        aria-valuetext={`${load.pct}% of available time. ${LOAD_LABEL[load.level]}.`}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-300', LEVEL_BAR[load.level])} style={{ width: `${Math.min(pct, 100) / (1 + over / 100)}%` }} />
        {over > 0 && <div className="work-hatch h-full flex-1 rounded-r-full text-danger" />}
      </div>
      {showLabel && (
        <p className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
          <span className={cn('font-medium whitespace-nowrap', LEVEL_TEXT[load.level])}>{LOAD_LABEL[load.level]}</span>
          <span className="truncate tabular-nums text-muted">
            {fmtEffort(load.demandDays)} of work · {load.availableDays} {load.availableDays === 1 ? 'day' : 'days'} free
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Choose a person. With `options` it filters that list (project members, candidates);
 * without, it searches the directory. The server still checks who may be chosen.
 */
export function PersonPicker({
  value,
  onChange,
  options,
  allowNone,
  noneLabel = 'No one yet',
  disabled,
  label = 'Owner',
  className,
}: {
  value: MiniPerson | null;
  onChange: (p: MiniPerson | null) => void;
  options?: MiniPerson[];
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useEmployeeList({ q: q || undefined, status: 'ACTIVE', pageSize: 20 }, open && !options);
  const people: MiniPerson[] = useMemo(() => {
    if (options) return options.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
    return (search.data?.items ?? []).map((e) => ({ id: e.id, name: e.name, designation: e.designation, avatarUrl: e.avatarUrl, avatarColor: e.avatarColor }));
  }, [options, q, search.data]);
  const rows: (MiniPerson | null)[] = allowNone ? [null, ...people] : people;
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  const pick = (p: MiniPerson | null) => {
    onChange(p);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${label}: ${value?.name ?? noneLabel}. Change`}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg border border-border-strong bg-surface px-2.5 text-left text-sm shadow-sm transition hover:bg-surface-2 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-soft focus-visible:outline-none disabled:pointer-events-none disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:shadow-none',
            className,
          )}
        >
          {value ? <UserAvatar person={value} size="xs" showPresence={false} /> : <UserRound className="size-4 text-subtle" aria-hidden />}
          <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted')}>{value?.name ?? noneLabel}</span>
          {!disabled && <ChevronDown className="size-3.5 text-subtle" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && rows[active] !== undefined) {
                e.preventDefault();
                pick(rows[active]!);
              }
            }}
            placeholder="Search by name"
            aria-label="Search people"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-subtle"
          />
        </div>
        <ul className="scrollbar-thin max-h-64 overflow-y-auto p-1" role="listbox" aria-label={label}>
          {rows.map((p, i) => (
            <li key={p?.id ?? 'none'} role="option" aria-selected={(p?.id ?? null) === (value?.id ?? null)}>
              <button
                type="button"
                onClick={() => pick(p)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm', i === active && 'bg-surface-2')}
              >
                {p ? <UserAvatar person={p} size="xs" showPresence={false} /> : <UserRound className="size-4 text-subtle" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p?.name ?? noneLabel}</span>
                  {p?.designation && <span className="block truncate text-[11px] text-muted">{p.designation}</span>}
                </span>
                {(p?.id ?? null) === (value?.id ?? null) && <Check className="size-4 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
          {!people.length && (
            <li className="px-3 py-4 text-center text-xs text-muted">{!options && search.isPending ? 'Searching…' : !options && search.isError ? 'People could not be loaded. Try again.' : q ? `No one matches “${q}”.` : 'No one to choose from yet.'}</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
