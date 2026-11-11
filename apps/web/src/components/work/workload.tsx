'use client';
import { ArrowRight, CalendarClock, ChevronDown, Scale, Sparkles, TriangleAlert, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { Badge, EmptyState, InfoHint, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { fmtDay, fmtEffort, loadSentence, useUpdateTask, useWorkload, type Suggestion, type Workload } from '@/lib/work';
import { cn } from '@/lib/utils';
import { PlanLane } from './plan-lane';
import { LoadMeter, SizeMark, StatusIcon } from './task-bits';

function SuggestionCard({ s, onApply, onSkip, applying }: { s: Suggestion; onApply: () => void; onSkip: () => void; applying: boolean }) {
  const name = `${s.task.ref ? `${s.task.ref} ` : ''}“${s.task.title}”`;
  const move = s.kind === 'REASSIGN' && s.to;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
      <div className="flex shrink-0 items-center gap-1.5">
        <UserAvatar person={s.from} size="sm" showPresence={false} />
        {move ? (
          <>
            <ArrowRight className="size-4 text-subtle" aria-hidden />
            <UserAvatar person={s.to!} size="sm" showPresence={false} />
          </>
        ) : (
          <>
            <ArrowRight className="size-4 text-subtle" aria-hidden />
            <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted">
              <CalendarClock className="size-4" aria-hidden />
            </span>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[13.5px] font-medium">{move ? `Give ${name} to ${s.to!.name}` : `Move ${name} to ${fmtDay(s.date, { weekday: true })}`}</p>
        <p className="mt-0.5 text-xs text-muted">
          {move
            ? `${s.from.name} is at ${s.fromPct}% of their time. ${s.to!.name} is at ${s.toPct}%, would be at ${s.toPctAfter}% with it, and could finish by ${fmtDay(s.date)}.`
            : `${s.from.name} cannot finish it${s.task.dueDate ? ` by ${fmtDay(s.task.dueDate)}` : ''} with the work already queued, and nobody else who could take it has room. ${fmtDay(s.date)} is the earliest date the plan can meet.`}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Not now
        </Button>
        <Button size="sm" loading={applying} onClick={onApply}>
          {move ? 'Hand over' : 'Move date'}
        </Button>
      </div>
    </li>
  );
}

function PersonRow({ row, data, workingDays, onOpen }: { row: Workload['people'][number]; data: Workload; workingDays: number[]; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const { person, load, tasks } = row;
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-left outline-none transition-colors hover:bg-surface-2/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:grid-cols-[220px_260px_minmax(0,1fr)_auto]">
        <span className="flex min-w-0 items-center gap-2.5">
          <UserAvatar person={person} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium">{person.name}</span>
            <span className="block truncate text-xs text-muted">
              {load.openTasks ? `${load.openTasks} open ${load.openTasks === 1 ? 'task' : 'tasks'}` : 'Nothing queued'}
              {load.lateTasks > 0 && <span className="text-danger"> · {load.lateTasks} will be late</span>}
            </span>
          </span>
        </span>
        <ChevronDown className={cn('size-4 text-subtle transition-transform md:order-last', open && 'rotate-180')} aria-hidden />
        <LoadMeter load={load} className="col-span-2 md:col-span-1" />
        <PlanLane tasks={tasks} today={data.today} windowEnd={data.windowEnd} workingDays={workingDays} compact className="col-span-2 hidden md:col-span-1 md:block" />
      </button>
      {open && (
        <div className="border-t bg-surface-2/30 px-4 py-3">
          <p className="text-xs text-muted">
            {loadSentence(load, person.name)}
            {load.openTasks > 0 && ` Free from ${fmtDay(load.freeFrom, { weekday: true })}.`}
          </p>
          <PlanLane tasks={tasks} today={data.today} windowEnd={data.windowEnd} workingDays={workingDays} onOpen={onOpen} className="mt-3 md:hidden" />
          {tasks.length > 0 && (
            <ol className="mt-3 divide-y rounded-lg border bg-surface">
              {tasks.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                  <span className="w-4 text-center text-[11px] tabular-nums text-subtle">{i + 1}</span>
                  <StatusIcon status={t.status} className="size-3.5" />
                  {t.hidden ? (
                    <span className="min-w-0 flex-1 truncate text-muted italic">Work on another project</span>
                  ) : (
                    <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 truncate text-left hover:underline">
                      {t.ref && <span className="mr-1.5 font-mono text-[11px] text-subtle">{t.ref}</span>}
                      {t.title}
                    </button>
                  )}
                  <span className="hidden text-xs whitespace-nowrap text-muted sm:inline">{fmtEffort(t.remainingDays)} left</span>
                  {t.plan && <span className={cn('text-xs whitespace-nowrap', t.plan.late ? 'font-medium text-danger' : 'text-muted')}>{t.plan.late ? `Late: ${fmtDay(t.plan.end)}` : `By ${fmtDay(t.plan.end)}`}</span>}
                  <SizeMark size={t.size} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

/** Who has too much, who has room, and what to move. For managers and project leads. */
export function WorkloadView({ projectId, onOpen }: { projectId?: string; onOpen: (id: string) => void }) {
  const me = useSession();
  const workingDays = me.organization.settings.attendance.workingDays;
  const q = useWorkload(projectId);
  const update = useUpdateTask();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [applying, setApplying] = useState<string | null>(null);

  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <EmptyState icon={<Users />} title="Team load couldn't be loaded" description={errorMessage(q.error)} action={<Button variant="outline" onClick={() => void q.refetch()}>Try again</Button>} />;
  const data = q.data;
  const suggestions = data.suggestions.filter((s) => !skipped.includes(s.taskId));
  const people = [...data.people].sort((a, b) => b.load.pct - a.load.pct);
  const over = people.filter((p) => p.load.level === 'over').length;
  const late = people.reduce((n, p) => n + p.load.lateTasks, 0);
  const room = people.filter((p) => p.load.level === 'free' || p.load.level === 'light').length;
  const apply = (s: Suggestion) => {
    setApplying(s.taskId);
    update.mutate(
      { id: s.taskId, patch: s.kind === 'REASSIGN' && s.toUserId ? { assigneeId: s.toUserId } : { dueDate: s.date } },
      {
        onSuccess: () => toast.success(s.kind === 'REASSIGN' && s.to ? `Handed to ${s.to.name}. Both have been notified.` : `Due date moved to ${fmtDay(s.date)}. ${s.from.name} has been notified.`),
        onSettled: () => setApplying(null),
      },
    );
  };

  if (!people.length) return <EmptyState icon={<Users />} title="Nobody to plan for yet" description="Add people to a project you lead, or ask an admin to set who reports to you." />;
  return (
    <div className="space-y-9">
      <p className="max-w-3xl text-[15px] leading-relaxed">
        {over > 0 ? (
          <>
            <span className="font-semibold text-danger">{over === 1 ? '1 person has' : `${over} people have`} more work than time</span> in the next two weeks
          </>
        ) : (
          <span className="font-semibold">Everyone&apos;s work fits in the next two weeks</span>
        )}
        {late > 0 ? `, and ${late === 1 ? '1 task is' : `${late} tasks are`} set to finish late` : ''}. {room > 0 ? `${room === 1 ? '1 person has' : `${room} people have`} room to take more.` : 'Nobody has room to spare.'}
      </p>

      {suggestions.length > 0 && (
        <section>
          <SectionTitle icon={<Sparkles />}>
            <span className="inline-flex items-center gap-1.5">
              Ways to even things out
              <InfoHint>Worked out from task sizes, due dates, working days, holidays and approved leave. Only work that has not been started is handed to someone else. Nothing changes until you choose.</InfoHint>
            </span>
          </SectionTitle>
          <ul className="divide-y rounded-xl border">
            {suggestions.map((s) => (
              <SuggestionCard key={s.taskId} s={s} applying={applying === s.taskId} onApply={() => apply(s)} onSkip={() => setSkipped((x) => [...x, s.taskId])} />
            ))}
          </ul>
        </section>
      )}
      {!suggestions.length && (over > 0 || late > 0) && (
        <p className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          There is nothing left to suggest: the work that is late has already been started, or you are not the lead for it. Open a person below to see their queue.
        </p>
      )}

      <section>
        <SectionTitle icon={<Scale />}>
          <span className="inline-flex items-center gap-2">
            Next two weeks, until {fmtDay(data.windowEnd)}
            <Badge tone="muted">{people.length} {people.length === 1 ? 'person' : 'people'}</Badge>
          </span>
        </SectionTitle>
        <ul className="divide-y overflow-hidden rounded-xl border">
          {people.map((row) => (
            <PersonRow key={row.person.id} row={row} data={data} workingDays={workingDays} onOpen={onOpen} />
          ))}
        </ul>
      </section>
    </div>
  );
}
