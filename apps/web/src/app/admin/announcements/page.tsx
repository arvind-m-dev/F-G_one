'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, MoreHorizontal, Pencil, Pin, Plus, Trash2, Users } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ANNOUNCEMENT_CATEGORIES, announcementSchema, PERMISSIONS, type AnnouncementInput } from '@fg/shared';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { categoryLabel, priorityLabel, priorityTone } from '@/components/announcements/announcement-reader';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, InfoHint, Skeleton, Switch } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useAnnouncements, useDepartments } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import type { Announcement } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { timeAgo } from '@/lib/utils';

type Person = { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null };

function Composer({ editing, open, onOpenChange }: { editing: Announcement | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const depts = useDepartments();
  const form = useForm<AnnouncementInput>({ resolver: zodResolver(announcementSchema) });
  useEffect(() => {
    if (!open) return;
    form.reset({
      title: editing?.title ?? '',
      body: editing?.body ?? '',
      category: editing?.category ?? 'COMPANY_NEWS',
      priority: editing?.priority ?? 'NORMAL',
      departmentId: editing?.departmentId ?? null,
      pinned: editing?.pinned ?? false,
      requireAck: editing?.requireAck ?? false,
      expiresAt: editing?.expiresAt ?? null,
    });
  }, [open, editing, form]);
  const err = form.formState.errors;
  const expires = form.watch('expiresAt');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} side="right" title={editing ? 'Edit announcement' : 'New announcement'} description={editing ? 'Changes are visible immediately. Readers are not notified again.' : 'Everyone in the audience gets a notification.'} className="max-w-xl">
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await api(editing ? `/announcements/${editing.id}` : '/announcements', { method: editing ? 'PATCH' : 'POST', body: { ...v, departmentId: v.departmentId || null, expiresAt: v.expiresAt || null } });
            void qc.invalidateQueries({ queryKey: ['announcements'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
            toast.success(editing ? 'Announcement updated' : 'Announcement published');
            onOpenChange(false);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}
      >
        <Field label="Title" htmlFor="a-title" error={err.title?.message}>
          <Input id="a-title" autoFocus placeholder="e.g. Office closed on Friday" {...form.register('title')} />
        </Field>
        <Field label="Message" htmlFor="a-body" error={err.body?.message} hint="Plain text. Line breaks are kept.">
          <Textarea id="a-body" rows={8} {...form.register('body')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="a-cat">
            <Select id="a-cat" {...form.register('category')}>
              {ANNOUNCEMENT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Importance" htmlFor="a-pri">
            <Select id="a-pri" {...form.register('priority')}>
              <option value="NORMAL">Normal</option>
              <option value="IMPORTANT">Important</option>
              <option value="CRITICAL">Urgent</option>
            </Select>
          </Field>
          <Field label="Who should see it?" htmlFor="a-dept">
            <Select id="a-dept" {...form.register('departmentId', { setValueAs: (v) => v || null })}>
              <option value="">Everyone in the company</option>
              {depts.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} only
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hide after (optional)" htmlFor="a-exp">
            <Input id="a-exp" type="date" value={expires ? expires.slice(0, 10) : ''} onChange={(e) => form.setValue('expiresAt', e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null)} />
          </Field>
        </div>
        <div className="divide-y rounded-xl border">
          <label className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span>
              <span className="block font-medium">Pin to the top</span>
              <span className="text-xs text-muted">Stays first on the Announcements page and Home.</span>
            </span>
            <Switch checked={form.watch('pinned')} onCheckedChange={(v) => form.setValue('pinned', v)} />
          </label>
          <label className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span>
              <span className="block font-medium">Ask people to confirm they read it</span>
              <span className="text-xs text-muted">You can see who has and hasn&apos;t confirmed.</span>
            </span>
            <Switch checked={form.watch('requireAck')} onCheckedChange={(v) => form.setValue('requireAck', v)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            {editing ? 'Save changes' : 'Publish'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Readers({ a, onClose }: { a: Announcement | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['announcements', 'acks', a?.id], queryFn: () => api<{ acknowledged: (Person & { at: string })[]; pending: Person[] }>(`/announcements/${a!.id}/acks`), enabled: !!a });
  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && onClose()} title="Read confirmations" description={a?.title}>
      {!q.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {([
            ['Confirmed', q.data.acknowledged],
            ['Not yet', q.data.pending],
          ] as const).map(([label, people]) => (
            <div key={label}>
              <p className="mb-2 text-xs font-medium text-muted">
                {label} · {people.length}
              </p>
              <ul className="space-y-1.5">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-[13px]">
                    <UserAvatar person={{ ...p, name: `${p.firstName} ${p.lastName}` }} size="xs" showPresence={false} />
                    {p.firstName} {p.lastName}
                    {'at' in p && <span className="ml-auto text-xs text-subtle">{timeAgo((p as { at: string }).at)}</span>}
                  </li>
                ))}
                {!people.length && <li className="text-[13px] text-subtle">No one</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function AdminAnnouncements() {
  const can = useCan();
  const qc = useQueryClient();
  const [get, set] = useUrlState({ compose: '' });
  const list = useAnnouncements({ include: 'all' });
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [readers, setReaders] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api(`/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Announcement deleted');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can(PERMISSIONS.ANNOUNCEMENTS_MANAGE)) return <Forbidden />;
  const composeOpen = get('compose') === '1' || !!editing;
  const now = Date.now();

  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        title="Announcements"
        description="Publish news to everyone or one department, pin what matters, and track who has read it."
        actions={
          <Button onClick={() => set({ compose: '1' })}>
            <Plus /> New announcement
          </Button>
        }
      />
      {list.isPending ? (
        <Skeleton className="h-64" />
      ) : !list.data?.length ? (
        <EmptyState icon={<Megaphone />} title="No announcements yet" description="Your first announcement will appear on everyone's Home." action={<Button onClick={() => set({ compose: '1' })}>Write one</Button>} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {list.data.map((a) => {
            const expired = a.expiresAt && new Date(a.expiresAt).getTime() < now;
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-4 px-4 py-4 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="font-medium text-foreground/80">{categoryLabel(a.category)}</span>· {a.department?.name ?? 'Everyone'} · {timeAgo(a.publishedAt)}
                    {a.pinned && <Pin className="size-3" aria-label="Pinned" />}
                    {a.priority !== 'NORMAL' && <Badge tone={priorityTone[a.priority]}>{priorityLabel[a.priority]}</Badge>}
                    {expired && <Badge tone="muted">Hidden (expired)</Badge>}
                  </div>
                  <p className="mt-1 text-[15px] font-semibold">{a.title}</p>
                  <p className="line-clamp-1 text-sm text-muted">{a.body}</p>
                </div>
                <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                  {a.requireAck ? (
                    <button onClick={() => setReaders(a)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs text-muted transition hover:border-border-strong hover:text-foreground">
                      <Users className="size-3.5" /> {a.ackCount} confirmed
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-subtle">
                      No confirmation <InfoHint>Turn on &ldquo;Ask people to confirm&rdquo; when editing to track who has read it.</InfoHint>
                    </span>
                  )}
                  <DropdownMenu>
                    <DropdownTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.title}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownTrigger>
                    <DropdownContent>
                      <DropdownItem onSelect={() => setEditing(a)}>
                        <Pencil /> Edit
                      </DropdownItem>
                      {a.requireAck && (
                        <DropdownItem onSelect={() => setReaders(a)}>
                          <Users /> Who has read it
                        </DropdownItem>
                      )}
                      <DropdownSeparator />
                      <DropdownItem danger onSelect={() => setDeleting(a)}>
                        <Trash2 /> Delete
                      </DropdownItem>
                    </DropdownContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Composer
        editing={editing}
        open={composeOpen}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            set({ compose: null });
          }
        }}
      />
      <Readers a={readers} onClose={() => setReaders(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="It disappears for everyone, including read confirmations. This can't be undone."
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AdminAnnouncements />
    </Suspense>
  );
}
