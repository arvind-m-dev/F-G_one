'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { departmentSchema, PERMISSIONS, type DepartmentInput } from '@fg/shared';
import { fieldErrors } from '@/components/admin/form-errors';
import { Forbidden, LoadError, PageHeader } from '@/components/admin/page-header';
import { PersonPicker } from '@/components/admin/person-picker';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ColorSwatches, LABEL_COLORS } from '@/components/ui/color-swatches';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useDepartments } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import type { Department } from '@/lib/types';

type DeptForm = { name: string; description: string; headId: string; color: string };
const EMPTY_FORM: DeptForm = { name: '', description: '', headId: '', color: LABEL_COLORS[0]!.value };

function DeptDialog({ dept, open, onOpenChange }: { dept: Department | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<DeptForm>(EMPTY_FORM);
  const [initial, setInitial] = useState<DeptForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof DeptForm, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const k = dept?.id ?? 'new';
  if (open && key !== k) {
    const start: DeptForm = { name: dept?.name ?? '', description: dept?.description ?? '', headId: dept?.headId ?? '', color: dept?.color ?? EMPTY_FORM.color };
    setKey(k);
    setForm(start);
    setInitial(start);
    setErrors({});
    setFailure(null);
  }
  if (!open && key) setKey(null);
  const save = useMutation({
    mutationFn: (body: DepartmentInput) => api(dept ? `/departments/${dept.id}` : '/departments', { method: dept ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success(dept ? 'Department updated' : 'Department created');
      onOpenChange(false);
    },
    onError: (e) => setFailure(errorMessage(e)),
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setFailure(null);
    const parsed = departmentSchema.safeParse({ name: form.name, description: form.description || null, headId: form.headId || null, color: form.color });
    if (!parsed.success) return setErrors(fieldErrors<keyof DeptForm>(parsed.error, { name: 'Enter a name of 2 to 60 characters', description: 'Keep the description under 240 characters' }));
    setErrors({});
    save.mutate(parsed.data);
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={dept ? `Edit ${dept.name}` : 'New department'} guard={dirty}>
      <form className="space-y-4" noValidate onSubmit={submit}>
        <Field label="Name" htmlFor="d-name" error={errors.name}>
          <Input id="d-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus aria-invalid={!!errors.name} />
        </Field>
        <Field label="Description (optional)" htmlFor="d-desc" error={errors.description}>
          <Textarea id="d-desc" rows={2} maxLength={240} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Department head (optional)" htmlFor="d-head" error={errors.headId}>
          <PersonPicker
            id="d-head"
            value={form.headId || null}
            selected={dept?.head ? { id: dept.head.id, name: `${dept.head.firstName} ${dept.head.lastName}`, avatarUrl: dept.head.avatarUrl, avatarColor: dept.head.avatarColor } : null}
            onChange={(p) => setForm({ ...form, headId: p?.id ?? '' })}
            emptyLabel="No head"
          />
        </Field>
        <ColorSwatches value={form.color} onChange={(color) => setForm({ ...form, color })} />
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
            {dept ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function DepartmentsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const depts = useDepartments();
  const [editing, setEditing] = useState<Department | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api(`/departments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department deleted');
      setDeleting(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can(PERMISSIONS.DEPARTMENTS_MANAGE)) return <Forbidden />;
  const blocked = !!deleting?.announcementCount;
  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        title="Departments"
        description="Organise people into teams. Department membership drives team views and targeted announcements."
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus /> New department
          </Button>
        }
      />
      {depts.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : depts.isError ? (
        <LoadError what="departments" error={depts.error} onRetry={() => depts.refetch()} />
      ) : depts.data.length === 0 ? (
        <EmptyState icon={<Building2 />} title="No departments yet" description="Create one to group people into teams." action={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus /> New department</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {depts.data?.map((d, i) => (
            <motion.div key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Card className="group relative h-full overflow-hidden p-5">
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: d.color }} />
                <div className="flex items-start justify-between">
                  <span className="grid size-10 place-items-center rounded-xl" style={{ background: `${d.color}22`, color: d.color }}>
                    <Building2 className="size-5" />
                  </span>
                  {/* Always visible on touch screens, which have no hover. */}
                  <div className="flex transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
                    <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(d); setOpen(true); }} aria-label={`Edit ${d.name}`}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(d)} aria-label={`Delete ${d.name}`}>
                      <Trash2 className="text-danger" />
                    </Button>
                  </div>
                </div>
                <h3 className="mt-3 text-base font-semibold">{d.name}</h3>
                <p className="line-clamp-2 min-h-10 text-sm text-muted">{d.description || 'No description'}</p>
                <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
                  {d.head ? (
                    <span className="flex items-center gap-2">
                      <UserAvatar person={{ ...d.head, name: `${d.head.firstName} ${d.head.lastName}` }} size="xs" showPresence={false} />
                      <span className="text-muted">{d.head.firstName} {d.head.lastName}</span>
                    </span>
                  ) : (
                    <span className="text-muted">No head assigned</span>
                  )}
                  <Link href={`/admin/employees?dept=${d.id}`} className="flex items-center gap-1 rounded font-medium text-primary hover:underline" aria-label={`${d.memberCount} ${d.memberCount === 1 ? 'person' : 'people'} in ${d.name}. Open the list`}>
                    <Users className="size-3.5" /> {d.memberCount}
                  </Link>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
      <DeptDialog dept={editing} open={open} onOpenChange={setOpen} />
      {/* A department that announcements are addressed to cannot be deleted: say so instead of offering a button that fails. */}
      <Dialog open={!!deleting && blocked} onOpenChange={(o) => !o && setDeleting(null)} title={`${deleting?.name} can't be deleted yet`} className="max-w-md">
        <p className="text-sm text-muted">
          {deleting?.announcementCount} announcement{deleting?.announcementCount === 1 ? ' is' : 's are'} addressed to this department. Delete {deleting?.announcementCount === 1 ? 'it' : 'them'} or send {deleting?.announcementCount === 1 ? 'it' : 'them'} to everyone first, then
          come back here.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Got it
          </Button>
          {can(PERMISSIONS.ANNOUNCEMENTS_MANAGE) && (
            <Link href="/admin/announcements" className={buttonVariants()}>
              Open announcements
            </Link>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!deleting && !blocked}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description={`${deleting?.memberCount ?? 0} ${deleting?.memberCount === 1 ? 'person' : 'people'} will be left without a department. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}
