'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { leaveRequestSchema, recordLeaveSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { fmtDays, useEmployeeList, useLeaveBalances } from '@/lib/hooks';
import { useOrgToday, useSession } from '@/lib/session';
import type { LeaveRequest } from '@/lib/types';

export const LEAVE_STATUS = {
  PENDING: { label: 'Waiting for approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Declined', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
} as const;

export function LeaveStatusBadge({ status }: { status: LeaveRequest['status'] }) {
  return <Badge tone={LEAVE_STATUS[status].tone}>{LEAVE_STATUS[status].label}</Badge>;
}


/** Request your own time off, or (`record`, HR only) record leave someone already took; that is approved straight away. */
export function RequestLeaveDialog({ open, onOpenChange, record = false }: { open: boolean; onOpenChange: (o: boolean) => void; record?: boolean }) {
  const me = useSession();
  const { today } = useOrgToday();
  const qc = useQueryClient();
  const [form, setForm] = useState({ userId: '', typeId: '', startDate: today(), endDate: today(), halfDay: 'NONE' as 'NONE' | 'FIRST_HALF' | 'SECOND_HALF', reason: '' });
  const employees = useEmployeeList({ status: 'ACTIVE', pageSize: 100 }, open && record);
  const people = (employees.data?.items ?? []).filter((e) => e.id !== me.user.id).sort((a, b) => a.name.localeCompare(b.name));
  // The balance of the leave year the leave starts in: next year's leave uses next year's allowance.
  const balances = useLeaveBalances(record ? form.userId : undefined, open && (!record || !!form.userId), /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) ? form.startDate : undefined);
  const schema = record ? recordLeaveSchema : leaveRequestSchema;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Fresh form each time it opens; the leave type follows the chosen person's balances.
  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, userId: '', startDate: today(), endDate: today(), halfDay: 'NONE', reason: '' }));
    setErrors({});
  }, [open]);
  useEffect(() => {
    if (open && balances.data) setForm((f) => ({ ...f, typeId: balances.data.items.some((b) => b.type.id === f.typeId) ? f.typeId : balances.data.items[0]?.type.id || '' }));
  }, [open, balances.data]);
  const single = form.startDate === form.endDate;
  const valid = schema.safeParse(form);
  const preview = useQuery({
    queryKey: ['leave-preview', form.typeId, form.startDate, form.endDate, form.halfDay],
    queryFn: () => api<{ days: number; calendarDays: number; workingDays: number; weekends: number; holidays: { date: string; name: string }[]; sandwichDays: number }>('/leave/preview', { body: form }),
    enabled: open && valid.success,
  });
  const balance = balances.data?.items.find((b) => b.type.id === form.typeId);
  const days = preview.data?.days;
  const over = balance?.remaining !== null && balance?.remaining !== undefined && days !== undefined && days > balance.remaining;

  const submit = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setSaving(true);
    try {
      await api(record ? '/leave/requests/record' : '/leave/requests', { body: { ...parsed.data, reason: parsed.data.reason || null } });
      for (const k of ['leave-requests', 'leave-balances', 'leave-calendar']) void qc.invalidateQueries({ queryKey: [k] });
      if (record) toast.success('Leave recorded', { description: `${people.find((p) => p.id === form.userId)?.name ?? 'They'} and their manager have been notified.` });
      else toast.success('Leave requested', { description: 'Your manager has been notified.' });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={record ? 'Record leave' : 'Request time off'}
      description={record ? "For someone who was away and didn't apply. It's approved straight away and they're notified." : "Days off and company holidays usually aren't counted. The exact number shows below before you send."}
    >
      <div className="space-y-4">
        {record && (
          <Field label="Employee" htmlFor="lv-user" error={errors.userId}>
            <Select id="lv-user" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} disabled={employees.isPending}>
              <option value="">{employees.isPending ? 'Loading…' : 'Choose an employee'}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.department ? ` · ${p.department.name}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Type of leave" htmlFor="lv-type" hint={balances.data && !balances.data.items.length ? 'No leave types are set up yet. HR can add them in Admin portal → Leave.' : undefined}>
          <Select id="lv-type" value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })} disabled={!balances.data?.items.length}>
            {record && !form.userId && <option value="">Choose an employee first</option>}
            {balances.isFetching && !balances.data && (!record || form.userId) && <option value="">Loading…</option>}
            {balances.data && !balances.data.items.length && <option value="">No leave types available</option>}
            {balances.data?.items.map((b) => (
              <option key={b.type.id} value={b.type.id}>
                {b.type.name} {b.remaining !== null ? `· ${fmtDays(b.remaining)} left` : '· no limit'}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="lv-from">
            <Input id="lv-from" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} />
          </Field>
          <Field label="To" htmlFor="lv-to" error={errors.endDate}>
            <Input id="lv-to" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value, halfDay: e.target.value === form.startDate ? form.halfDay : 'NONE' })} />
          </Field>
        </div>
        {single && me.organization.settings.leave.allowHalfDay && (
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Day length">
            {([
              ['NONE', 'Full day'],
              ['FIRST_HALF', 'Morning off'],
              ['SECOND_HALF', 'Afternoon off'],
            ] as const).map(([v, label]) => (
              <button key={v} role="radio" aria-checked={form.halfDay === v} onClick={() => setForm({ ...form, halfDay: v })} className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${form.halfDay === v ? 'bg-canvas shadow-sm' : 'text-muted'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <Field label="Reason (optional)" htmlFor="lv-reason" hint={record ? 'They, their manager and HR can see this.' : 'Only you, your manager and HR can see this.'}>
          <Textarea id="lv-reason" rows={2} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] ${over ? 'bg-danger/8 text-danger-ink' : 'bg-surface-2/70'}`} aria-live="polite">
          {over ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0 text-muted" />}
          <span>
            {!valid.success
              ? record
                ? 'Choose the employee and dates to see how many days this uses.'
                : 'Pick your dates to see how many days this uses.'
              : preview.isError
                ? errorMessage(preview.error)
                : preview.isFetching && days === undefined
                ? 'Counting working days…'
                : days === 0
                  ? 'Those dates are weekends or holidays — you don’t need leave.'
                  : `This uses ${fmtDays(days ?? 0)}${balance?.remaining !== null && balance ? ` of ${record ? 'their' : 'your'} ${fmtDays(balance.remaining!)} left` : ''}.${over ? ` That’s more than ${record ? 'they have' : 'you have'} left.` : ''}`}
          </span>
        </div>
        {valid.success && preview.data && preview.data.calendarDays > 1 && form.halfDay === 'NONE' && (
          <ul className="-mt-2 space-y-0.5 px-3 text-xs text-muted" aria-label="How the days add up">
            <li className="font-medium text-foreground">
              {preview.data.calendarDays} days in total
            </li>
            <li>{fmtDays(preview.data.workingDays)} on working days</li>
            {preview.data.weekends > 0 && <li>{preview.data.weekends} weekly day{preview.data.weekends === 1 ? '' : 's'} off</li>}
            {preview.data.holidays.length > 0 && (
              <li>
                {preview.data.holidays.length} holiday{preview.data.holidays.length === 1 ? '' : 's'}: {preview.data.holidays.map((h) => h.name).join(', ')}
              </li>
            )}
            <li>
              {preview.data.sandwichDays > 0
                ? `${preview.data.sandwichDays} day${preview.data.sandwichDays === 1 ? '' : 's'} off inside the leave also count, by company rule.`
                : preview.data.weekends + preview.data.holidays.length > 0
                  ? 'Days off and holidays are not counted as leave.'
                  : null}
            </li>
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={saving} disabled={!valid.success || days === undefined || days === 0 || over} onClick={submit}>
            {record ? 'Record leave' : 'Send request'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
