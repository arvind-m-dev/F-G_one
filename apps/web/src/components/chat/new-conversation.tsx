'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, Lock, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createChannelSchema, type CreateChannelInput } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { StatusLine, UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useEmployeeList } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Searchable multi-select of colleagues. */
export function PeoplePicker({ selected, onChange, exclude = [], max }: { selected: Employee[]; onChange: (p: Employee[]) => void; exclude?: string[]; max?: number }) {
  const [q, setQ] = useState('');
  const list = useEmployeeList({ q: q || undefined, pageSize: 30 });
  const ids = new Set(selected.map((s) => s.id));
  const toggle = (p: Employee) => {
    if (ids.has(p.id)) onChange(selected.filter((s) => s.id !== p.id));
    else if (!full) onChange([...selected, p]);
  };
  const full = !!max && selected.length >= max;
  const shown = (list.data?.items ?? []).filter((p) => !exclude.includes(p.id));
  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-0.5 pr-1 pl-0.5 text-xs font-medium text-primary-ink">
              <UserAvatar person={p} size="xs" showPresence={false} />
              {p.firstName}
              <button type="button" onClick={() => toggle(p)} className="rounded-full p-0.5 hover:bg-primary/15" aria-label={`Remove ${p.name}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name, email or role" className="pl-9" aria-label="Search people" />
      </div>
      <ul className="scrollbar-thin mt-2 max-h-64 overflow-y-auto rounded-lg border" role="listbox" aria-multiselectable>
        {list.isPending &&
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2" aria-hidden>
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-40" />
            </li>
          ))}
        {list.isError && !list.data && (
          <li className="px-3 py-6 text-center text-sm">
            <p className="text-danger" role="alert">People couldn&apos;t be loaded. {errorMessage(list.error)}</p>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </li>
        )}
        {shown.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={ids.has(p.id)} aria-disabled={full && !ids.has(p.id)} onClick={() => toggle(p)} className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-surface-2', ids.has(p.id) && 'bg-primary-soft/60', full && !ids.has(p.id) && 'cursor-not-allowed opacity-50 hover:bg-transparent')}>
                <UserAvatar person={p} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted">{p.designation ?? p.email}</span>
                </span>
                <StatusLine person={p} className="hidden max-w-32 sm:inline-flex" />
                {ids.has(p.id) && <Check className="size-4 text-primary" />}
              </button>
            </li>
          ))}
        {list.data && shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{q ? `No one matches “${q}”.` : 'There is no one else to add.'}</li>}
      </ul>
      {max && (
        <p className={cn('mt-1.5 text-xs', full ? 'font-medium text-warning-ink' : 'text-muted')} aria-live="polite">
          {full ? `That's the most a group can have (${max} people). Remove someone to add another.` : `${selected.length} of ${max} chosen`}
        </p>
      )}
    </div>
  );
}

export function NewMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [people, setPeople] = useState<Employee[]>([]);
  const start = useMutation({
    mutationFn: () => api<{ id: string }>('/dm', { body: { userIds: people.map((p) => p.id) } }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['channels'] });
      onOpenChange(false);
      setPeople([]);
      router.push(`/app/chat/${c.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New message" description="Message one person, or up to 8 for a group conversation.">
      <PeoplePicker selected={people} onChange={setPeople} exclude={[me.user.id]} max={8} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button disabled={!people.length} loading={start.isPending} onClick={() => start.mutate()}>
          {people.length > 1 ? 'Start group conversation' : 'Open conversation'}
        </Button>
      </div>
    </Dialog>
  );
}

export function NewChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [members, setMembers] = useState<Employee[]>([]);
  const { register, handleSubmit, watch, setValue, reset, formState } = useForm<CreateChannelInput>({
    resolver: zodResolver(createChannelSchema),
    defaultValues: { name: '', description: '', visibility: 'PUBLIC', memberIds: [] },
  });
  const visibility = watch('visibility');
  const submit = handleSubmit(async (v) => {
    try {
      const c = await api<{ id: string }>('/channels', { body: { ...v, memberIds: members.map((m) => m.id) } });
      await qc.invalidateQueries({ queryKey: ['channels'] });
      toast.success(`#${v.name} created`);
      onOpenChange(false);
      reset();
      setMembers([]);
      router.push(`/app/chat/${c.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Create a channel" description="Channels are where teams and projects talk.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="ch-name" error={formState.errors.name?.message} hint="Lowercase, no spaces — e.g. project-apollo">
          <div className="relative">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted">#</span>
            <Input id="ch-name" className="pl-7" placeholder="project-apollo" {...register('name', { setValueAs: (v: string) => v.toLowerCase().replace(/\s+/g, '-') })} />
          </div>
        </Field>
        <Field label="Description (optional)" htmlFor="ch-desc">
          <Textarea id="ch-desc" rows={2} placeholder="What's this channel about?" {...register('description')} />
        </Field>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Visibility">
          {(
            [
              { v: 'PUBLIC', icon: Globe, title: 'Public', text: 'Anyone in the company can find and join' },
              { v: 'PRIVATE', icon: Lock, title: 'Private', text: 'Only invited members can see it' },
            ] as const
          ).map((o) => (
            <button
              type="button"
              role="radio"
              aria-checked={visibility === o.v}
              key={o.v}
              onClick={() => setValue('visibility', o.v)}
              className={cn('rounded-xl border p-3 text-left transition hover:border-primary/50', visibility === o.v && 'border-primary bg-primary-soft')}
            >
              <o.icon className="mb-1 size-4 text-primary" />
              <p className="text-sm font-semibold">{o.title}</p>
              <p className="text-xs text-muted">{o.text}</p>
            </button>
          ))}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Add members</p>
          <PeoplePicker selected={members} onChange={setMembers} exclude={[me.user.id]} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            Create channel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
