'use client';
import { TASK_STATUS_LABELS, type TaskStatus } from '@fg/shared';
import { Check, Clock3, Hourglass, MessageSquare, TriangleAlert } from 'lucide-react';
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import { Badge, Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { dueLabel, fmtDay, useUpdateTask, type Task } from '@/lib/work';
import { cn } from '@/lib/utils';
import { BOARD_STATUSES, KindIcon, PriorityIcon, ProjectChip, SizeMark, STATUS_ICON, STATUS_TONE, StatusIcon } from './task-bits';

const TONE: Record<string, string> = { danger: 'text-danger', warning: 'text-warning', muted: 'text-muted', success: 'text-success' };

/** The status icon as a menu: one click to move a task along. Read-only when you may not change it. */
export function StatusMenu({ task, className }: { task: Pick<Task, 'id' | 'status' | 'title' | 'can'>; className?: string }) {
  const update = useUpdateTask();
  if (!task.can.update) return <StatusIcon status={task.status} className={className} />;
  const options: TaskStatus[] = [...BOARD_STATUSES, 'CANCELLED'];
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={`${task.title}: ${TASK_STATUS_LABELS[task.status]}. Change status`}
          className={cn('grid size-7 shrink-0 place-items-center rounded-md outline-none transition hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring', className)}
        >
          <StatusIcon status={task.status} />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownLabel>Move to</DropdownLabel>
        {options.map((s) => {
          const Icon = STATUS_ICON[s];
          return (
            <DropdownItem key={s} onSelect={() => s !== task.status && update.mutate({ id: task.id, patch: { status: s } })}>
              <Icon className={cn('!text-current', STATUS_TONE[s])} />
              <span className="flex-1">{TASK_STATUS_LABELS[s]}</span>
              {s === task.status && <Check className="!size-3.5" />}
            </DropdownItem>
          );
        })}
      </DropdownContent>
    </DropdownMenu>
  );
}

/** Small facts under a task title: when it is due, and whether the plan can meet that. */
export function TaskSignals({ task, today }: { task: Task; today: string }) {
  const due = dueLabel(task, today);
  const atRisk = task.plan?.late && !task.overdue;
  return (
    <>
      {due && (
        <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', TONE[due.tone])}>
          <Clock3 className="size-3" aria-hidden />
          {due.text}
        </span>
      )}
      {atRisk && (
        <Tooltip content={`With the work already queued, this finishes around ${fmtDay(task.plan!.end)}.`} side="top">
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-warning">
            <TriangleAlert className="size-3" aria-hidden />
            Likely {fmtDay(task.plan!.end)}
          </span>
        </Tooltip>
      )}
    </>
  );
}

export function TaskRow({ task, today, onOpen, showOwner }: { task: Task; today: string; onOpen: (id: string) => void; showOwner?: boolean }) {
  const closed = task.status === 'DONE' || task.status === 'CANCELLED';
  return (
    <li className="group flex items-center gap-1.5 px-2 py-1.5 transition-colors hover:bg-surface-2/50 sm:gap-2.5 sm:px-3">
      <StatusMenu task={task} />
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-1.5">
          <KindIcon kind={task.kind} />
          <span className={cn('truncate text-[13.5px] font-medium', closed && 'text-muted line-through decoration-border-strong')}>{task.title}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {task.ref && <span className="font-mono text-[11px] text-subtle">{task.ref}</span>}
          <ProjectChip project={task.project} className="max-w-40" />
          <TaskSignals task={task} today={today} />
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" aria-hidden />
              {task.commentCount}
            </span>
          )}
        </span>
      </button>
      {task.pendingRequest && (
        <Badge tone="warning" className="hidden sm:inline-flex">
          <Hourglass className="size-3" aria-hidden /> Waiting for a decision
        </Badge>
      )}
      {task.priority !== 'MEDIUM' && <PriorityIcon priority={task.priority} />}
      <SizeMark size={task.size} className="hidden sm:inline-flex" />
      {showOwner &&
        (task.assignee ? (
          <Tooltip content={task.assignee.name} side="top">
            <span>
              <UserAvatar person={task.assignee} size="xs" showPresence={false} />
            </span>
          </Tooltip>
        ) : (
          <Tooltip content="No owner yet" side="top">
            <span className="grid size-6 place-items-center rounded-full border border-dashed border-border-strong text-[10px] text-subtle" aria-label="No owner yet">
              ?
            </span>
          </Tooltip>
        ))}
    </li>
  );
}
