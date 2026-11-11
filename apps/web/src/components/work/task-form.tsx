'use client';
import { TASK_KIND_LABELS, TASK_KINDS, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_SIZE_LABELS, TASK_SIZES, taskSchema, type TaskKind, type TaskPriority, type TaskSize, type TaskStatus } from '@fg/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useProjects, useRefreshWork, useWorkSummary, type MiniPerson, type Task } from '@/lib/work';
import { cn } from '@/lib/utils';
import { KindIcon, PersonPicker } from './task-bits';

export interface NewTaskDefaults {
  projectId?: string;
  status?: TaskStatus;
  assignee?: MiniPerson | null;
}

/** Add a task. Personal by default; inside a project it gets the project's next number. */
export function NewTaskDialog({ open, onOpenChange, defaults, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: NewTaskDefaults; onCreated?: (t: Task) => void }) {
  const me = useSession();
  const self: MiniPerson = { id: me.user.id, name: me.user.name, designation: me.user.designation, avatarUrl: me.user.avatarUrl, avatarColor: me.user.avatarColor };
  const summary = useWorkSummary(open);
  const projects = useProjects('active', open);
  const refresh = useRefreshWork();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assignee, setAssignee] = useState<MiniPerson | null>(self);
  const [kind, setKind] = useState<TaskKind>('TASK');
  const [size, setSize] = useState<TaskSize>('M');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setProjectId(defaults?.projectId ?? '');
    setAssignee(defaults?.assignee === undefined ? self : defaults.assignee);
    setKind('TASK');
    setSize('M');
    setPriority('MEDIUM');
    setStartDate('');
    setDueDate('');
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const project = projects.data?.find((p) => p.id === projectId) ?? null;
  const leads = !!project && (project.can.manage || summary.data?.can.reach === 'ORG');
  // Who you may give the task to: anyone on a project you lead, yourself otherwise; managers can search for a personal task.
  const canChooseOwner = project ? leads : !!summary.data?.can.reach;
  const ownerOptions = project ? project.members : undefined;

  const create = useMutation({
    mutationFn: (body: unknown) => api<Task>('/work/tasks', { body }),
    onSuccess: (t) => {
      toast.success(t.ref ? `${t.ref} added` : 'Task added');
      refresh();
      onOpenChange(false);
      onCreated?.(t);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues?.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      else toast.error(errorMessage(e));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = taskSchema.safeParse({
      title,
      description: description || null,
      projectId: projectId || null,
      kind,
      size,
      priority,
      status: defaults?.status ?? 'TODO',
      assigneeId: assignee?.id ?? null,
      startDate: startDate || null,
      dueDate: dueDate || null,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'title'), i.message])));
      return;
    }
    if (!projectId && !assignee) {
      setErrors({ assigneeId: 'A personal task needs an owner' });
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New task" description="Write down what needs doing. You can fill in the rest later." className="max-w-xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="What needs doing?" htmlFor="t-title" error={errors.title}>
          <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fix the sign-in error on mobile" maxLength={200} autoFocus aria-invalid={!!errors.title} />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of work">
          {TASK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition', kind === k ? 'border-primary bg-primary-soft text-primary-ink' : 'border-border-strong text-muted hover:bg-surface-2')}
            >
              <KindIcon kind={k} className={kind === k ? '' : 'text-subtle'} /> {TASK_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" htmlFor="t-project" error={errors.projectId} hint={projectId ? undefined : 'Personal tasks are seen by you and your manager.'}>
            <Select
              id="t-project"
              value={projectId}
              onChange={(e) => {
                const next = e.target.value;
                setProjectId(next);
                const p = projects.data?.find((x) => x.id === next);
                // Keep the owner only if they are on the newly chosen project.
                if (p && assignee && !p.members.some((m) => m.id === assignee.id)) setAssignee(p.members.some((m) => m.id === self.id) ? self : null);
                if (!p && !assignee) setAssignee(self);
              }}
            >
              <option value="">Personal (no project)</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" error={errors.assigneeId} hint={canChooseOwner ? undefined : project ? 'The project lead can give it to someone else.' : undefined}>
            {canChooseOwner ? (
              <PersonPicker value={assignee} onChange={setAssignee} options={ownerOptions} allowNone={!!project} noneLabel="Decide later" />
            ) : project ? (
              <Select value={assignee ? 'me' : ''} onChange={(e) => setAssignee(e.target.value ? self : null)} aria-label="Owner">
                <option value="me">Me</option>
                <option value="">Decide later</option>
              </Select>
            ) : (
              <PersonPicker value={self} onChange={() => undefined} disabled />
            )}
          </Field>
          <Field label="How big is it?" htmlFor="t-size" hint="A rough guess is enough. It is used to plan workloads.">
            <Select id="t-size" value={size} onChange={(e) => setSize(e.target.value as TaskSize)}>
              {TASK_SIZES.map((s) => (
                <option key={s} value={s}>
                  {TASK_SIZE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="t-priority">
            <Select id="t-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start (optional)" htmlFor="t-start" error={errors.startDate}>
            <Input id="t-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Due (optional)" htmlFor="t-due" error={errors.dueDate}>
            <Input id="t-due" type="date" value={dueDate} min={startDate || undefined} onChange={(e) => setDueDate(e.target.value)} aria-invalid={!!errors.dueDate} />
          </Field>
        </div>
        <Field label="Details (optional)" htmlFor="t-desc" error={errors.description}>
          <Textarea id="t-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={8000} placeholder="Anything that helps whoever picks this up" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
