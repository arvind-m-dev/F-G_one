'use client';
import { workRequestSchema, type WorkRequestKind } from '@fg/shared';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Handshake } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useOrgToday } from '@/lib/session';
import { addDaysYmd, fmtDay, loadSentence, useRefreshWork, useRelief, type Task } from '@/lib/work';
import { cn } from '@/lib/utils';
import { LoadMeter } from './task-bits';

/**
 * "I can't finish this on time." Shows what the plan says, then lets the owner ask for a later
 * date or for a colleague to take the task. A lead or manager decides.
 */
export function ReliefDialog({ task, onClose }: { task: Pick<Task, 'id' | 'title' | 'ref' | 'dueDate'> | null; onClose: () => void }) {
  const relief = useRelief(task?.id ?? null);
  const refresh = useRefreshWork();
  const today = useOrgToday().today();
  const [kind, setKind] = useState<WorkRequestKind>('MOVE_DATE');
  const [date, setDate] = useState('');
  const [personId, setPersonId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const r = relief.data;
  const minDate = task?.dueDate && task.dueDate >= today ? addDaysYmd(task.dueDate, 1) : today;

  useEffect(() => {
    if (!task) return;
    setKind('MOVE_DATE');
    setPersonId('');
    setReason('');
    setErrors({});
    setDate('');
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Start from the date the plan says is realistic.
  useEffect(() => {
    if (r && !date) setDate(r.expectedEnd && r.expectedEnd >= minDate ? r.expectedEnd : minDate);
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (body: unknown) => api(`/work/tasks/${task!.id}/requests`, { body }),
    onSuccess: () => {
      toast.success(`Request sent${r?.approvers[0] ? ` to ${r.approvers[0].name}` : ''}`);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = workRequestSchema.safeParse({ kind, reason, proposedDueDate: kind === 'MOVE_DATE' ? date || null : null, proposedAssigneeId: kind === 'REASSIGN' ? personId || null : null });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'reason'), i.message])));
      return;
    }
    if (kind === 'MOVE_DATE' && date < minDate) {
      setErrors({ proposedDueDate: task?.dueDate ? 'Choose a date after the current due date' : 'Choose a date from today onwards' });
      return;
    }
    setErrors({});
    send.mutate(parsed.data);
  };
  const approver = r?.approvers[0];
  const options: { value: WorkRequestKind; icon: typeof CalendarClock; title: string; text: string }[] = [
    { value: 'MOVE_DATE', icon: CalendarClock, title: 'Move the date', text: 'Keep the task and finish it later.' },
    { value: 'REASSIGN', icon: Handshake, title: 'Hand it over', text: 'Ask for a colleague to take it.' },
  ];

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()} title="Ask for more time" description={task ? `${task.ref ? `${task.ref} · ` : ''}${task.title}` : undefined} className="max-w-xl">
      {relief.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-28" />
        </div>
      ) : relief.isError || !r ? (
        <EmptyState title="This couldn't be loaded" description={errorMessage(relief.error)} action={<Button variant="outline" onClick={() => void relief.refetch()}>Try again</Button>} />
      ) : !r.approvers.length ? (
        <EmptyState title="Nobody can decide on this yet" description="This task has no project lead and you have no manager set. Ask an admin to set your manager, then try again." />
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <section className="rounded-xl border bg-surface p-4" aria-label="What your plan looks like">
            {r.load && (
              <>
                <p className="text-[13px]">{loadSentence(r.load)}</p>
                <LoadMeter load={r.load} className="mt-2.5" showLabel={false} />
              </>
            )}
            <p className={cn('text-[13px]', r.load && 'mt-3', r.late ? 'text-danger' : 'text-muted')}>
              {r.expectedEnd
                ? r.late && r.dueDate
                  ? `With the work already ahead of it, this task finishes around ${fmtDay(r.expectedEnd, { weekday: true })}. It is due ${fmtDay(r.dueDate, { weekday: true })}.`
                  : `With the work already ahead of it, this task finishes around ${fmtDay(r.expectedEnd, { weekday: true })}${r.dueDate ? `, in time for ${fmtDay(r.dueDate)}` : ''}.`
                : 'This task is not in your plan yet.'}
            </p>
          </section>

          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What would help">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={kind === o.value}
                onClick={() => setKind(o.value)}
                className={cn('flex items-start gap-3 rounded-xl border p-3 text-left transition', kind === o.value ? 'border-primary bg-primary-soft' : 'border-border-strong hover:bg-surface-2')}
              >
                <o.icon className={cn('mt-0.5 size-4 shrink-0', kind === o.value ? 'text-primary' : 'text-muted')} aria-hidden />
                <span>
                  <span className="block text-[13px] font-semibold">{o.title}</span>
                  <span className="block text-xs text-muted">{o.text}</span>
                </span>
              </button>
            ))}
          </div>

          {kind === 'MOVE_DATE' ? (
            <Field label="New due date" htmlFor="r-date" error={errors.proposedDueDate} hint={r.expectedEnd && r.expectedEnd >= minDate ? `${fmtDay(r.expectedEnd)} is the earliest date your plan can meet.` : undefined}>
              <Input id="r-date" type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} className="sm:max-w-56" aria-invalid={!!errors.proposedDueDate} />
            </Field>
          ) : (
            <fieldset>
              <legend className="text-[13px] font-medium">Who could take it?</legend>
              <ul className="mt-1.5 divide-y rounded-xl border" role="radiogroup" aria-label="Who could take it">
                <li>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                    <input type="radio" name="r-person" className="accent-[var(--primary)]" checked={personId === ''} onChange={() => setPersonId('')} />
                    <span className="text-[13px]">Let {approver!.name} choose</span>
                  </label>
                </li>
                {r.candidates.map((c) => (
                  <li key={c.userId}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input type="radio" name="r-person" className="accent-[var(--primary)]" checked={personId === c.userId} onChange={() => setPersonId(c.userId)} />
                      <UserAvatar person={c.person} size="sm" showPresence={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{c.person.name}</span>
                        <span className={cn('block text-xs', c.late ? 'text-warning' : 'text-muted')}>
                          {c.pct}% busy now, {c.pctAfter}% with this · could finish by {fmtDay(c.finishBy)}
                          {c.late ? ', after the due date' : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {!r.candidates.length && <p className="mt-1.5 text-xs text-muted">Nobody else is on this {task?.ref ? 'project' : 'team'} yet, so {approver!.name} will need to find someone.</p>}
            </fieldset>
          )}

          <Field label="Why?" htmlFor="r-reason" error={errors.reason} hint="One or two sentences. It is shown with your request.">
            <Textarea id="r-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The release took three days longer than planned" aria-invalid={!!errors.reason} />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-muted">
              <UserAvatar person={approver!} size="xs" showPresence={false} />
              {approver!.name} decides. Nothing changes until then.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={send.isPending}>
                Send request
              </Button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}
