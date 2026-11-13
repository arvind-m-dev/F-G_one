'use client';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Check, Handshake, ListTodo, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { fmtDay, useRefreshWork, useRelief, useWorkRequests, type MiniPerson, type WorkRequest } from '@/lib/work';
import { cn, timeAgo } from '@/lib/utils';

/** Approve or decline one request. For a handover the approver confirms, or chooses, who takes the task. */
function DecideDialog({ pending, onClose }: { pending: { r: WorkRequest; decision: 'APPROVED' | 'REJECTED' } | null; onClose: () => void }) {
  const refresh = useRefreshWork();
  const r = pending?.r;
  const approving = pending?.decision === 'APPROVED';
  const handover = !!r && r.kind === 'REASSIGN' && approving;
  const relief = useRelief(handover ? r.task.id : null);
  const [note, setNote] = useState('');
  const [personId, setPersonId] = useState<string | null>(null);
  const chosen = personId ?? r?.proposedAssignee?.id ?? null;
  const close = () => {
    setNote('');
    setPersonId(null);
    onClose();
  };
  const decide = useMutation({
    mutationFn: () => api(`/work/requests/${r!.id}/decision`, { body: { decision: pending!.decision, note: note || null, ...(handover ? { assigneeId: chosen } : {}) } }),
    onSuccess: () => {
      toast.success(`${approving ? 'Approved' : 'Declined'}. ${r!.requester.name} has been notified.`);
      close();
      refresh();
    },
    // Already decided by someone else, or withdrawn: close and show the current list.
    onError: (e) => {
      toast.error(errorMessage(e));
      close();
      refresh();
    },
  });
  // The person asking may have named someone; otherwise offer the people the planner found.
  const people: { person: MiniPerson; detail: string; late: boolean }[] = (relief.data?.candidates ?? []).map((c) => ({ person: c.person, detail: `${c.pct}% busy now, ${c.pctAfter}% with this · could finish by ${fmtDay(c.finishBy)}`, late: c.late }));
  return (
    <Dialog
      open={!!pending}
      onOpenChange={(o) => !o && close()}
      title={approving ? (r?.kind === 'REASSIGN' ? 'Hand this task over?' : 'Approve the new date?') : 'Decline this request?'}
      description={r ? `${r.task.ref ? `${r.task.ref} · ` : ''}${r.task.title}` : undefined}
      className="max-w-md"
    >
      {handover && (
        <fieldset className="mb-4">
          <legend className="text-[13px] font-medium">Who takes it?</legend>
          {relief.isPending ? (
            <Skeleton className="mt-1.5 h-24" />
          ) : people.length ? (
            <ul className="mt-1.5 divide-y rounded-xl border">
              {people.map((p) => (
                <li key={p.person.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                    <input type="radio" name="d-person" className="accent-[var(--primary)]" checked={chosen === p.person.id} onChange={() => setPersonId(p.person.id)} />
                    <UserAvatar person={p.person} size="sm" showPresence={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {p.person.name}
                        {r?.proposedAssignee?.id === p.person.id && <span className="font-normal text-muted"> · suggested by {r.requester.name}</span>}
                      </span>
                      <span className={cn('block text-xs', p.late ? 'text-warning' : 'text-muted')}>
                        {p.detail}
                        {p.late ? ', after the due date' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 rounded-xl border border-dashed px-3 py-3 text-xs text-muted">
              Nobody else is available for this task. {r?.task.project ? 'Add someone to the project first, then come back.' : 'Decline, or open the task and choose a new owner yourself.'}
            </p>
          )}
        </fieldset>
      )}
      <Field label="Note (optional)" htmlFor="wd-note">
        <Textarea id="wd-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={approving ? 'e.g. Fine, keep me posted' : 'e.g. The launch date is fixed. Can we cut scope instead?'} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button variant={approving ? 'primary' : 'danger'} loading={decide.isPending} disabled={handover && !chosen} onClick={() => decide.mutate()}>
          {approving ? (r?.kind === 'REASSIGN' ? 'Hand over' : 'Approve') : 'Decline'}
        </Button>
      </div>
    </Dialog>
  );
}

/** Timeline requests waiting for the viewer's decision. Shown on the Approvals page. */
export function WorkRequestsSection() {
  const requests = useWorkRequests('approvals', 'PENDING');
  const [pending, setPending] = useState<{ r: WorkRequest; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  return (
    <section id="work">
      <SectionTitle icon={<ListTodo />}>Work requests {requests.data?.length ? `(${requests.data.length})` : ''}</SectionTitle>
      {requests.isPending ? (
        <Skeleton className="h-24" />
      ) : requests.isError ? (
        <p role="alert" className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-danger">
          {errorMessage(requests.error)}
        </p>
      ) : !requests.data.length ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted">Nobody is asking for more time or a handover.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {requests.data.map((r) => {
            const Icon = r.kind === 'MOVE_DATE' ? CalendarClock : Handshake;
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-4 sm:flex-nowrap">
                <UserAvatar person={r.requester} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">
                    <span className="font-semibold">{r.requester.name}</span> <span className="text-muted">· {timeAgo(r.createdAt)}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                    {r.kind === 'MOVE_DATE' ? `Move the due date${r.previousDueDate ? ` from ${fmtDay(r.previousDueDate)}` : ''} to ${fmtDay(r.proposedDueDate!, { weekday: true })}` : `Hand over${r.proposedAssignee ? ` to ${r.proposedAssignee.name}` : ' to someone with room'}`}
                  </p>
                  <Link href={`/app/work?task=${r.task.id}`} className="text-xs text-muted hover:text-foreground hover:underline">
                    {r.task.ref ? `${r.task.ref} · ` : ''}
                    {r.task.title}
                    {r.task.project ? ` · ${r.task.project.name}` : ''}
                  </Link>
                  <p className="mt-1.5 rounded-lg bg-surface-2/70 px-3 py-2 text-[13px]">“{r.reason}”</p>
                  {r.rationale && <p className="mt-1.5 text-xs text-muted">{r.rationale}</p>}
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setPending({ r, decision: 'REJECTED' })}>
                    <X /> Decline
                  </Button>
                  <Button className="flex-1 sm:flex-none" onClick={() => setPending({ r, decision: 'APPROVED' })}>
                    <Check /> Approve
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <DecideDialog pending={pending} onClose={() => setPending(null)} />
    </section>
  );
}
