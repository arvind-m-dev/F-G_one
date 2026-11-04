'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { correctionSchema, WORK_LOCATIONS } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useOrgToday } from '@/lib/session';

export interface CorrectionPrefill {
  date: string;
  checkIn?: string;
  checkOut?: string | null;
  location?: 'WFO' | 'WFH' | 'ON_DUTY';
}

/** Ask a manager/HR to fix a day (forgot to check in/out, wrong times or location). */
export function CorrectionDialog({ prefill, onClose }: { prefill: CorrectionPrefill | null; onClose: () => void }) {
  const qc = useQueryClient();
  const org = useOrgToday();
  const [form, setForm] = useState({ date: '', checkIn: '09:30', checkOut: '18:30', location: 'WFO' as 'WFO' | 'WFH' | 'ON_DUTY', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (prefill) {
      setForm({ date: prefill.date, checkIn: prefill.checkIn ?? '09:30', checkOut: prefill.checkOut ?? '18:30', location: prefill.location ?? 'WFO', reason: '' });
      setErrors({});
    }
  }, [prefill]);
  const submit = async () => {
    const parsed = correctionSchema.safeParse({ ...form, checkOut: form.checkOut || null });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    // Only today can be left open (still working); a past day needs the time you finished.
    if (!parsed.data.checkOut && parsed.data.date < org.today()) return setErrors({ checkOut: 'Add the time you finished' });
    setErrors({});
    setSaving(true);
    try {
      await api('/attendance/corrections', { body: parsed.data });
      void qc.invalidateQueries({ queryKey: ['corrections'] });
      toast.success('Correction sent', { description: 'Your manager will review it.' });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={!!prefill} onOpenChange={(o) => !o && onClose()} title="Request a correction" description="Forgot to check in or out, or picked the wrong place? Tell us what really happened.">
      <div className="space-y-4">
        <Field label="Day" htmlFor="c-date" error={errors.date}>
          <Input id="c-date" type="date" min={org.today(-60)} max={org.today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started at" htmlFor="c-in" error={errors.checkIn}>
            <Input id="c-in" type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
          </Field>
          <Field label="Finished at" htmlFor="c-out" error={errors.checkOut} hint={form.date === org.today() ? 'Leave empty if still working' : undefined}>
            <Input id="c-out" type="time" value={form.checkOut ?? ''} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
          </Field>
        </div>
        <Field label="Where were you working?" htmlFor="c-loc">
          <Select id="c-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value as typeof form.location })}>
            {WORK_LOCATIONS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What needs fixing?" htmlFor="c-reason" error={errors.reason}>
          <Textarea id="c-reason" rows={3} maxLength={500} placeholder="e.g. Forgot to check out — I left at 6:40 PM" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={submit}>
            Send for review
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
