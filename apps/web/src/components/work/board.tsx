'use client';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { TASK_STATUS_LABELS, type TaskStatus } from '@fg/shared';
import { Hourglass, Plus } from 'lucide-react';
import { useState } from 'react';
import { Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { useUpdateTask, type Task } from '@/lib/work';
import { cn } from '@/lib/utils';
import { BOARD_STATUSES, KindIcon, PriorityIcon, ProjectChip, SizeMark, StatusIcon } from './task-bits';
import { StatusMenu, TaskSignals } from './task-row';

const HINT: Partial<Record<TaskStatus, string>> = {
  BACKLOG: 'Ideas and work for later. Not counted in anyone’s workload.',
  DONE: 'Finished work.',
};

function CardFace({ task, today, showProject, dragging }: { task: Task; today: string; showProject: boolean; dragging?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-surface p-3 shadow-sm transition-shadow', dragging ? 'rotate-1 shadow-lg' : 'hover:shadow-md')}>
      <p className="flex items-start gap-1.5 text-[13px] leading-snug font-medium">
        <KindIcon kind={task.kind} className="mt-[3px]" />
        <span className={cn('min-w-0 flex-1', task.status === 'DONE' && 'text-muted')}>{task.title}</span>
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
        {task.ref && <span className="font-mono text-subtle">{task.ref}</span>}
        {showProject && <ProjectChip project={task.project} className="max-w-32 text-[11px]" />}
        <TaskSignals task={task} today={today} />
        {task.pendingRequest && (
          <span className="inline-flex items-center gap-1 text-warning">
            <Hourglass className="size-3" aria-hidden /> Request waiting
          </span>
        )}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        {task.priority !== 'MEDIUM' && <PriorityIcon priority={task.priority} className="size-3.5" />}
        <SizeMark size={task.size} />
        <span className="flex-1" />
        {task.assignee ? (
          <Tooltip content={task.assignee.name} side="top">
            <span>
              <UserAvatar person={task.assignee} size="xs" showPresence={false} />
            </span>
          </Tooltip>
        ) : (
          <span className="text-[11px] text-subtle">No owner</span>
        )}
      </div>
    </div>
  );
}

function Card({ task, today, showProject, onOpen }: { task: Task; today: string; showProject: boolean; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !task.can.update, data: { status: task.status } });
  // When the card can't be dragged, dnd-kit still returns `aria-disabled="true"`, which blocks
  // the click for touch and screen readers. Drop the drag attrs in that case; opening still works.
  const dragProps = task.can.update ? { ...attributes, ...listeners } : {};
  return (
    <li ref={setNodeRef} className={cn('group relative', isDragging && 'opacity-40')}>
      <div
        {...dragProps}
        role="button"
        tabIndex={0}
        aria-roledescription={task.can.update ? 'Task card. Press Enter to open, or use the status button to move it' : 'Task card'}
        aria-label={`${task.ref ? `${task.ref}: ` : ''}${task.title}. ${TASK_STATUS_LABELS[task.status]}.`}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onOpen(task.id);
          } else listeners?.onKeyDown?.(e);
        }}
        className={cn('block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', task.can.update ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
      >
        <CardFace task={task} today={today} showProject={showProject} />
      </div>
      {/* Moving without dragging: keyboard, touch and screen readers. */}
      {task.can.update && <StatusMenu task={task} className="absolute top-1.5 right-1.5 bg-surface opacity-0 shadow-sm ring-1 ring-border transition group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" />}
    </li>
  );
}

function Column({ status, tasks, today, showProject, onOpen, onAdd }: { status: TaskStatus; tasks: Task[]; today: string; showProject: boolean; onOpen: (id: string) => void; onAdd?: (s: TaskStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} aria-label={`${TASK_STATUS_LABELS[status]}, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`} className={cn('flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl bg-surface-2/60 p-2 transition-colors sm:w-[272px]', isOver && 'bg-primary-soft ring-2 ring-primary/40')}>
      <header className="flex items-center gap-2 px-1.5 pt-1 pb-2">
        <StatusIcon status={status} />
        <h3 className="text-[13px] font-semibold">{TASK_STATUS_LABELS[status]}</h3>
        <span className="text-xs tabular-nums text-muted">{tasks.length}</span>
        <span className="flex-1" />
        {onAdd && status !== 'DONE' && (
          <Tooltip content={`Add a task to ${TASK_STATUS_LABELS[status]}`} side="top">
            <button type="button" onClick={() => onAdd(status)} aria-label={`Add a task to ${TASK_STATUS_LABELS[status]}`} className="grid size-6 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-foreground">
              <Plus className="size-4" />
            </button>
          </Tooltip>
        )}
      </header>
      <ul className="scrollbar-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto">
        {tasks.map((t) => (
          <Card key={t.id} task={t} today={today} showProject={showProject} onOpen={onOpen} />
        ))}
        {!tasks.length && <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-border-strong px-3 py-6 text-center text-xs text-subtle">{HINT[status] ?? 'Nothing here.'}</li>}
      </ul>
    </section>
  );
}

/** Work by stage. Drag a card to another column, or use the status button on the card. */
export function Board({ tasks, today, showProject = true, onOpen, onAdd }: { tasks: Task[]; today: string; showProject?: boolean; onOpen: (id: string) => void; onAdd?: (s: TaskStatus) => void }) {
  const update = useUpdateTask();
  const [dragId, setDragId] = useState<string | null>(null);
  // A small movement threshold keeps a plain click opening the card.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const dragged = tasks.find((t) => t.id === dragId) ?? null;
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const to = e.over?.id as TaskStatus | undefined;
    const task = tasks.find((t) => t.id === e.active.id);
    if (!to || !task || task.status === to) return;
    // Dropped cards go to the bottom of the new column.
    update.mutate({ id: task.id, patch: { status: to, position: Date.now() / 1000 } });
  };
  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragCancel={() => setDragId(null)} onDragEnd={onDragEnd}>
      <div className="scrollbar-thin -mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-3 sm:-mx-10 sm:snap-none sm:px-10" style={{ minHeight: '55dvh' }}>
        {BOARD_STATUSES.map((s) => (
          <Column key={s} status={s} tasks={tasks.filter((t) => t.status === s)} today={today} showProject={showProject} onOpen={onOpen} onAdd={onAdd} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{dragged ? <div className="w-[256px]"><CardFace task={dragged} today={today} showProject={showProject} dragging /></div> : null}</DragOverlay>
    </DndContext>
  );
}
