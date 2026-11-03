'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, Pencil, Plus, TreePalm, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { leaveTypeSchema, PERMISSIONS } from '@fg/shared';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { LeaveCalendar } from '@/components/leave/leave-calendar';
import { LeaveStatusBadge, RequestLeaveDialog } from '@/components/leave/request-leave-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton, Switch } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { fmtDays, fmtRange, useLeaveRequests, useLeaveTypes } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import type { LeaveType } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

const COLORS = ['#0ea5e9', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6', '#6366f1', '#94a3b8'];

function TypeDialog({ editing, open, onOpenChange }: { editing: LeaveType | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', code: '', color: COLORS[0]!, annualAllowance: 12, paid: true, active: true, description: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF(editing ? { ...editing, description: editing.description ?? '' } : { name: '', code: '', color: COLORS[0]!, annualAllowance: 12, paid: true, active: true, description: '' });
      setError(null);
    }
  }, [open, editing]);
  const save = useMutation({
    mutationFn: () => {
      const parsed = leaveTypeSchema.safeParse({ ...f, description: f.description || null });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the form');
      return api(editing ? `/leave/types/${editing.id}` : '/leave/types', { method: editing ? 'PATCH' : 'POST', body: parsed.data });
    },
    onSuccess: () => {
      toast.success('Leave type saved');
      for (const k of ['leave-types', 'leave-balances']) void qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${editing.name}` : 'New leave type'}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Name" htmlFor="t-name">
            <Input id="t-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Casual leave" />
          </Field>
          <Field label="Short code" htmlFor="t-code">
            <Input id="t-code" value={f.code} disabled={!!editing} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="CL" />
          </Field>
        </div>
        <Field label="Days per year" htmlFor="t-days" hint="Use 0 for no limit (for example unpaid leave).">
          <Input id="t-days" type="number" min={0} max={365} step={0.5} value={f.annualAllowance} onChange={(e) => setF({ ...f, annualAllowance: Number(e.target.value) })} />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Colour</p>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setF({ ...f, color: c })} className={cn('size-7 rounded-full transition hover:scale-110', f.color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-elevated')} style={{ background: c }} aria-label={`Colour ${c}`} />
            ))}
          </div>
        </div>
        <Field label="Description (optional)" htmlFor="t-desc">
          <Textarea id="t-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="divide-y rounded-xl border">
          <label className="flex items-center justify-between px-4 py-3 text-sm">
            Paid leave <Switch checked={f.paid} onCheckedChange={(v) => setF({ ...f, paid: v })} />
          </label>
          <label className="flex items-center justify-between px-4 py-3 text-sm">
            Available to request <Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} />
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Requests() {
  const qc = useQueryClient();
  const [get, set] = useUrlState({ status: 'PENDING' });
  const list = useLeaveRequests('all', get('status'));
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'APPROVED' | 'REJECTED' }) => api(`/leave/requests/${v.id}/decision`, { body: { decision: v.decision } }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'APPROVED' ? 'Approved' : 'Declined');
      for (const k of ['leave-requests', 'approvals-count', 'leave-calendar']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <div className="scrollbar-thin mb-4 flex gap-1.5 overflow-x-auto" role="radiogroup" aria-label="Status">
        {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'] as const).map((s) => (
          <button key={s} role="radio" aria-checked={get('status') === s} onClick={() => set({ status: s })} className={cn('shrink-0 rounded-full border px-3 py-1 text-[13px] capitalize transition', get('status') === s ? 'border-foreground/20 bg-foreground text-canvas' : 'text-muted hover:text-foreground')}>
            {s === 'ALL' ? 'All' : s === 'REJECTED' ? 'Declined' : s.toLowerCase()}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : !list.data?.length ? (
        <EmptyState icon={<TreePalm />} title="No requests here" />
      ) : (
        <ul className="divide-y rounded-xl border">
          {list.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <UserAvatar person={r.person} size="sm" showPresence={false} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">
                  {r.person.name} · {r.type.name}
                </span>
                <span className="block text-xs text-muted">
                  {fmtRange(r.startDate, r.endDate)} · {fmtDays(r.days)}
                  {r.reason ? ` · ${r.reason}` : ''}
                </span>
              </span>
              <LeaveStatusBadge status={r.status} />
              {r.status === 'PENDING' && (
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, decision: 'REJECTED' })} aria-label={`Decline ${r.person.name}`}>
                    <X />
                  </Button>
                  <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })} aria-label={`Approve ${r.person.name}`}>
                    <Check />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Types() {
  const types = useLeaveTypes(true);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus /> New leave type
        </Button>
      </div>
      <ul className="divide-y rounded-xl border">
        {types.data?.map((t) => (
          <li key={t.id} className="flex items-center gap-4 px-4 py-3">
            <span className="size-2.5 rounded-full" style={{ background: t.color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {t.name} <span className="font-mono text-xs text-subtle">{t.code}</span>
              </span>
              <span className="text-xs text-muted">{t.annualAllowance ? `${fmtDays(t.annualAllowance)} per year` : 'No limit'}{t.paid ? '' : ' · unpaid'}</span>
            </span>
            {!t.active && <Badge tone="muted">Hidden</Badge>}
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => { setEditing(t); setOpen(true); }}>
              <Pencil />
            </Button>
          </li>
        ))}
      </ul>
      <TypeDialog editing={editing} open={open} onOpenChange={setOpen} />
    </>
  );
}

function AdminLeave() {
  const can = useCan();
  const [get, set] = useUrlState({ tab: 'requests', record: '' });
  if (!can(PERMISSIONS.EMPLOYEES_MANAGE)) return <Forbidden />;
  const tab = get('tab');
  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        title="Leave"
        description="Every leave request in the company, the team calendar, and the types of leave people can take."
        actions={
          <Button onClick={() => set({ record: '1' })}>
            <CalendarPlus /> Record leave
          </Button>
        }
      />
      <RequestLeaveDialog record open={get('record') === '1'} onOpenChange={(o) => set({ record: o ? '1' : null })} />
      <div className="mb-6 inline-flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Leave admin">
        {([
          ['requests', 'Requests'],
          ['calendar', 'Calendar'],
          ['types', 'Leave types'],
        ] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => set({ tab: v, status: null, month: null }, { push: true })} className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium transition', tab === v ? 'bg-canvas shadow-sm' : 'text-muted')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'types' ? <Types /> : tab === 'calendar' ? <LeaveCalendar /> : <Requests />}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AdminLeave />
    </Suspense>
  );
}
