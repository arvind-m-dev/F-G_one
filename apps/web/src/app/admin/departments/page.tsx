'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS } from '@fg/shared';
import { Forbidden, LoadError, PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useDepartments, useEmployeeList } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import type { Department } from '@/lib/types';
import { cn } from '@/lib/utils';

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];

function DeptDialog({ dept, open, onOpenChange }: { dept: Department | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const people = useEmployeeList({ pageSize: 100 });
  const [form, setForm] = useState({ name: '', description: '', headId: '', color: COLORS[0]! });
  const [key, setKey] = useState<string | null>(null);
  const k = dept?.id ?? 'new';
  if (open && key !== k) {
    setKey(k);
    setForm({ name: dept?.name ?? '', description: dept?.description ?? '', headId: dept?.headId ?? '', color: dept?.color ?? COLORS[0]! });
  }
  if (!open && key) setKey(null);
  const save = useMutation({
    mutationFn: () =>
      api(dept ? `/departments/${dept.id}` : '/departments', { method: dept ? 'PATCH' : 'POST', body: { name: form.name, description: form.description || null, headId: form.headId || null, color: form.color } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success(dept ? 'Department updated' : 'Department created');
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={dept ? `Edit ${dept.name}` : 'New department'}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="d-name">
          <Input id="d-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Description" htmlFor="d-desc">
          <Textarea id="d-desc" rows={2} maxLength={240} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Department head" htmlFor="d-head">
          <Select id="d-head" value={form.headId} onChange={(e) => setForm({ ...form, headId: e.target.value })}>
            <option value="">— None —</option>
            {people.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">Colour</p>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className={cn('size-7 rounded-full transition hover:scale-110', form.color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={form.color === c} />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={form.name.trim().length < 2} onClick={() => save.mutate()}>
            {dept ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
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
        <EmptyState icon={<Building2 />} title="No departments yet" description="Create one to group people into teams." />
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
                  <Link href={`/app/people?dept=${d.id}`} className="flex items-center gap-1 font-medium text-primary" aria-label={`${d.memberCount} ${d.memberCount === 1 ? 'person' : 'people'} in ${d.name}`}>
                    <Users className="size-3.5" /> {d.memberCount}
                  </Link>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
      <DeptDialog dept={editing} open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description={
          deleting?.announcementCount
            ? `${deleting.announcementCount} announcement${deleting.announcementCount === 1 ? ' is' : 's are'} addressed to this department. Delete them or send them to everyone first.`
            : `${deleting?.memberCount ?? 0} ${deleting?.memberCount === 1 ? 'person' : 'people'} will be left without a department. This cannot be undone.`
        }
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}
