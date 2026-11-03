'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Compass, MessageSquarePlus, Plus, Search, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge, Skeleton, Tooltip } from '@/components/ui/misc';
import { ChannelIcon } from '@/components/chat/channel-icon';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { channelLabel, useChannels } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import type { ChannelSummary } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { NewChannelDialog, NewMessageDialog } from './new-conversation';

interface BrowseChannel {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  isMember: boolean;
  isDefault: boolean;
}

export function BrowseChannelsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = useState('');
  const browse = useQuery({ queryKey: ['channels', 'browse'], queryFn: () => api<BrowseChannel[]>('/channels/browse'), enabled: open });
  const join = useMutation({
    mutationFn: (id: string) => api(`/channels/${id}/join`, { method: 'POST' }),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['channels'] });
      onOpenChange(false);
      router.push(`/app/chat/${id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = (browse.data ?? []).filter((c) => !q || c.name.includes(q.toLowerCase()) || c.description?.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Browse channels" description="Public channels anyone in the company can join.">
      <div className="relative mb-3">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels" className="pl-9" aria-label="Search channels" autoFocus />
      </div>
      <ul className="divide-y rounded-xl border">
        {browse.isPending && <li className="p-4"><Skeleton className="h-10" /></li>}
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
            <ChannelIcon channel={{ id: c.id, type: 'PUBLIC' }} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                {c.name} {c.isDefault && <Badge tone="muted">Everyone</Badge>}
              </p>
              <p className="truncate text-xs text-muted">
                {c.memberCount} members{c.description ? ` · ${c.description}` : ''}
              </p>
            </div>
            {c.isMember ? (
              <Button size="sm" variant="ghost" onClick={() => { onOpenChange(false); router.push(`/app/chat/${c.id}`); }}>
                Open
              </Button>
            ) : (
              <Button size="sm" variant="outline" loading={join.isPending && join.variables === c.id} onClick={() => join.mutate(c.id)}>
                Join
              </Button>
            )}
          </li>
        ))}
        {browse.data && list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No channels match.</li>}
      </ul>
    </Dialog>
  );
}

function Row({ c }: { c: ChannelSummary }) {
  const pathname = usePathname();
  const active = pathname === `/app/chat/${c.id}`;
  const other = c.participants[0];
  return (
    <Link
      href={`/app/chat/${c.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn('flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2', active && 'bg-primary-soft hover:bg-primary-soft')}
    >
      {c.type === 'DIRECT' ? (
        c.participants.length > 1 ? (
          // Group message: two overlapping avatars
          <span className="relative size-8 shrink-0" aria-hidden>
            <UserAvatar person={c.participants[0]!} size="xs" showPresence={false} className="absolute top-0 left-0" />
            <UserAvatar person={c.participants[1]!} size="xs" showPresence={false} className="absolute right-0 bottom-0 ring-2 ring-canvas rounded-full" />
          </span>
        ) : other ? (
          <UserAvatar person={other} size="sm" />
        ) : (
          <span className="size-8 rounded-full bg-surface-2" />
        )
      ) : (
        <ChannelIcon channel={c} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('truncate text-[13px]', c.unread ? 'font-semibold text-foreground' : 'font-medium', active && 'text-primary-ink')}>{channelLabel(c)}</span>
          <span className="ml-auto shrink-0 text-[11px] text-subtle">{c.lastMessage ? timeAgo(c.lastMessage.createdAt) : ''}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className={cn('truncate text-xs', c.unread ? 'text-foreground/80' : 'text-muted')}>
            {c.lastMessage ? `${c.type !== 'DIRECT' && c.lastMessage.authorName ? `${c.lastMessage.authorName}: ` : ''}${c.lastMessage.body}` : c.description || 'No messages yet'}
          </span>
          {c.unread > 0 && !active && <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white tabular-nums">{c.unread}</span>}
        </span>
      </span>
    </Link>
  );
}

function Section({ title, count, children, action }: { title: string; count: number; children: React.ReactNode; action?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div className="flex items-center justify-between px-2 pt-4 pb-1">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-medium text-subtle hover:text-foreground" aria-expanded={open}>
          <ChevronDown className={cn('size-3 transition-transform', !open && '-rotate-90')} />
          {title} <span className="tabular-nums">{count}</span>
        </button>
        {action}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="space-y-px overflow-hidden">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Middle pane: searchable conversation list with previews and unread counts. */
export function ConversationList() {
  const can = useCan();
  const channels = useChannels();
  const [q, setQ] = useState('');
  const [newChannel, setNewChannel] = useState(false);
  const [newDm, setNewDm] = useState(false);
  const [browse, setBrowse] = useState(false);
  const all = (channels.data ?? []).filter((c) => !q || channelLabel(c).toLowerCase().includes(q.toLowerCase()));
  const groups = all.filter((c) => c.type !== 'DIRECT').sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || (a.name ?? '').localeCompare(b.name ?? ''));
  const dms = all.filter((c) => c.type === 'DIRECT');

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <h1 className="text-base font-semibold">Chat</h1>
        <div className="flex gap-0.5">
          <Tooltip content="Browse channels" side="bottom">
            <Button variant="ghost" size="icon-sm" onClick={() => setBrowse(true)} aria-label="Browse channels">
              <Compass />
            </Button>
          </Tooltip>
          <Tooltip content="New message" side="bottom">
            <Button variant="ghost" size="icon-sm" onClick={() => setNewDm(true)} aria-label="New message">
              <MessageSquarePlus />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="px-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a conversation" aria-label="Find a conversation" className="h-8 w-full rounded-lg bg-surface-2 pr-2 pl-8 text-[13px] outline-none placeholder:text-subtle focus:ring-2 focus:ring-primary-soft" />
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-20 md:pb-4">
        {channels.isPending &&
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex gap-2.5 px-2 py-2">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        {channels.data && (
          <>
            <Section
              title="Channels"
              count={groups.length}
              action={
                can(PERMISSIONS.CHANNELS_CREATE) && (
                  <button onClick={() => setNewChannel(true)} className="rounded p-0.5 text-subtle hover:text-foreground" aria-label="Create channel">
                    <Plus className="size-3.5" />
                  </button>
                )
              }
            >
              {groups.map((c) => (
                <Row key={c.id} c={c} />
              ))}
            </Section>
            <Section
              title="Direct messages"
              count={dms.length}
              action={
                <button onClick={() => setNewDm(true)} className="rounded p-0.5 text-subtle hover:text-foreground" aria-label="New direct message">
                  <Plus className="size-3.5" />
                </button>
              }
            >
              {dms.map((c) => (
                <Row key={c.id} c={c} />
              ))}
              {dms.length === 0 && (
                <button onClick={() => setNewDm(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-muted hover:bg-surface-2">
                  <Users className="size-4" /> Message a teammate
                </button>
              )}
            </Section>
            {q && all.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-muted">No conversations match &ldquo;{q}&rdquo;.</p>}
          </>
        )}
      </div>
      <NewChannelDialog open={newChannel} onOpenChange={setNewChannel} />
      <NewMessageDialog open={newDm} onOpenChange={setNewDm} />
      <BrowseChannelsDialog open={browse} onOpenChange={setBrowse} />
    </div>
  );
}
