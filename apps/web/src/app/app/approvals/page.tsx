'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, TreePalm, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { LOCATION_LABEL } from '@/components/attendance/attendance-panel';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { WorkRequestsSection } from '@/components/work/requests-section';
import { api, errorMessage } from '@/lib/api';
import { fmtDays, fmtRange, useApprovalsCount, useCorrections, useLeaveRequests } from '@/lib/hooks';
import type { Person } from '@/lib/types';
import { useClock } from '@/lib/session';
import { fmtDate, timeAgo } from '@/lib/utils';

type Decision = { kind: 'leave' | 'correction'; id: string; who: string; decision: 'APPROVED' | 'REJECTED' };

function Row({ person, title, detail, reason, at, onDecide }: { person: Person; title: string; detail: string; reason?: string | null; at: string; onDecide: (d: 'APPROVED' | 'REJECTED') => void }) {
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-4 sm:flex-nowrap">
      <UserAvatar person={person} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-semibold">{person.name}</span> <span className="text-muted">· {timeAgo(at)}</span>
        </p>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted">{detail}</p>
        {reason && <p className="mt-1.5 rounded-lg bg-surface-2/70 px-3 py-2 text-[13px]">“{reason}”</p>}
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onDecide('REJECTED')}>
          <X /> Decline
        </Button>
        <Button className="flex-1 sm:flex-none" onClick={() => onDecide('APPROVED')}>
          <Check /> Approve
        </Button>
      </div>
    </li>
  );
}

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const count = useApprovalsCount();
  const { hm } = useClock();
  const can = count.data?.canApprove ?? false;
  const leave = useLeaveRequests('approvals', 'PENDING', can);
  const corrections = useCorrections('approvals', can);
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const refresh = () => {
    for (const k of ['leave-requests', 'corrections', 'approvals-count', 'leave-calendar', 'attendance-board', 'leave-balances']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const close = () => {
    setPending(null);
    setNote('');
  };
  const decide = useMutation({
    mutationFn: (d: Decision) => api(d.kind === 'leave' ? `/leave/requests/${d.id}/decision` : `/attendance/corrections/${d.id}/decision`, { body: { decision: d.decision, note: note || null } }),
    onSuccess: (_r, d) => {
      toast.success(`${d.decision === 'APPROVED' ? 'Approved' : 'Declined'} — ${d.who} has been notified`);
      close();
      refresh();
    },
    // Already decided by someone else, or cancelled: close and show the current list.
    onError: (e) => {
      toast.error(errorMessage(e));
      close();
      refresh();
    },
  });

  return (
    <div className="mx-auto max-w-[900px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader className="px-0 pt-0 sm:px-0" title="Approvals" description="Leave, attendance corrections and work requests from your team that need a decision." />
      {count.isPending ? (
        <Skeleton className="h-40" />
      ) : count.isError && !count.data ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="Approvals couldn't be loaded"
          description={errorMessage(count.error)}
          action={
            <Button variant="outline" loading={count.isFetching} onClick={() => void count.refetch()}>
              Try again
            </Button>
          }
        />
      ) : !can ? (
        <EmptyState icon={<ClipboardCheck />} title="Nothing to approve" description="Requests from people who report to you will appear here." />
      ) : (
        <div className="space-y-10">
          <section>
            <SectionTitle icon={<TreePalm />}>Leave requests {leave.data?.length ? `(${leave.data.length})` : ''}</SectionTitle>
            {leave.isPending ? (
              <Skeleton className="h-24" />
            ) : leave.isError ? (
              <EmptyState className="rounded-xl border border-dashed" title="Leave requests couldn't be loaded" description={errorMessage(leave.error)} action={<Button variant="outline" onClick={() => void leave.refetch()}>Try again</Button>} />
            ) : !leave.data?.length ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted">No leave waiting for you.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {leave.data.map((r) => (
                  <Row
                    key={r.id}
                    person={r.person}
                    at={r.createdAt}
                    title={`${r.type.name} · ${fmtRange(r.startDate, r.endDate)}`}
                    detail={`${fmtDays(r.days)}${r.halfDay !== 'NONE' ? (r.halfDay === 'FIRST_HALF' ? ', morning' : ', afternoon') : ''}${r.type.paid ? '' : ' · unpaid'}`}
                    reason={r.reason}
                    onDecide={(decision) => setPending({ kind: 'leave', id: r.id, who: r.person.firstName, decision })}
                  />
                ))}
              </ul>
            )}
          </section>
          <section>
            <SectionTitle icon={<ClipboardCheck />}>Attendance corrections {corrections.data?.length ? `(${corrections.data.length})` : ''}</SectionTitle>
            {corrections.isPending ? (
              <Skeleton className="h-24" />
            ) : corrections.isError ? (
              <EmptyState className="rounded-xl border border-dashed" title="Corrections couldn't be loaded" description={errorMessage(corrections.error)} action={<Button variant="outline" onClick={() => void corrections.refetch()}>Try again</Button>} />
            ) : !corrections.data?.length ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted">No corrections waiting for you.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {corrections.data.map((c) => (
                  <Row
                    key={c.id}
                    person={c.person!}
                    at={c.createdAt}
                    title={`Correction for ${fmtDate(c.date, { weekday: 'long', day: 'numeric', month: 'short' })}`}
                    detail={`${hm(c.checkIn)} – ${c.checkOut ? hm(c.checkOut) : 'no check-out'} · ${LOCATION_LABEL[c.location]}`}
                    reason={c.reason}
                    onDecide={(decision) => setPending({ kind: 'correction', id: c.id, who: c.person!.firstName, decision })}
                  />
                ))}
              </ul>
            )}
          </section>
          <WorkRequestsSection />
        </div>
      )}
      <Dialog open={!!pending} onOpenChange={(o) => !o && close()} title={pending?.decision === 'APPROVED' ? 'Approve request?' : 'Decline request?'} description={`${pending?.who ?? 'They'} will be notified${note.trim() ? ' and will see your note' : ''}.`} className="max-w-md">
        <Field label="Note (optional)" htmlFor="d-note">
          <Textarea id="d-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={pending?.decision === 'APPROVED' ? 'e.g. Enjoy your break' : 'e.g. Release week — can we move it?'} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant={pending?.decision === 'APPROVED' ? 'primary' : 'danger'} loading={decide.isPending} onClick={() => pending && decide.mutate(pending)}>
            {pending?.decision === 'APPROVED' ? 'Approve' : 'Decline'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
