'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AtSign, Bell, BellOff, CheckCheck, ClipboardCheck, Megaphone, MessageSquare, MessageSquareReply, TreePalm } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Skeleton, Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api } from '@/lib/api';
import { useNotifications, useUnreadNotifications } from '@/lib/hooks';
import type { AppNotification } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

const TYPE_ICON = { dm: MessageSquare, mention: AtSign, thread: MessageSquareReply, announcement: Megaphone, leave: TreePalm, correction: ClipboardCheck } as const;

function Item({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const Icon = TYPE_ICON[n.type] ?? Bell;
  return (
    <li>
      <button onClick={() => onOpen(n)} className={cn('flex w-full gap-3 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-surface-2', !n.readAt && 'bg-primary-soft/50')}>
        <span className="relative mt-0.5 shrink-0">
          {n.actor ? (
            <UserAvatar person={{ ...n.actor, name: n.actor.displayName || `${n.actor.firstName} ${n.actor.lastName}` }} size="sm" showPresence={false} />
          ) : (
            <span className="grid size-8 place-items-center rounded-full bg-surface-2">
              <Icon className="size-4 text-muted" />
            </span>
          )}
          <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-canvas ring-1 ring-border">
            <Icon className="size-2.5 text-primary" />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13px] leading-snug', !n.readAt ? 'font-semibold' : 'font-medium text-foreground/80')}>
            {n.title}
            {n.count > 1 && <span className="ml-1 font-normal text-muted">· {n.count} messages</span>}
          </span>
          {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
          <span className="mt-1 block text-[11px] text-subtle">{timeAgo(n.createdAt)}</span>
        </span>
        {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
      </button>
    </li>
  );
}

/** Activity inbox: DMs, mentions, thread replies and announcements, grouped and filterable. */
export function NotificationInbox({ trigger, side = 'right' }: { trigger: (unread: number) => React.ReactNode; side?: 'right' | 'bottom' }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'mentions'>('all');
  const count = useUnreadNotifications();
  const list = useNotifications(filter, open);
  const unread = list.data?.unread ?? count.data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api<{ unread: number }>('/notifications/read', { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const openItem = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger(unread)}</PopoverTrigger>
      <PopoverContent side={side} align="start" className="w-[min(380px,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <div className="flex items-center gap-1">
            <Tooltip content="Mark all as read" side="bottom">
              <button onClick={() => markRead.mutate({ all: true })} disabled={!unread} className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground disabled:opacity-40" aria-label="Mark all as read">
                <CheckCheck className="size-4" />
              </button>
            </Tooltip>
            <Tooltip content="Notification settings" side="bottom">
              <Link href="/app/settings#notifications" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground" aria-label="Notification settings">
                <BellOff className="size-4" />
              </Link>
            </Tooltip>
          </div>
        </div>
        <div className="flex gap-1 border-b px-3 py-2" role="tablist" aria-label="Filter notifications">
          {([
            ['all', 'All'],
            ['unread', `Unread${unread ? ` (${unread})` : ''}`],
            ['mentions', 'Mentions & replies'],
          ] as const).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition', filter === v ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        <div className="scrollbar-thin max-h-[min(460px,65vh)] overflow-y-auto p-1.5">
          {list.isPending ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : !list.data?.items.length ? (
            <div className="px-6 py-10 text-center">
              <Bell className="mx-auto mb-2 size-6 text-subtle" />
              <p className="text-sm font-medium">{filter === 'unread' ? "You're all caught up" : 'No notifications yet'}</p>
              <p className="mt-1 text-xs text-muted">Direct messages, @mentions, replies and announcements show up here.</p>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {list.data.items.map((n) => (
                <Item key={n.id} n={n} onOpen={openItem} />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
