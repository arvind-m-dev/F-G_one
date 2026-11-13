'use client';
import {
  TASK_KIND_LABELS, TASK_KINDS, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_SIZE_LABELS, TASK_SIZES, TASK_STATUS_LABELS, TASK_STATUSES, taskLinkSchema,
  type TaskKind, type TaskPriority, type TaskSize, type TaskStatus, type UpdateTaskInput,
} from '@fg/shared';
import { useMutation } from '@tanstack/react-query';
import { ExternalLink, GitPullRequest, History, Hourglass, Link2, MessageSquare, Plus, SearchX, Trash2, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useOrgToday } from '@/lib/session';
import { fmtDay, useProject, useRefreshWork, useTask, useUpdateTask, type TaskDetail, type WorkRequest } from '@/lib/work';
import { cn, timeAgo } from '@/lib/utils';
import { ReliefDialog } from './relief-dialog';
import { KindIcon, PersonPicker, StatusIcon } from './task-bits';
import { TaskSignals } from './task-row';

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
const ReadOnly = ({ children }: { children: React.ReactNode }) => <span className="block truncate py-1.5 text-sm">{children}</span>;

function activityText(a: TaskDetail['activity'][number]) {
  const d = a.data as { to?: string | null; kind?: string; decision?: string; requested?: boolean };
  switch (a.kind) {
    case 'created':
      return 'added this task';
    case 'status':
      return `moved it to ${TASK_STATUS_LABELS[d.to as TaskStatus] ?? 'a new status'}`;
    case 'assignee':
      return d.requested ? 'handed it to a new owner, as requested' : d.to ? 'changed the owner' : 'removed the owner';
    case 'due':
      return d.to ? `${d.requested ? 'approved a new due date:' : 'set the due date to'} ${fmtDay(d.to)}` : 'removed the due date';
    case 'size':
      return `changed the size to ${d.to}`;
    case 'priority':
      return `set the priority to ${TASK_PRIORITY_LABELS[d.to as TaskPriority] ?? d.to}`;
    case 'request':
      return d.kind === 'REASSIGN' ? 'asked for someone else to take it' : `asked for more time${d.to ? ` (until ${fmtDay(d.to)})` : ''}`;
    case 'request_decided':
      return d.decision === 'APPROVED' ? 'approved the request' : 'declined the request';
    default:
      return 'updated the task';
  }
}

function PendingRequest({ r, onWithdraw, withdrawing }: { r: WorkRequest; onWithdraw: () => void; withdrawing: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/8 px-3.5 py-3">
      <Hourglass className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px]">
        <span className="font-medium">
          {r.requester.name} {r.kind === 'MOVE_DATE' ? `asked to move this to ${r.proposedDueDate ? fmtDay(r.proposedDueDate) : 'a later date'}` : `asked to hand this over${r.proposedAssignee ? ` to ${r.proposedAssignee.name}` : ''}`}.
        </span>{' '}
        <span className="text-muted">“{r.reason}”</span>
      </p>
      {r.can.cancel && (
        <Button size="sm" variant="outline" loading={withdrawing} onClick={onWithdraw}>
          Withdraw
        </Button>
      )}
      {r.can.decide && (
        <Link href="/app/approvals?tab=work" className="text-[13px] font-medium text-primary hover:underline">
          Decide
        </Link>
      )}
    </div>
  );
}

