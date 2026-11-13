'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, Pencil, Plus, Search, TreePalm, X } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { leaveTypeSchema, PERMISSIONS } from '@fg/shared';
import { fieldErrors } from '@/components/admin/form-errors';
import { Forbidden, LoadError, PageHeader } from '@/components/admin/page-header';
import { LeaveCalendar } from '@/components/leave/leave-calendar';
import { LeaveStatusBadge, RequestLeaveDialog } from '@/components/leave/request-leave-dialog';
import { Button } from '@/components/ui/button';
import { ColorSwatches, LABEL_COLORS } from '@/components/ui/color-swatches';
import { Dialog } from '@/components/ui/dialog';
import { FilterChips } from '@/components/ui/filter-chips';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton, Switch } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { fmtDays, fmtRange, useLeaveRequests, useLeaveTypes } from '@/lib/hooks';
import { useCan, useSession } from '@/lib/session';
import type { LeaveRequest, LeaveType } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

interface LeaveSummary { date: string; pending: number; approved: number; declined: number; cancelled: number; outToday: number; startingSoon: number }

/** Headline counts above the request list. Status tiles switch the list; "out" tiles open the calendar. */
function SummaryTiles({ onStatus, onCalendar }: { onStatus: (s: string) => void; onCalendar: () => void }) {
  const q = useQuery({ queryKey: ['leave-summary'], queryFn: () => api<LeaveSummary>('/leave/requests/summary'), refetchInterval: 60_000 });
  if (q.isPending) return <Skeleton className="mb-5 h-[72px]" />;
  if (q.isError) return <p className="mb-5 text-xs text-muted">The summary couldn&apos;t be loaded. {errorMessage(q.error)}</p>;
  const d = q.data;
  const tiles: { label: string; value: number; hint: string; onClick: () => void; accent?: boolean }[] = [
    { label: 'Waiting for approval', value: d.pending, hint: 'Show these requests', onClick: () => onStatus('PENDING'), accent: d.pending > 0 },
    { label: 'Out today', value: d.outToday, hint: 'Open the calendar', onClick: onCalendar },
    { label: 'Starting in 7 days', value: d.startingSoon, hint: 'Open the calendar', onClick: onCalendar },
    { label: 'Approved', value: d.approved, hint: 'Show approved requests', onClick: () => onStatus('APPROVED') },
    { label: 'Declined', value: d.declined, hint: 'Show declined requests', onClick: () => onStatus('REJECTED') },
  ];
  return (
    <ul className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <li key={t.label}>
          <button type="button" onClick={t.onClick} aria-label={`${t.label}: ${t.value}. ${t.hint}`} className="block w-full rounded-lg border px-3 py-2 text-left transition hover:bg-surface-2">
            <span className="block text-xs text-muted">{t.label}</span>
            <span className={cn('mt-0.5 block text-lg font-semibold tabular-nums', t.accent && 'text-warning')}>{t.value}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type TypeForm = { name: string; code: string; color: string; annualAllowance: number; paid: boolean; active: boolean; description: string };
const EMPTY_TYPE: TypeForm = { name: '', code: '', color: LABEL_COLORS[2]!.value, annualAllowance: 12, paid: true, active: true, description: '' };
const TYPE_MESSAGES: Partial<Record<keyof TypeForm, string>> = {
  name: 'Enter a name of 2 to 40 characters',
  code: 'Use 2 to 10 letters or numbers, for example CL',
  annualAllowance: 'Enter a number of days from 0 to 365',
  description: 'Keep the description under 200 characters',
};

function TypeDialog({ editing, open, onOpenChange }: { editing: LeaveType | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<TypeForm>(EMPTY_TYPE);
  const [initial, setInitial] = useState<TypeForm>(EMPTY_TYPE);
  const [errors, setErrors] = useState<Partial<Record<keyof TypeForm, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const start: TypeForm = editing
      ? { name: editing.name, code: editing.code, color: editing.color, annualAllowance: editing.annualAllowance, paid: editing.paid, active: editing.active, description: editing.description ?? '' }
      : EMPTY_TYPE;
    setF(start);
    setInitial(start);
    setErrors({});
    setFailure(null);
  }, [open, editing]);
  const save = useMutation({
    mutationFn: (body: unknown) => api(editing ? `/leave/types/${editing.id}` : '/leave/types', { method: editing ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      toast.success(editing ? 'Leave type updated' : 'Leave type added');
      for (const k of ['leave-types', 'leave-balances']) void qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    },
    onError: (e) => setFailure(errorMessage(e)),
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setFailure(null);
    const parsed = leaveTypeSchema.safeParse({ ...f, description: f.description || null });
    if (!parsed.success) return setErrors(fieldErrors<keyof TypeForm>(parsed.error, TYPE_MESSAGES));
    setErrors({});
    save.mutate(parsed.data);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${editing.name}` : 'New leave type'} guard={JSON.stringify(f) !== JSON.stringify(initial)}>
      <form className="space-y-4" noValidate onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
          <Field label="Name" htmlFor="t-name" error={errors.name}>
            <Input id="t-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Casual leave" aria-invalid={!!errors.name} />
          </Field>
          <Field label="Short code" htmlFor="t-code" error={errors.code} hint={editing ? "Can't be changed later." : undefined}>
            <Input id="t-code" value={f.code} disabled={!!editing} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="CL" aria-invalid={!!errors.code} />
          </Field>
        </div>
        <Field label="Days per year" htmlFor="t-days" error={errors.annualAllowance} hint="Use 0 for no limit (for example unpaid leave).">
          <Input id="t-days" type="number" min={0} max={365} step={0.5} value={f.annualAllowance} onChange={(e) => setF({ ...f, annualAllowance: Number(e.target.value) })} aria-invalid={!!errors.annualAllowance} />
        </Field>
        <ColorSwatches value={f.color} onChange={(color) => setF({ ...f, color })} />
        <Field label="Description (optional)" htmlFor="t-desc" error={errors.description}>
          <Textarea id="t-desc" rows={2} maxLength={200} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="divide-y rounded-xl border">
          <label className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            Paid leave <Switch checked={f.paid} onCheckedChange={(v) => setF({ ...f, paid: v })} />
          </label>
          <label className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span>
              <span className="block">People can request it</span>
              <span className="block text-xs text-muted">Turn off to stop new requests. Past leave is kept.</span>
            </span>
            <Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} />
          </label>
        </div>
        {failure && (
          <p role="alert" className="rounded-lg bg-danger/8 px-3 py-2 text-[13px] text-danger">
            {failure}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save' : 'Add leave type'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Waiting for approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Declined' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];
const EMPTY_TITLE: Record<StatusFilter, string> = {
  PENDING: 'Nothing is waiting for approval',
  APPROVED: 'No approved leave yet',
  REJECTED: 'No declined requests',
  CANCELLED: 'No cancelled requests',
  ALL: 'No leave requests yet',
};
/** Rows shown before "Show more". */
const PAGE = 25;

type Decision = { request: LeaveRequest; decision: 'APPROVED' | 'REJECTED' };

function Requests() {
  const qc = useQueryClient();
  const me = useSession();
  const [get, set] = useUrlState({ status: 'PENDING', tab: 'requests', q: '', type: '' });
  // An unknown status in the URL shows the waiting list instead of an error.
  const status = (STATUS_OPTIONS.some((o) => o.value === get('status')) ? get('status') : 'PENDING') as StatusFilter;
  const urlQ = get('q');
  const type = get('type');
  const [q, setQ] = useState(urlQ);
  useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => set({ q }), 250);
    return () => clearTimeout(t);
  }, [q, urlQ, set]);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [status, urlQ, type]);
  const list = useLeaveRequests('all', status);
  const types = useLeaveTypes(true);
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const close = () => {
    setPending(null);
    setNote('');
  };
  const refresh = () => {
    for (const k of ['leave-requests', 'leave-summary', 'approvals-count', 'leave-calendar', 'leave-balances']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const decide = useMutation({
    mutationFn: (d: Decision) => api(`/leave/requests/${d.request.id}/decision`, { body: { decision: d.decision, note: note.trim() || null } }),
    onSuccess: (_d, d) => {
      toast.success(`${d.decision === 'APPROVED' ? 'Approved' : 'Declined'}. ${d.request.person.firstName} has been notified.`);
      close();
      refresh();
    },
    // Someone else may have decided first: show the current state.
    onError: (e) => {
      toast.error(errorMessage(e));
      close();
      refresh();
    },
  });

  const needle = urlQ.trim().toLowerCase();
  const matches = (list.data ?? []).filter((r) => (!type || r.type.id === type) && (!needle || r.person.name.toLowerCase().includes(needle)));
  const filtering = !!needle || !!type;

  return (
    <>
      <SummaryTiles onStatus={(s) => set({ status: s })} onCalendar={() => set({ tab: 'calendar', status: null, q: null, type: null }, { push: true })} />
      <FilterChips label="Status" value={status} onChange={(s) => set({ status: s })} options={STATUS_OPTIONS} className="mb-3" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="pl-9" aria-label="Find a person" />
        </div>
        <Select value={type} onChange={(e) => set({ type: e.target.value })} className="sm:w-56" aria-label="Leave type">
          <option value="">All leave types</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : list.isError ? (
        <LoadError what="the leave requests" error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.length ? (
        <EmptyState icon={<TreePalm />} title={EMPTY_TITLE[status]} description={status === 'PENDING' ? 'New requests show up here as soon as someone asks for time off.' : undefined} />
      ) : !matches.length ? (
        <EmptyState
          icon={<Search />}
          title="No requests match"
          description="Try another name or leave type."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQ('');
                set({ q: null, type: null });
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <ul className="divide-y rounded-xl border" aria-label="Leave requests">
            {matches.slice(0, shown).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <UserAvatar person={r.person} size="sm" showPresence={false} />
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block text-[13px] font-medium">
                    <Link href={`/admin/employees/${r.person.id}?tab=leave`} className="rounded hover:underline">
                      {r.person.name}
                    </Link>{' '}
                    · {r.type.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {fmtRange(r.startDate, r.endDate)} · {fmtDays(r.days)}
                    {r.reason ? ` · ${r.reason}` : ''}
                  </span>
                  {r.decisionNote && r.status !== 'PENDING' && <span className="block text-xs text-muted">Note: {r.decisionNote}</span>}
                </span>
                <LeaveStatusBadge status={r.status} />
                {r.status === 'PENDING' && r.person.id === me.user.id && <span className="text-xs text-muted">Another admin or your manager decides this</span>}
                {r.status === 'PENDING' && r.person.id !== me.user.id && (
                  <span className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setPending({ request: r, decision: 'REJECTED' })} aria-label={`Decline ${r.person.name}'s request`}>
                      <X /> Decline
                    </Button>
                    <Button size="sm" onClick={() => setPending({ request: r, decision: 'APPROVED' })} aria-label={`Approve ${r.person.name}'s request`}>
                      <Check /> Approve
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              Showing {Math.min(shown, matches.length)} of {matches.length}
              {filtering ? ' that match' : ''}
            </span>
            {matches.length > shown && (
              <Button size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                Show more
              </Button>
            )}
          </div>
        </>
      )}
      <Dialog
        open={!!pending}
        onOpenChange={(o) => !o && close()}
        title={pending?.decision === 'APPROVED' ? 'Approve this request?' : 'Decline this request?'}
        description={pending ? `${pending.request.person.name} · ${pending.request.type.name} · ${fmtRange(pending.request.startDate, pending.request.endDate)} (${fmtDays(pending.request.days)})` : undefined}
        className="max-w-md"
        guard={!!note}
      >
        <form
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            if (pending) decide.mutate(pending);
          }}
        >
          <Field label="Note (optional)" htmlFor="leave-decision-note" hint={`${pending?.request.person.firstName ?? 'They'} will be notified and can read your note.`}>
            <Textarea id="leave-decision-note" autoFocus rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={pending?.decision === 'APPROVED' ? 'e.g. Enjoy your break' : 'e.g. Release week. Can we move it?'} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Back
            </Button>
            <Button type="submit" variant={pending?.decision === 'APPROVED' ? 'primary' : 'danger'} loading={decide.isPending}>
              {pending?.decision === 'APPROVED' ? 'Approve' : 'Decline'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function Types() {
  const types = useLeaveTypes(true);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [open, setOpen] = useState(false);
  const add = () => {
    setEditing(null);
    setOpen(true);
  };
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={add}>
          <Plus /> New leave type
        </Button>
      </div>
      {types.isPending ? (
        <Skeleton className="h-40" />
      ) : types.isError ? (
        <LoadError what="the leave types" error={types.error} onRetry={() => types.refetch()} />
      ) : !types.data?.length ? (
        <EmptyState icon={<TreePalm />} title="No leave types yet" description="Add the kinds of leave people can take, such as casual or sick leave." action={<Button onClick={add}>Add the first one</Button>} />
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Leave types">
          {types.data.map((t) => (
            <li key={t.id} className="flex items-center gap-4 px-4 py-3">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {t.name} <span className="font-mono text-xs text-subtle">{t.code}</span>
                </span>
                <span className="text-xs text-muted">
                  {t.annualAllowance ? `${fmtDays(t.annualAllowance)} per year` : 'No limit'}
                  {t.paid ? '' : ' · unpaid'}
                </span>
              </span>
              {!t.active && <Badge tone="muted">Not available</Badge>}
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.name}`} onClick={() => { setEditing(t); setOpen(true); }}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <TypeDialog editing={editing} open={open} onOpenChange={setOpen} />
    </>
  );
}

const TABS = [
  { value: 'requests', label: 'Requests' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'types', label: 'Leave types' },
] as const;
type LeaveTab = (typeof TABS)[number]['value'];

function AdminLeave() {
  const can = useCan();
  const [get, set] = useUrlState({ tab: 'requests', record: '' });
  if (!can(PERMISSIONS.EMPLOYEES_MANAGE)) return <Forbidden />;
  // An unknown tab in the URL shows the requests.
  const tab = (TABS.some((t) => t.value === get('tab')) ? get('tab') : 'requests') as LeaveTab;
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
      <Tabs value={tab} onValueChange={(v) => set({ tab: v, status: null, month: null, q: null, type: null }, { push: true })} items={TABS} label="Leave sections">
        <TabPanel value="requests">
          <Requests />
        </TabPanel>
        <TabPanel value="calendar">
          <LeaveCalendar />
        </TabPanel>
        <TabPanel value="types">
          <Types />
        </TabPanel>
      </Tabs>
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
