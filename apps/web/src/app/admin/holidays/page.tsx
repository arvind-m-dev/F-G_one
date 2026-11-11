'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HOLIDAY_TYPES, holidaySchema, PERMISSIONS, type HolidayInput } from '@fg/shared';
import { fieldErrors } from '@/components/admin/form-errors';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { HolidayList } from '@/components/leave/holiday-list';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Field, Input, Select } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/session';
import type { Holiday } from '@/lib/types';

type HolidayForm = { name: string; date: string; type: string; description: string };
const EMPTY: HolidayForm = { name: '', date: '', type: 'MANDATORY', description: '' };

function HolidayDialog({ editing, open, onOpenChange }: { editing: Holiday | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<HolidayForm>(EMPTY);
  const [initial, setInitial] = useState<HolidayForm>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof HolidayForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      const start: HolidayForm = { name: editing?.name ?? '', date: editing?.date ?? '', type: editing?.type ?? 'MANDATORY', description: editing?.description ?? '' };
      setForm(start);
      setInitial(start);
      setErrors({});
      setError(null);
    }
  }, [open, editing]);
  const save = useMutation({
    mutationFn: (body: HolidayInput) => api(editing ? `/holidays/${editing.id}` : '/holidays', { method: editing ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      toast.success(editing ? 'Holiday updated' : 'Holiday added');
      for (const k of ['holidays', 'dashboard', 'leave-calendar']) void qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    const parsed = holidaySchema.safeParse({ ...form, description: form.description || null });
    if (!parsed.success) return setErrors(fieldErrors<keyof HolidayForm>(parsed.error, { name: 'Enter a name of 2 to 80 characters', date: 'Choose a date', description: 'Keep the note under 240 characters' }));
    setErrors({});
    save.mutate(parsed.data);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? 'Edit holiday' : 'Add a holiday'} guard={JSON.stringify(form) !== JSON.stringify(initial)}>
      <form className="space-y-4" noValidate onSubmit={submit}>
        <Field label="Name" htmlFor="h-name" error={errors.name}>
          <Input id="h-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali" aria-invalid={!!errors.name} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="h-date" error={errors.date}>
            <Input id="h-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-invalid={!!errors.date} />
          </Field>
          <Field label="Kind" htmlFor="h-type">
            <Select id="h-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {HOLIDAY_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted">{HOLIDAY_TYPES.find((t) => t.key === form.type)?.description}</p>
        <Field label="Note (optional)" htmlFor="h-desc" error={errors.description}>
          <Input id="h-desc" value={form.description} maxLength={240} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/8 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save' : 'Add holiday'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function AdminHolidaysPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api(`/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Holiday removed');
      setDeleting(null);
      for (const k of ['holidays', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can(PERMISSIONS.HOLIDAYS_MANAGE)) return <Forbidden />;
  return (
    <div className="mx-auto max-w-[1000px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        title="Holidays"
        description="Public and company holidays close the office and aren't counted as leave. Special working days turn a weekend into a working day."
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus /> Add holiday
          </Button>
        }
      />
      <Suspense>
        <HolidayList
          actions={(h) => (
            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${h.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem onSelect={() => { setEditing(h); setOpen(true); }}>
                  <Pencil /> Edit
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem danger onSelect={() => setDeleting(h)}>
                  <Trash2 /> Remove
                </DropdownItem>
              </DropdownContent>
            </DropdownMenu>
          )}
        />
      </Suspense>
      <HolidayDialog editing={editing} open={open} onOpenChange={setOpen} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Remove ${deleting?.name}?`} description="It disappears from everyone's calendar. Existing leave isn't recalculated." confirmLabel="Remove" danger loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} />
    </div>
  );
}
