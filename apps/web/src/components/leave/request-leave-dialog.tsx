'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { leaveRequestSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { fmtDays, useLeaveBalances } from '@/lib/hooks';
import { useSession } from '@/lib/session';
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

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function RequestLeaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const qc = useQueryClient();
  const balances = useLeaveBalances();
  const [form, setForm] = useState({ typeId: '', startDate: today(), endDate: today(), halfDay: 'NONE' as 'NONE' | 'FIRST_HALF' | 'SECOND_HALF', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, typeId: f.typeId || balances.data?.items[0]?.type.id || '', startDate: today(), endDate: today(), halfDay: 'NONE', reason: '' }));
      setErrors({});
    }
  }, [open, balances.data]);
  const single = form.startDate === form.endDate;
  const valid = leaveRequestSchema.safeParse(form);
  const preview = useQuery({
    queryKey: ['leave-preview', form.typeId, form.startDate, form.endDate, form.halfDay],
    queryFn: () => api<{ days: number }>('/leave/preview', { body: form }),
    enabled: open && valid.success,
  });
  const balance = balances.data?.items.find((b) => b.type.id === form.typeId);
  const days = preview.data?.days;
  const over = balance?.remaining !== null && balance?.remaining !== undefined && days !== undefined && days > balance.remaining;

  const submit = async () => {
    const parsed = leaveRequestSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setSaving(true);
    try {
      await api('/leave/requests', { body: { ...parsed.data, reason: parsed.data.reason || null } });
      for (const k of ['leave-requests', 'leave-balances', 'leave-calendar']) void qc.invalidateQueries({ queryKey: [k] });
      toast.success('Leave requested', { description: 'Your manager has been notified.' });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request time off" description="Weekends and company holidays aren't counted.">
      <div className="space-y-4">
        <Field label="Type of leave" htmlFor="lv-type">
          <Select id="lv-type" value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })}>
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
        <Field label="Reason (optional)" htmlFor="lv-reason" hint="Only you, your manager and HR can see this.">
          <Textarea id="lv-reason" rows={2} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] ${over ? 'bg-rose-500/8 text-danger' : 'bg-surface-2/70'}`} aria-live="polite">
          {over ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0 text-muted" />}
          <span>
            {!valid.success
              ? 'Pick your dates to see how many days this uses.'
              : preview.isFetching && days === undefined
                ? 'Counting working days…'
                : days === 0
                  ? 'Those dates are weekends or holidays — you don’t need leave.'
                  : `This uses ${fmtDays(days ?? 0)}${balance?.remaining !== null && balance ? ` of your ${fmtDays(balance.remaining!)} left` : ''}.${over ? ' That’s more than you have left.' : ''}`}
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={saving} disabled={!valid.success || days === 0 || over} onClick={submit}>
            Send request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
