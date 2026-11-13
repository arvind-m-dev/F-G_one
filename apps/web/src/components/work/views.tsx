'use client';
import { PROJECT_STATUS_LABELS, type TaskStatus } from '@fg/shared';
import { useMutation } from '@tanstack/react-query';
import { CalendarRange, ChevronDown, CircleCheck, FolderKanban, ListTodo, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { addDaysYmd, daysBetween, fmtDay, loadSentence, useProjects, useRefreshWork, useTasks, useWorkSummary, type Project, type Task, type TaskQuery } from '@/lib/work';
import { cn } from '@/lib/utils';
import { Board } from './board';
import { PlanLane } from './plan-lane';
import { AvatarStack, LoadMeter } from './task-bits';
import { TaskRow } from './task-row';
import { Timeline } from './timeline';

const LoadFailed = ({ what, error, retry }: { what: string; error: unknown; retry: () => void }) => (
  <EmptyState icon={<TriangleAlert />} title={`${what} couldn't be loaded`} description={errorMessage(error)} action={<Button variant="outline" onClick={retry}>Try again</Button>} />
);

/** Tabs that live in the URL. Arrow keys move between them. */
export function ViewTabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className="scrollbar-none -mx-6 mb-6 flex gap-1 overflow-x-auto border-b px-6 sm:-mx-10 sm:px-10">
      {tabs.map(([v, text], i) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          type="button"
          aria-selected={value === v}
          tabIndex={value === v ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={(e) => {
            const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
            if (next < 0 || next >= tabs.length) return;
            e.preventDefault();
            refs.current[next]?.focus();
            onChange(tabs[next]![0]);
          }}
          className={cn('relative -mb-px rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', value === v ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────── My work ───────────────────────────── */

function QuickAdd() {
  const refresh = useRefreshWork();
  const [title, setTitle] = useState('');
  const add = useMutation({
    mutationFn: () => api<Task>('/work/tasks', { body: { title: title.trim() } }),
    onSuccess: () => {
      setTitle('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length >= 2) add.mutate();
      }}
    >
      <div className="relative flex-1">
        <Plus className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Jot down a task for yourself and press Enter" aria-label="Add a personal task" className="pl-9" />
      </div>
      <Button type="submit" variant="outline" disabled={title.trim().length < 2} loading={add.isPending}>
        Add
      </Button>
    </form>
  );
}

function Group({ title, tone, tasks, today, onOpen, collapsible }: { title: string; tone?: string; tasks: Task[]; today: string; onOpen: (id: string) => void; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  if (!tasks.length) return null;
  return (
    <section>
      {collapsible ? (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mb-1.5 flex items-center gap-1 rounded text-xs font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} aria-hidden />
          {title} · {tasks.length}
        </button>
      ) : (
        <h2 className={cn('mb-1.5 text-xs font-medium text-muted', tone)}>
          {title} · {tasks.length}
        </h2>
      )}
      {open && (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} today={today} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function MyWork({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const me = useSession();
  const summary = useWorkSummary();
  const tasks = useTasks({ scope: 'mine', status: 'ALL' });
  const groups = useMemo(() => {
    const today = summary.data?.today ?? '';
    const list = tasks.data ?? [];
    const order = (a: Task, b: Task) => ((a.plan?.start ?? a.dueDate ?? '9') < (b.plan?.start ?? b.dueDate ?? '9') ? -1 : 1);
    const open = list.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS' || t.status === 'IN_REVIEW').sort(order);
    const week = addDaysYmd(today || '2000-01-01', 6);
    return {
      open,
      late: open.filter((t) => t.overdue),
      today: open.filter((t) => t.dueDate === today),
      week: open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= week),
      later: open.filter((t) => t.dueDate && t.dueDate > week),
      undated: open.filter((t) => !t.dueDate),
      parked: list.filter((t) => t.status === 'BACKLOG'),
      done: list.filter((t) => t.status === 'DONE' && t.completedAt && Date.now() - Date.parse(t.completedAt) < 7 * 86_400_000).sort((a, b) => (a.completedAt! > b.completedAt! ? -1 : 1)),
    };
  }, [tasks.data, summary.data?.today]);

  if (summary.isPending || tasks.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (summary.isError) return <LoadFailed what="Your plan" error={summary.error} retry={() => void summary.refetch()} />;
  if (tasks.isError) return <LoadFailed what="Your tasks" error={tasks.error} retry={() => void tasks.refetch()} />;
  const s = summary.data;
  const today = s.today;
  const nothing = !groups.open.length && !groups.parked.length && !groups.done.length;

  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <section aria-label="Your next two weeks" className="rounded-2xl border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[13px] font-semibold">Your next two weeks</h2>
            <p className="text-xs text-muted">until {fmtDay(s.windowEnd, { weekday: true })}</p>
          </div>
          <p className="mt-1 text-[15px]">
            {loadSentence(s.load)}{' '}
            {s.load.level === 'over' ? (
              <span className="font-medium text-danger">That is more than fits.</span>
            ) : s.load.lateTasks > 0 ? (
              <span className="font-medium text-warning">{s.load.lateTasks === 1 ? 'One task' : `${s.load.lateTasks} tasks`} will finish after the due date.</span>
            ) : s.load.openTasks ? (
              <span className="text-muted">Everything fits.</span>
            ) : null}
          </p>
          <PlanLane tasks={groups.open} today={today} windowEnd={s.windowEnd} workingDays={me.organization.settings.attendance.workingDays} onOpen={onOpen} className="mt-4" />
          {(s.load.level === 'over' || s.load.lateTasks > 0) && (
            <p className="mt-3 text-xs text-muted">Open a striped task and choose “Ask for more time” to request a later date or a handover.</p>
          )}
        </section>

        <QuickAdd />

        {nothing ? (
          <EmptyState icon={<ListTodo />} title="Nothing on your plate" description="Tasks you add or are given show up here, in the order to do them." action={<Button onClick={onNew}><Plus /> New task</Button>} className="rounded-xl border border-dashed" />
        ) : (
          <div className="space-y-6">
            {!groups.open.length && <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted">Nothing open right now. Nicely done.</p>}
            <Group title="Late" tone="text-danger" tasks={groups.late} today={today} onOpen={onOpen} />
            <Group title="Due today" tasks={groups.today} today={today} onOpen={onOpen} />
            <Group title="This week" tasks={groups.week} today={today} onOpen={onOpen} />
            <Group title="Later" tasks={groups.later} today={today} onOpen={onOpen} />
            <Group title="No due date" tasks={groups.undated} today={today} onOpen={onOpen} />
            <Group title="Parked for later" tasks={groups.parked} today={today} onOpen={onOpen} collapsible />
            <Group title="Finished in the last 7 days" tasks={groups.done} today={today} onOpen={onOpen} collapsible />
          </div>
        )}
      </div>

      <aside className="space-y-6 lg:pt-1">
        <section aria-label="Your workload">
          <h2 className="mb-2 text-[13px] font-semibold">Workload</h2>
          <LoadMeter load={s.load} />
        </section>
        <dl className="divide-y rounded-xl border text-[13px]">
          {(
            [
              ['Open tasks', s.counts.open, ''],
              ['Late', s.counts.overdue, s.counts.overdue ? 'text-danger' : ''],
              ['Due today', s.counts.dueToday, s.counts.dueToday ? 'text-warning' : ''],
              ['Due in the next 7 days', s.counts.dueThisWeek, ''],
              ['Your requests waiting', s.counts.pendingRequests, ''],
            ] as const
          ).map(([label, n, tone]) => (
            <div key={label} className="flex items-center justify-between px-3.5 py-2.5">
              <dt className="text-muted">{label}</dt>
              <dd className={cn('font-semibold tabular-nums', tone)}>{n}</dd>
            </div>
          ))}
        </dl>
        {s.counts.toDecide > 0 && (
          <Link href="/app/approvals?tab=work" className="flex items-center justify-between rounded-xl border border-warning/40 bg-warning/8 px-3.5 py-3 text-[13px] font-medium hover:bg-warning/12">
            {s.counts.toDecide === 1 ? '1 request needs your decision' : `${s.counts.toDecide} requests need your decision`}
            <span aria-hidden>→</span>
          </Link>
        )}
        <p className="text-xs leading-relaxed text-muted">Workload compares the size of your open tasks with your working days in the next two weeks, leaving out weekends, holidays and approved leave.</p>
      </aside>
    </div>
  );
}

/* ───────────────────────────── board and timeline ───────────────────────────── */

export function TaskFilters({ project, who, onChange, projects, hideProject }: { project: string; who: string; onChange: (p: { project?: string; who?: string }) => void; projects: Project[] | undefined; hideProject?: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {!hideProject && (
        <Select value={project} onChange={(e) => onChange({ project: e.target.value })} aria-label="Show tasks from" className="h-8 w-auto min-w-44 text-[13px]">
          <option value="">All projects and personal</option>
          <option value="none">Personal tasks only</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </Select>
      )}
      <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="group" aria-label="Whose tasks">
        {(
          [
            ['', 'Everyone'],
            ['me', 'Just me'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={who === v} onClick={() => onChange({ who: v })} className={cn('rounded-md px-2.5 py-1 text-[13px] font-medium transition', who === v ? 'bg-canvas shadow-sm' : 'text-muted hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function useFilteredTasks(project: string, who: string, status: TaskQuery['status']) {
  const q = useTasks({ scope: who === 'me' ? 'mine' : 'all', projectId: project && project !== 'none' ? project : undefined, status });
  const data = useMemo(() => (project === 'none' ? q.data?.filter((t) => !t.project) : q.data), [q.data, project]);
  return { ...q, data };
}

export function BoardView({ project, who, today, onOpen, onAdd, showProject = true }: { project: string; who: string; today: string; onOpen: (id: string) => void; onAdd: (s: TaskStatus) => void; showProject?: boolean }) {
  const q = useFilteredTasks(project, who, 'ALL');
  // Finished work stays on the board for two weeks, then it is only in the project's list.
  const tasks = useMemo(() => (q.data ?? []).filter((t) => t.status !== 'CANCELLED' && (t.status !== 'DONE' || !t.completedAt || Date.now() - Date.parse(t.completedAt) < 14 * 86_400_000)), [q.data]);
  if (q.isPending) return <Skeleton className="h-[50dvh]" />;
  if (q.isError) return <LoadFailed what="The board" error={q.error} retry={() => void q.refetch()} />;
  return <Board tasks={tasks} today={today} onOpen={onOpen} onAdd={onAdd} showProject={showProject} />;
}

export function TimelineView({ project, who, today, onOpen, onNew }: { project: string; who: string; today: string; onOpen: (id: string) => void; onNew: () => void }) {
  const me = useSession();
  const q = useFilteredTasks(project, who, 'OPEN');
  if (q.isPending) return <Skeleton className="h-[50dvh]" />;
  if (q.isError) return <LoadFailed what="The timeline" error={q.error} retry={() => void q.refetch()} />;
  const dated = (q.data ?? []).filter((t) => t.plan || t.dueDate);
  if (!dated.length) {
    return <EmptyState icon={<CalendarRange />} title="Nothing to place on the calendar yet" description="Tasks appear here once they have an owner or a due date." action={<Button onClick={onNew}><Plus /> New task</Button>} className="rounded-xl border border-dashed" />;
  }
  return <Timeline tasks={dated} today={today} workingDays={me.organization.settings.attendance.workingDays} onOpen={onOpen} />;
}

/* ───────────────────────────── projects ───────────────────────────── */

export function ProjectProgress({ counts, className }: { counts: Project['counts']; className?: string }) {
  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  return (
    <div className={className}>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${counts.done} of ${counts.total} tasks done`}>
        <div className="h-full rounded-full bg-success transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{counts.total ? `${counts.done} of ${counts.total} done` : 'No tasks yet'}</span>
        {counts.overdue > 0 && <span className="font-medium text-danger">{counts.overdue} late</span>}
      </p>
    </div>
  );
}

export function targetLabel(p: Pick<Project, 'targetDate' | 'status'>, today: string) {
  if (!p.targetDate) return null;
  if (p.status === 'COMPLETED' || p.status === 'ARCHIVED') return { text: `Target was ${fmtDay(p.targetDate)}`, late: false };
  const n = daysBetween(today, p.targetDate);
  return n < 0 ? { text: `Target ${fmtDay(p.targetDate)} · ${-n} ${n === -1 ? 'day' : 'days'} past`, late: true } : { text: `Target ${fmtDay(p.targetDate)} · ${n === 0 ? 'today' : `${n} ${n === 1 ? 'day' : 'days'} left`}`, late: false };
}

export function ProjectsView({ showAll, onShowAll, onNew, canCreate, today }: { showAll: boolean; onShowAll: (v: boolean) => void; onNew: () => void; canCreate: boolean; today: string }) {
  const q = useProjects(showAll ? 'all' : 'active');
  if (q.isPending) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}</div>;
  if (q.isError) return <LoadFailed what="Projects" error={q.error} retry={() => void q.refetch()} />;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />
          Show completed and archived
        </label>
      </div>
      {!q.data.length ? (
        <EmptyState
          icon={<FolderKanban />}
          title={showAll ? 'No projects yet' : 'No active projects'}
          description={canCreate ? 'Create a project to group tasks, add the people working on it and set a target date.' : 'Projects you are added to will appear here. A manager can create one and add you.'}
          action={canCreate ? <Button onClick={onNew}><Plus /> New project</Button> : undefined}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => {
            const target = targetLabel(p, today);
            return (
              <li key={p.id}>
                <Link href={`/app/work/projects/${p.id}`} className="group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-surface p-4 pl-5 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: p.color }} aria-hidden />
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-muted">{p.key}</span>
                    {p.status !== 'ACTIVE' && <Badge tone={p.status === 'COMPLETED' ? 'success' : 'muted'}>{PROJECT_STATUS_LABELS[p.status]}</Badge>}
                    {p.status === 'COMPLETED' && <CircleCheck className="size-3.5 text-success" aria-hidden />}
                  </span>
                  <span className="mt-1 text-[15px] leading-snug font-semibold group-hover:underline">{p.name}</span>
                  {p.description && <span className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</span>}
                  <span className="flex-1" />
                  <ProjectProgress counts={p.counts} className="mt-4" />
                  <span className="mt-3 flex items-center justify-between gap-2">
                    <AvatarStack people={p.members} />
                    {target && <span className={cn('text-xs', target.late ? 'font-medium text-danger' : 'text-muted')}>{target.text}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
