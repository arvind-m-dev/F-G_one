'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, TreePalm } from 'lucide-react';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { LeaveCalendar } from '@/components/leave/leave-calendar';
import { LeaveStatusBadge, RequestLeaveDialog } from '@/components/leave/request-leave-dialog';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, InfoHint, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { fmtDays, fmtRange, useLeaveBalances, useLeaveRequests } from '@/lib/hooks';
import type { LeaveRequest } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

function MyLeave() {
  const qc = useQueryClient();
  const balances = useLeaveBalances();
  const requests = useLeaveRequests('mine');
  const [get, set] = useUrlState({ request: '' });
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const today = new Date().toLocaleDateString('en-CA');
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/leave/requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Leave cancelled');
      setCancelling(null);
      for (const k of ['leave-requests', 'leave-balances', 'leave-calendar']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-muted">
          Leave year {balances.data ? `${fmtRange(balances.data.year.start, balances.data.year.end)}` : ''}
          <InfoHint>Balances reset at the start of each leave year. Pending requests are held from your balance until they&apos;re decided.</InfoHint>
        </p>
        <Button onClick={() => set({ request: '1' })}>
          <CalendarPlus /> Request time off
        </Button>
      </div>
      {balances.isPending ? (
        <Skeleton className="h-28" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balances.data?.items.map((b) => {
            const pct = b.allowance > 0 ? ((b.used + b.pending) / b.allowance) * 100 : 0;
            return (
              <div key={b.type.id} className="rounded-xl border bg-surface p-4">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="size-2 rounded-full" style={{ background: b.type.color }} /> {b.type.name}
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{b.remaining === null ? 'No limit' : fmtDays(b.remaining)}</p>
                <p className="text-xs text-muted">
                  {b.remaining === null ? `${fmtDays(b.used)} taken this year` : `left of ${fmtDays(b.allowance)} · ${fmtDays(b.used)} taken${b.pending ? ` · ${fmtDays(b.pending)} pending` : ''}`}
                </p>
                {b.allowance > 0 && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: b.type.color }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <section className="mt-10">
        <SectionTitle icon={<TreePalm />}>My requests</SectionTitle>
        {requests.isPending ? (
          <Skeleton className="h-40" />
        ) : !requests.data?.length ? (
          <EmptyState icon={<TreePalm />} title="No leave requests yet" description="When you request time off it shows up here with its status." action={<Button variant="outline" onClick={() => set({ request: '1' })}>Request time off</Button>} />
        ) : (
          <ul className="divide-y rounded-xl border">
            {requests.data.map((r) => {
              const canCancel = r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: r.type.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">
                      {r.type.name} · {fmtRange(r.startDate, r.endDate)}
                      {r.halfDay !== 'NONE' && <span className="text-muted"> ({r.halfDay === 'FIRST_HALF' ? 'morning' : 'afternoon'})</span>}
                    </span>
                    <span className="block text-xs text-muted">
                      {fmtDays(r.days)}
                      {r.reason ? ` · ${r.reason}` : ''}
                      {r.approver && r.status !== 'PENDING' && r.status !== 'CANCELLED' ? ` · by ${r.approver.firstName} ${r.approver.lastName}` : ''}
                      {r.decisionNote ? ` · “${r.decisionNote}”` : ''}
                    </span>
                  </span>
                  <LeaveStatusBadge status={r.status} />
                  {canCancel && (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>
                      Cancel
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <RequestLeaveDialog open={get('request') === '1'} onOpenChange={(o) => set({ request: o ? '1' : null })} />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this leave?"
        description={cancelling ? `${cancelling.type.name}, ${fmtRange(cancelling.startDate, cancelling.endDate)}. The days go back to your balance.` : ''}
        confirmLabel="Cancel leave"
        danger
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
    </>
  );
}

function LeavePage() {
  const [get, set] = useUrlState({ tab: 'mine' });
  const tab = get('tab');
  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        className="px-0 pt-0 sm:px-0"
        title="Leave"
        description="See how much time off you have, request leave, and check who's away."
        actions={
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Leave view">
            {([
              ['mine', 'My leave'],
              ['team', "Who's away"],
            ] as const).map(([v, label]) => (
              <button key={v} role="tab" aria-selected={tab === v} onClick={() => set({ tab: v }, { push: true })} className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium transition', tab === v ? 'bg-canvas shadow-sm' : 'text-muted')}>
                {label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'team' ? <LeaveCalendar /> : <MyLeave />}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LeavePage />
    </Suspense>
  );
}