function Body({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const today = useOrgToday().today();
  const update = useUpdateTask();
  const refresh = useRefreshWork();
  const project = useProject(task.project?.id ?? '', !!task.project && task.can.manage);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [comment, setComment] = useState('');
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [linkError, setLinkError] = useState('');
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description ?? ''), [task.description]);

  const patch = (p: UpdateTaskInput) => update.mutate({ id: task.id, patch: p });
  const manage = task.can.manage;
  const edit = task.can.update;
  const pending = task.requests.find((r) => r.status === 'PENDING');
  const lastDecided = !pending ? task.requests.find((r) => r.status === 'DECLINED' || r.status === 'APPROVED') : undefined;

  const addComment = useMutation({
    mutationFn: () => api(`/work/tasks/${task.id}/comments`, { body: { body: comment } }),
    onSuccess: () => {
      setComment('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api(`/work/requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Request withdrawn');
      refresh();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/work/tasks/${task.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Task deleted');
      setDeleting(false);
      onClose();
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveLink = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = taskLinkSchema.safeParse(link);
    if (!parsed.success) {
      setLinkError(parsed.error.issues[0]?.message ?? 'Enter a full web address');
      return;
    }
    patch({ links: [...task.links, parsed.data] });
    setLink(null);
    setLinkError('');
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <KindIcon kind={task.kind} /> {TASK_KIND_LABELS[task.kind]}
          </span>
          {task.ref && <span className="font-mono text-[11px]">{task.ref}</span>}
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/app/work?task=${task.id}`).then(() => toast.success('Link copied'), () => toast.error("Couldn't copy"))}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-surface-2 hover:text-foreground"
            aria-label="Copy a link to this task"
          >
            <Link2 className="size-3" /> Copy link
          </button>
          <TaskSignals task={task} today={today} />
        </p>
        {manage ? (
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim();
              if (t.length >= 2 && t !== task.title) patch({ title: t });
              else setTitle(task.title);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            rows={1}
            maxLength={200}
            aria-label="Task title"
            className="mt-1.5 -ml-1.5 w-[calc(100%+0.75rem)] resize-none rounded-md bg-transparent px-1.5 py-1 text-lg leading-snug font-semibold outline-none transition [field-sizing:content] hover:bg-surface-2 focus:bg-surface-2"
          />
        ) : (
          <h3 className="mt-1.5 text-lg leading-snug font-semibold">{task.title}</h3>
        )}
      </div>

      {pending && <PendingRequest r={pending} onWithdraw={() => withdraw.mutate(pending.id)} withdrawing={withdraw.isPending} />}
      {lastDecided?.status === 'DECLINED' && (
        <p className="rounded-xl border px-3.5 py-3 text-[13px] text-muted">
          {lastDecided.decider?.name ?? 'Your lead'} declined the last request{lastDecided.decisionNote ? `: “${lastDecided.decisionNote}”` : '.'}
        </p>
      )}
      {!pending && task.plan?.late && task.dueDate && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/6 px-3.5 py-3">
          <TriangleAlert className="size-4 shrink-0 text-danger" aria-hidden />
          <p className="min-w-0 flex-1 text-[13px]">
            With the work queued ahead of it, this finishes around <span className="font-medium">{fmtDay(task.plan.end, { weekday: true })}</span>, after its due date of {fmtDay(task.dueDate)}.
          </p>
          {task.can.request && (
            <Button size="sm" onClick={() => setAsking(true)}>
              Ask for more time
            </Button>
          )}
        </div>
      )}

      <dl className="space-y-1.5">
        <Prop label="Status">
          {edit ? (
            <Select value={task.status} onChange={(e) => patch({ status: e.target.value as TaskStatus })} aria-label="Status">
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          ) : (
            <ReadOnly>
              <span className="inline-flex items-center gap-2">
                <StatusIcon status={task.status} /> {TASK_STATUS_LABELS[task.status]}
              </span>
            </ReadOnly>
          )}
        </Prop>
        <Prop label="Owner">
          <PersonPicker
            value={task.assignee}
            onChange={(p) => (p?.id ?? null) !== (task.assignee?.id ?? null) && patch({ assigneeId: p?.id ?? null })}
            options={task.project ? (project.data?.members ?? []) : undefined}
            allowNone={!!task.project}
            noneLabel="No one yet"
            disabled={!manage}
          />
        </Prop>
        <Prop label="Due">
          {manage ? (
            <Input type="date" value={task.dueDate ?? ''} min={task.startDate ?? undefined} onChange={(e) => patch({ dueDate: e.target.value || null })} aria-label="Due date" />
          ) : (
            <span className="flex items-center justify-between gap-2">
              <ReadOnly>{task.dueDate ? fmtDay(task.dueDate, { weekday: true }) : 'No date'}</ReadOnly>
              {task.can.request && !task.plan?.late && (
                <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
                  Ask for more time
                </Button>
              )}
            </span>
          )}
        </Prop>
        <Prop label="Start">
          {edit ? (
            <Input type="date" value={task.startDate ?? ''} max={task.dueDate ?? undefined} onChange={(e) => patch({ startDate: e.target.value || null })} aria-label="Start date" />
          ) : (
            <ReadOnly>{task.startDate ? fmtDay(task.startDate, { weekday: true }) : 'Any time'}</ReadOnly>
          )}
        </Prop>
        <Prop label="Size">
          {manage ? (
            <Select value={task.size} onChange={(e) => patch({ size: e.target.value as TaskSize })} aria-label="Size">
              {TASK_SIZES.map((s) => (
                <option key={s} value={s}>
                  {TASK_SIZE_LABELS[s]}
                </option>
              ))}
            </Select>
          ) : (
            <ReadOnly>{TASK_SIZE_LABELS[task.size]}</ReadOnly>
          )}
        </Prop>
        <Prop label="Priority">
          {manage ? (
            <Select value={task.priority} onChange={(e) => patch({ priority: e.target.value as TaskPriority })} aria-label="Priority">
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          ) : (
            <ReadOnly>{TASK_PRIORITY_LABELS[task.priority]}</ReadOnly>
          )}
        </Prop>
        {manage && (
          <Prop label="Kind">
            <Select value={task.kind} onChange={(e) => patch({ kind: e.target.value as TaskKind })} aria-label="Kind of work">
              {TASK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TASK_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Prop>
        )}
        <Prop label="Project">
          {task.project ? (
            <Link href={`/app/work/projects/${task.project.id}`} className="inline-flex max-w-full items-center gap-2 py-1.5 text-sm hover:underline">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: task.project.color }} aria-hidden />
              <span className="truncate">{task.project.name}</span>
            </Link>
          ) : (
            <ReadOnly>Personal task</ReadOnly>
          )}
        </Prop>
      </dl>

      <section>
        <label htmlFor="tp-desc" className="mb-1.5 block text-[13px] font-semibold">
          Details
        </label>
        {edit ? (
          <Textarea
            id="tp-desc"
            rows={4}
            value={description}
            maxLength={8000}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description.trim() !== (task.description ?? '') && patch({ description: description.trim() || null })}
            placeholder="Add anything that helps: what done looks like, where to find things"
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap text-muted">{task.description || 'No details were added.'}</p>
        )}
      </section>

      <section>
        <SectionTitle
          icon={<Link2 />}
          action={
            edit && !link && task.links.length < 10 ? (
              <Button size="sm" variant="ghost" onClick={() => setLink({ label: '', url: '' })}>
                <Plus /> Add a link
              </Button>
            ) : undefined
          }
        >
          Links
        </SectionTitle>
        {task.links.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {task.links.map((l, i) => {
              const pr = /\/(pull|merge_requests)\/\d+/.test(l.url);
              let host = l.url;
              try {
                host = new URL(l.url).hostname.replace(/^www\./, '');
              } catch {
                /* shown as typed */
              }
              return (
                <li key={`${l.url}-${i}`} className="flex items-center gap-2.5 px-3 py-2">
                  {pr ? <GitPullRequest className="size-4 shrink-0 text-muted" aria-hidden /> : <ExternalLink className="size-4 shrink-0 text-muted" aria-hidden />}
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[13px] hover:underline">
                    <span className="font-medium">{l.label || (pr ? 'Pull request' : host)}</span> <span className="text-xs text-subtle">{host}</span>
                  </a>
                  {edit && (
                    <button type="button" onClick={() => patch({ links: task.links.filter((_, j) => j !== i) })} aria-label={`Remove link ${l.label || host}`} className="rounded-md p-1 text-subtle transition hover:bg-surface-2 hover:text-foreground">
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {link ? (
          <form onSubmit={saveLink} className={cn('space-y-2', task.links.length > 0 && 'mt-2')}>
            <div className="grid gap-2 sm:grid-cols-[1fr_1.6fr]">
              <Input value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} placeholder="Name (optional)" aria-label="Link name" maxLength={80} />
              <Input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://github.com/…/pull/12" aria-label="Web address" aria-invalid={!!linkError} autoFocus />
            </div>
            {linkError && <p className="text-xs text-danger" role="alert">{linkError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { setLink(null); setLinkError(''); }}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Add link
              </Button>
            </div>
          </form>
        ) : (
          !task.links.length && <p className="text-xs text-muted">Pull requests, designs or documents for this task.</p>
        )}
      </section>

      <section>
        <SectionTitle icon={<MessageSquare />}>Comments {task.comments.length ? `(${task.comments.length})` : ''}</SectionTitle>
        {task.comments.length > 0 && (
          <ul className="mb-3 space-y-3">
            {task.comments.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                {c.author ? <UserAvatar person={c.author} size="sm" showPresence={false} /> : <span className="size-8 shrink-0 rounded-full bg-surface-2" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">
                    <span className="font-semibold">{c.author?.name ?? 'Former colleague'}</span> <span className="text-xs text-muted">· {timeAgo(c.createdAt)}</span>
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) addComment.mutate();
          }}
        >
          <Textarea
            rows={2}
            value={comment}
            maxLength={4000}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && comment.trim()) {
                e.preventDefault();
                addComment.mutate();
              }
            }}
            placeholder="Write a comment"
            aria-label="Write a comment"
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={!comment.trim()} loading={addComment.isPending}>
              Comment
            </Button>
          </div>
        </form>
      </section>

      <section>
        <SectionTitle icon={<History />}>History</SectionTitle>
        <ul className="space-y-1.5">
          {task.activity.map((a) => (
            <li key={a.id} className="text-xs text-muted">
              <span className="font-medium text-foreground/80">{a.actor?.name ?? 'Someone'}</span> {activityText(a)} · {timeAgo(a.createdAt)}
            </li>
          ))}
        </ul>
      </section>

      {manage && (
        <div className="border-t pt-4">
          <Button variant="ghost" className="text-danger hover:bg-danger/8 hover:text-danger" onClick={() => setDeleting(true)}>
            <Trash2 /> Delete task
          </Button>
        </div>
      )}

      <ReliefDialog task={asking ? task : null} onClose={() => setAsking(false)} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this task?"
        description={`“${task.title}” and its comments will be removed for everyone. This cannot be undone.`}
        confirmLabel="Delete task"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

/** Slide-over with everything about one task. Opened from any work view through `?task=<id>`. */
export function TaskPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const task = useTask(id);
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()} title={<span className="text-sm font-medium text-muted">Task</span>} side="right" className="max-w-xl">
      {task.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-56" />
          <Skeleton className="h-24" />
        </div>
      ) : task.isError ? (
        <EmptyState icon={<SearchX />} title="This task isn't available" description="It may have been deleted, or it belongs to a project you are not part of." action={<Button variant="outline" onClick={onClose}>Close</Button>} />
      ) : (
        <Body key={task.data.id} task={task.data} onClose={onClose} />
      )}
    </Dialog>
  );
}
