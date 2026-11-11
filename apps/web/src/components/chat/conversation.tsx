'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, Crown, LogOut, MessageSquareReply, MessagesSquare, Pencil, UserMinus, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RT, type TypingEvent } from '@fg/shared';
import { ChannelIcon } from '@/components/chat/channel-icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton, Tooltip } from '@/components/ui/misc';
import { StatusLine, UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useChannels } from '@/lib/hooks';
import { useLivePerson } from '@/lib/presence-store';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import type { ChannelDetails, ChatMessage, Employee } from '@/lib/types';
import { cn, fmtDate, fmtDayLabel, plural } from '@/lib/utils';
import { useUrlState } from '@/lib/url-state';
import { usePageTitle } from '@/lib/use-title';
import { mentionHandles, type MessagePage, type MessagePages } from './cache';
import { Composer } from './composer';
import { MessageItem } from './message-item';
import { PeoplePicker } from './new-conversation';

type Page = MessagePage;
type Pages = MessagePages;

/** How many older pages (40 messages each) a link to a message may load to find it. */
const MAX_SEEK_PAGES = 8;

function useTyping(channelId: string, meId: string) {
  const { socket } = useRealtime();
  const [typing, setTyping] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!socket) return;
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const on = (e: TypingEvent) => {
      if (e.channelId !== channelId || e.userId === meId) return;
      clearTimeout(timers[e.userId]);
      setTyping((t) => {
        const n = { ...t };
        if (e.typing) n[e.userId] = e.name.split(' ')[0]!;
        else delete n[e.userId];
        return n;
      });
      if (e.typing) timers[e.userId] = setTimeout(() => setTyping((t) => { const n = { ...t }; delete n[e.userId]; return n; }), 6000);
    };
    socket.on(RT.TYPING, on);
    return () => {
      socket.off(RT.TYPING, on);
      Object.values(timers).forEach(clearTimeout);
      setTyping({});
    };
  }, [socket, channelId, meId]);
  return Object.values(typing);
}

function TypingIndicator({ names }: { names: string[] }) {
  return (
    <div className="h-5 px-5 text-xs text-muted" aria-live="polite">
      <AnimatePresence>
        {names.length > 0 && (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1.5">
            <span className="inline-flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="size-1.5 rounded-full bg-muted" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
              ))}
            </span>
            <b className="font-semibold text-foreground">{names.slice(0, 3).join(', ')}</b> {names.length === 1 ? 'is' : 'are'} typing…
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function sendOptimistic(qc: ReturnType<typeof useQueryClient>, key: unknown[], me: ReturnType<typeof useSession>, channelId: string, body: string, parentId?: string) {
  const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const temp: ChatMessage = {
    id: clientId,
    clientId,
    channelId,
    parentId: parentId ?? null,
    body,
    deleted: false,
    editedAt: null,
    createdAt: new Date().toISOString(),
    replyCount: 0,
    author: { ...me.user, online: true },
    reactions: [],
    pending: true,
  };
  qc.setQueryData<Pages>(key, (old) => {
    if (!old) return old;
    const pages = [...old.pages];
    pages[0] = { ...pages[0]!, items: [...pages[0]!.items, temp] };
    return { ...old, pages };
  });
  return clientId;
}

/** Shared by the channel stream and the thread: who is who, and which @handles belong to this conversation. */
function usePeople(channel: ChannelDetails) {
  return useMemo(() => {
    const names = new Map(channel.members.map((m) => [m.id, m.firstName || m.name]));
    const mentionables = new Set(channel.members.flatMap((m) => mentionHandles(m).map((h) => h.toLowerCase())));
    return { nameOf: (id: string) => names.get(id), mentionables };
  }, [channel.members]);
}

function MessageStream({ channel, onReply, parentId, seekHash }: { channel: ChannelDetails; onReply?: (m: ChatMessage) => void; parentId?: string; /** Whether a #m-<id> link should be looked for in this list. */ seekHash: boolean }) {
  const me = useSession();
  const qc = useQueryClient();
  const key = useMemo(() => (parentId ? ['thread', parentId] : ['messages', channel.id]), [parentId, channel.id]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef(0);
  const { nameOf, mentionables } = usePeople(channel);
  /** Scrolled well away from the newest message. */
  const [away, setAway] = useState(false);
  /** Messages from other people that arrived while this list wasn't at the bottom (or the tab was hidden). */
  const [fresh, setFresh] = useState(0);
  /** The first message not read yet: a "New messages" line is drawn above it. */
  const [dividerId, setDividerId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page>(`/channels/${channel.id}/messages`, { query: { before: pageParam, limit: 40, parentId } }),
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.createdAt : undefined),
    // pages[0] holds the newest messages; older pages are appended after it.
    select: (d) => d,
  });

  // Flatten: oldest first.
  const messages = useMemo(() => (q.data ? [...q.data.pages].reverse().flatMap((p) => p.items) : []), [q.data]);
  const last = messages[messages.length - 1];
  const lastId = last?.id;

  // How many messages were unread when this conversation was opened (read once, before it is marked as read).
  // A conversation that isn't in the list yet (just started, or a channel being previewed) has nothing unread.
  const channelList = useChannels(!parentId).data;
  const unreadAtOpen = useRef<number | null>(null);
  if (unreadAtOpen.current === null && channelList) unreadAtOpen.current = channelList.find((c) => c.id === channel.id)?.unread ?? 0;
  const knowsUnread = unreadAtOpen.current !== null;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current && el.scrollTop < 50 && !atBottom.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current; // keep position after loading older
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = el.scrollHeight;
  }, [messages.length]);

  // A copied message link ends in #m-<id>: bring that message into view and highlight it,
  // loading earlier messages (a few pages at most) when it is older than what is on screen.
  const jumped = useRef(false);
  const seekTries = useRef(0);
  const [hashTick, setHashTick] = useState(0);
  useEffect(() => {
    const onHash = () => {
      jumped.current = false;
      seekTries.current = 0;
      setHashTick((t) => t + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const { hasNextPage, isFetching, fetchNextPage } = q;
  useEffect(() => {
    if (!seekHash || jumped.current || !messages.length) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#m-')) {
      jumped.current = true;
      return;
    }
    const el = document.getElementById(hash.slice(1));
    if (el && scrollRef.current?.contains(el)) {
      jumped.current = true;
      atBottom.current = false;
      el.scrollIntoView({ block: 'center' });
      el.dataset.highlight = 'true';
      setTimeout(() => delete el.dataset.highlight, 2500);
      return;
    }
    if (isFetching) return; // fresh data is on its way; look again when it lands
    if (hasNextPage && seekTries.current < MAX_SEEK_PAGES) {
      seekTries.current += 1;
      void fetchNextPage();
      return;
    }
    jumped.current = true;
    toast.info("That message isn't in the recent history", { description: 'It may be older than what is loaded here, or it was deleted. Scroll up to look for it.' });
  }, [seekHash, messages.length, isFetching, hasNextPage, fetchNextPage, hashTick]);

  // Where the unread messages start, worked out once from the unread count at opening time.
  const dividerDone = useRef(false);
  useEffect(() => {
    if (parentId || dividerDone.current || !knowsUnread || !messages.length || isFetching) return;
    dividerDone.current = true;
    let left = unreadAtOpen.current ?? 0;
    let first: string | null = null;
    for (let i = messages.length - 1; i >= 0 && left > 0; i--) {
      if (messages[i]!.author?.id === me.user.id) continue;
      left -= 1;
      first = messages[i]!.id;
    }
    if (!first) return;
    setDividerId(first);
    // Start reading at the first unread message, unless a link asked for a specific one.
    if (window.location.hash.startsWith('#m-')) return;
    const id = first;
    requestAnimationFrame(() => {
      const el = document.getElementById(`m-${id}`);
      const box = scrollRef.current;
      if (!el || !box?.contains(el)) return;
      if (el.getBoundingClientRect().top < box.getBoundingClientRect().top + 40) el.scrollIntoView({ block: 'center' });
    });
  }, [parentId, knowsUnread, messages, isFetching, me.user.id]);

  // Mark as read only when the newest message is actually on screen: the tab is visible and the list is at the bottom.
  const readId = useRef<string | undefined>(undefined);
  const markRead = useCallback(() => {
    if (!channel.isMember || parentId || !lastId || !knowsUnread || last?.pending || last?.failed) return;
    if (readId.current === lastId || document.visibilityState !== 'visible' || !atBottom.current) return;
    readId.current = lastId;
    setFresh(0);
    api(`/channels/${channel.id}/read`, { method: 'POST' })
      .then(() => {
        qc.setQueryData<{ id: string; unread: number }[]>(['channels'], (old) => old?.map((c) => (c.id === channel.id ? { ...c, unread: 0 } : c)));
      })
      .catch(() => {
        readId.current = undefined; // try again on the next chance
      });
  }, [channel.id, channel.isMember, parentId, lastId, knowsUnread, last?.pending, last?.failed, qc]);
  useEffect(() => {
    markRead();
    const onVisible = () => markRead();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [markRead]);

  // Count what arrives while the reader is elsewhere, and remember where it started.
  const prevLast = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevLast.current;
    prevLast.current = lastId;
    if (!prev || !lastId || prev === lastId) return;
    const at = messages.findIndex((m) => m.id === prev || m.clientId === prev);
    if (at < 0) return;
    const added = messages.slice(at + 1).filter((m) => m.author?.id !== me.user.id);
    if (!added.length || (atBottom.current && document.visibilityState === 'visible')) return;
    setFresh((n) => n + added.length);
    setDividerId((d) => d ?? added[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const onScroll = () => {
    const el = scrollRef.current!;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = gap < 80;
    setAway(gap > 320);
    if (atBottom.current) markRead();
    if (el.scrollTop < 120 && q.hasNextPage && !q.isFetchingNextPage) {
      prevHeight.current = el.scrollHeight;
      void q.fetchNextPage();
    }
  };
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setFresh(0);
    markRead();
  };

  const patchLocal = (clientId: string, change: (m: ChatMessage) => ChatMessage | null) =>
    qc.setQueryData<Pages>(key, (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.flatMap((x) => (x.clientId === clientId ? (change(x) ?? []) : x)) })) } : old,
    );
  const send = useMutation({
    mutationFn: (v: { body: string; clientId: string }) => api<ChatMessage>(`/channels/${channel.id}/messages`, { body: { body: v.body, clientId: v.clientId, parentId } }),
    onSuccess: (m) => {
      qc.setQueryData<Pages>(key, (old) => {
        if (!old) return old;
        const pages = old.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.clientId !== m.clientId && x.id !== m.id) }));
        pages[0] = { ...pages[0]!, items: [...pages[0]!.items, m] };
        return { ...old, pages };
      });
    },
    // Keep what was written: the message stays in place, marked "Not sent", with Try again and Delete.
    onError: (e, v) => {
      patchLocal(v.clientId, (x) => ({ ...x, pending: false, failed: true }));
      toast.error('Message not sent', { description: errorMessage(e) });
    },
  });
  const submit = (body: string) => {
    atBottom.current = true;
    setDividerId(null);
    setFresh(0);
    const clientId = sendOptimistic(qc, key, me, channel.id, body, parentId);
    send.mutate({ body, clientId });
  };
  const retry = (m: ChatMessage) => {
    if (!m.clientId) return;
    patchLocal(m.clientId, (x) => ({ ...x, pending: true, failed: false }));
    send.mutate({ body: m.body, clientId: m.clientId });
  };
  const discard = (m: ChatMessage) => m.clientId && patchLocal(m.clientId, () => null);
  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.author?.id === me.user.id && !m.deleted && !m.pending && !m.failed);
    if (mine) setEditingId(mine.id);
  };

  const draft = useSearchParams().get('draft') ?? undefined;
  const typing = useTyping(channel.id, me.user.id);
  const canModerate = channel.canManage;
  const label = channel.type === 'DIRECT' ? channel.members.filter((m) => m.id !== me.user.id).map((m) => m.firstName).join(', ') || 'yourself' : `#${channel.name}`;
  const failedToLoad = q.isError && !q.data;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-3" role="log" aria-label="Messages">
        {q.isFetchingNextPage && <p className="py-2 text-center text-xs text-muted">Loading earlier messages…</p>}
        {failedToLoad ? (
          <EmptyState
            className="h-full"
            icon={<MessagesSquare />}
            title={parentId ? "Replies couldn't be loaded" : "Messages couldn't be loaded"}
            description={errorMessage(q.error)}
            action={
              <Button variant="outline" loading={q.isFetching} onClick={() => void q.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            {!q.hasNextPage && !q.isPending && !parentId && <ChannelIntro channel={channel} />}
            {q.isPending &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3 px-4 py-2">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            {parentId && !q.isPending && messages.length === 0 && (
              <div className="px-5 pt-6 text-center">
                <MessageSquareReply className="mx-auto mb-2 size-5 text-subtle" />
                <p className="text-sm font-medium">No replies yet</p>
                <p className="mt-0.5 text-[13px] text-muted">Reply below to keep this discussion in one place.</p>
              </div>
            )}
          </>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const isFirstUnread = m.id === dividerId;
          const compact = !newDay && !isFirstUnread && !!prev && prev.author?.id === m.author?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          return (
            <Fragment key={m.clientId ?? m.id}>
              {newDay && (
                <div className="sticky top-0 z-[1] my-4 flex items-center gap-3 px-5">
                  <span className="rounded-md bg-canvas/90 py-0.5 text-xs font-semibold text-foreground backdrop-blur">{fmtDayLabel(m.createdAt)}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              {isFirstUnread && (
                <div className="mt-3 flex items-center gap-3 px-5" role="separator" aria-label="New messages">
                  <div className="h-px flex-1 bg-danger/50" />
                  <span className="text-[11px] font-semibold text-danger">New messages</span>
                </div>
              )}
              <MessageItem
                m={m}
                compact={compact}
                meId={me.user.id}
                canModerate={canModerate}
                onReply={onReply}
                inThread={!!parentId}
                editing={editingId === m.id}
                onEditingChange={(v) => setEditingId(v ? m.id : null)}
                onRetry={retry}
                onDiscard={discard}
                nameOf={nameOf}
                mentionables={mentionables}
              />
            </Fragment>
          );
        })}
      </div>
      <div className="relative">
        <AnimatePresence>
          {away && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} className="pointer-events-none absolute inset-x-0 bottom-full z-[2] mb-2 flex justify-center">
              <button
                type="button"
                onClick={jumpToLatest}
                className={cn(
                  'pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-md transition',
                  fresh > 0 ? 'border-transparent bg-primary text-primary-foreground hover:brightness-110' : 'bg-elevated text-muted hover:text-foreground',
                )}
              >
                <ArrowDown className="size-3.5" /> {fresh > 0 ? plural(fresh, 'new message') : 'Jump to latest'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <TypingIndicator names={parentId ? [] : typing} />
      </div>
      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
        {channel.isMember ? (
          <Composer
            channelId={channel.id}
            parentId={parentId}
            initial={parentId ? undefined : draft}
            placeholder={parentId ? 'Reply in thread…' : `Message ${label}`}
            members={channel.members}
            onEditLast={editLast}
            onSend={submit}
          />
        ) : (
          <JoinBar channel={channel} />
        )}
      </div>
    </div>
  );
}

function JoinBar({ channel }: { channel: ChannelDetails }) {
  const qc = useQueryClient();
  const join = useMutation({
    mutationFn: () => api(`/channels/${channel.id}/join`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['channel', channel.id] });
      void qc.invalidateQueries({ queryKey: ['channels'] });
      toast.success(`Joined #${channel.name}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-surface-2/60 px-4 py-3">
      <p className="text-sm">
        You&apos;re previewing <b>#{channel.name}</b>.
      </p>
      <Button onClick={() => join.mutate()} loading={join.isPending}>
        Join channel
      </Button>
    </div>
  );
}

function ChannelIntro({ channel }: { channel: ChannelDetails }) {
  const me = useSession();
  const others = channel.members.filter((m) => m.id !== me.user.id);
  return (
    <div className="px-5 pt-8 pb-2">
      {channel.type === 'DIRECT' ? (
        <>
          <div className="flex -space-x-2">
            {others.slice(0, 4).map((o) => (
              <UserAvatar key={o.id} person={o} size="lg" className="rounded-full ring-4 ring-canvas" />
            ))}
          </div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight">{others.map((o) => o.name).join(', ') || 'Notes to self'}</h3>
          <p className="text-sm text-muted">{others.length ? 'This is the start of your conversation.' : 'A private space for notes and reminders. Only you can see it.'}</p>
        </>
      ) : (
        <>
          <ChannelIcon channel={channel} size="lg" className="shadow-sm" />
          <h3 className="mt-3 text-xl font-semibold tracking-tight">Welcome to #{channel.name}</h3>
          <p className="text-sm text-muted">{channel.description || 'This is the very beginning of the channel.'}</p>
        </>
      )}
    </div>
  );
}

function MemberRow({ m, channel }: { m: ChannelDetails['members'][number]; channel: ChannelDetails }) {
  const me = useSession();
  const qc = useQueryClient();
  const live = useLivePerson(m);
  const [removing, setRemoving] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['channel', channel.id] });
  };
  const remove = useMutation({
    mutationFn: () => api(`/channels/${channel.id}/members/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`${m.firstName} was removed from #${channel.name}`);
      setRemoving(false);
      refresh();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setRemoving(false);
    },
  });
  const role = useMutation({
    mutationFn: (r: 'ADMIN' | 'MEMBER') => api(`/channels/${channel.id}/members/${m.id}`, { method: 'PATCH', body: { role: r } }),
    onSuccess: (_d, r) => {
      toast.success(r === 'ADMIN' ? `${m.firstName} is now a channel admin` : `${m.firstName} is no longer a channel admin`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const roleLabel = m.role === 'ADMIN' ? 'Remove as channel admin' : 'Make channel admin';
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <UserAvatar person={m} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{m.name}</span>
          {m.id === me.user.id && <span className="text-xs text-muted">(you)</span>}
          {m.role === 'ADMIN' && channel.type !== 'DIRECT' && <Badge tone="brand">Admin</Badge>}
        </span>
        <StatusLine person={live} />
      </span>
      {channel.canManage && channel.type !== 'DIRECT' && m.id !== me.user.id && (
        <span className="flex transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <Tooltip content={roleLabel} side="top">
            <button onClick={() => role.mutate(m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN')} disabled={role.isPending} className="rounded p-1.5 text-muted hover:bg-surface hover:text-primary disabled:opacity-50" aria-label={roleLabel}>
              <Crown className="size-4" />
            </button>
          </Tooltip>
          {!channel.isDefault && (
            <Tooltip content="Remove from channel" side="top">
              <button onClick={() => setRemoving(true)} className="rounded p-1.5 text-muted hover:bg-surface hover:text-danger" aria-label="Remove from channel">
                <UserMinus className="size-4" />
              </button>
            </Tooltip>
          )}
        </span>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${m.name}?`}
        description={`They will no longer see #${channel.name}${channel.type === 'PRIVATE' ? ' and will need a new invite to come back' : ', but can rejoin because it is a public channel'}.`}
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

function DetailsPanel({ channel, onClose }: { channel: ChannelDetails; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [toAdd, setToAdd] = useState<Employee[]>([]);
  const [form, setForm] = useState({ name: channel.name ?? '', description: channel.description ?? '', topic: channel.topic ?? '' });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['channel', channel.id] });
    void qc.invalidateQueries({ queryKey: ['channels'] });
  };
  const add = useMutation({
    mutationFn: () => api(`/channels/${channel.id}/members`, { body: { userIds: toAdd.map((p) => p.id) } }),
    onSuccess: () => {
      toast.success(`Added ${plural(toAdd.length, 'person', 'people')}`);
      setToAdd([]);
      setAdding(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => api(`/channels/${channel.id}`, { method: 'PATCH', body: { name: form.name, description: form.description || null, topic: form.topic || null } }),
    onSuccess: () => {
      toast.success('Channel updated');
      setEditing(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const leave = useMutation({
    mutationFn: () => api(`/channels/${channel.id}/leave`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`You left #${channel.name}`);
      refresh();
      router.push('/app/chat');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canAdd = channel.isMember && channel.type !== 'DIRECT' && (channel.type === 'PUBLIC' || channel.canManage);

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l bg-canvas md:w-80 md:shadow-lg xl:static xl:shrink-0 xl:shadow-none"
      aria-label="Conversation details"
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        <p className="text-sm font-semibold">Details</p>
        <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Close details">
          <X className="size-4" />
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
        {channel.type !== 'DIRECT' && (
          <div className="mb-5 space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted">About</p>
              {channel.canManage && (
                <button onClick={() => setEditing(true)} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-primary" aria-label="Edit channel">
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
            <p className="text-sm">{channel.description || <span className="text-muted">No description</span>}</p>
            {channel.topic && <p className="text-sm text-muted">Topic: {channel.topic}</p>}
            <p className="text-xs text-muted">Created {fmtDate(channel.createdAt)}</p>
          </div>
        )}
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-muted">{plural(channel.members.length, 'member')}</p>
          {canAdd && (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <UserPlus /> Add people
            </Button>
          )}
        </div>
        <ul className="space-y-0.5">
          {channel.members.map((m) => (
            <MemberRow key={m.id} m={m} channel={channel} />
          ))}
        </ul>
        {channel.isMember && channel.type !== 'DIRECT' && !channel.isDefault && (
          <Button variant="ghost" className="mt-4 w-full text-danger" onClick={() => setLeaving(true)}>
            <LogOut /> Leave channel
          </Button>
        )}
      </div>

      <Dialog open={adding} onOpenChange={setAdding} title={`Add people to #${channel.name}`}>
        <PeoplePicker selected={toAdd} onChange={setToAdd} exclude={channel.members.map((m) => m.id)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button disabled={!toAdd.length} loading={add.isPending} onClick={() => add.mutate()}>
            {toAdd.length ? `Add ${plural(toAdd.length, 'person', 'people')}` : 'Add people'}
          </Button>
        </div>
      </Dialog>
      <Dialog open={editing} onOpenChange={setEditing} title="Edit channel">
        <div className="space-y-4">
          <Field label="Name" htmlFor="ed-name" hint={channel.isDefault ? "This channel includes everyone, so its name can't be changed." : undefined}>
            <Input id="ed-name" value={form.name} disabled={channel.isDefault} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })} />
          </Field>
          <Field label="Topic" htmlFor="ed-topic">
            <Input id="ed-topic" value={form.topic} maxLength={160} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="ed-desc">
            <Textarea id="ed-desc" value={form.description} maxLength={240} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog open={leaving} onOpenChange={setLeaving} title={`Leave #${channel.name}?`} description="You can rejoin public channels any time. Private channels need an invite." confirmLabel="Leave" danger loading={leave.isPending} onConfirm={() => leave.mutate()} />
    </motion.aside>
  );
}

function ThreadPanel({ channel, parent, onClose }: { channel: ChannelDetails; parent: ChatMessage; onClose: () => void }) {
  const me = useSession();
  const { nameOf, mentionables } = usePeople(channel);
  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      // Floats over the conversation until the window is wide enough to give it its own column.
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l bg-canvas md:w-96 md:shadow-lg 2xl:static 2xl:shrink-0 2xl:shadow-none"
      aria-label="Thread"
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div>
          <p className="text-sm font-semibold">Thread</p>
          <p className="text-xs text-muted">{channel.type === 'DIRECT' ? 'Direct message' : `#${channel.name}`}</p>
        </div>
        <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Close thread">
          <X className="size-4" />
        </button>
      </div>
      <div className="border-b pb-2">
        <MessageItem m={parent} compact={false} meId={me.user.id} canModerate={channel.canManage} inThread nameOf={nameOf} mentionables={mentionables} />
      </div>
      <MessageStream channel={channel} parentId={parent.id} seekHash />
    </motion.aside>
  );
}

function HeaderTitle({ channel }: { channel: ChannelDetails }) {
  const me = useSession();
  const others = channel.members.filter((m) => m.id !== me.user.id);
  const first = others[0];
  const live = useLivePerson(first ?? { ...me.user, online: true });
  if (channel.type === 'DIRECT') {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        {first && <UserAvatar person={first} size="sm" />}
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold">{others.map((o) => o.name).join(', ') || 'Notes to self'}</h1>
          {first && others.length === 1 && <StatusLine person={live} />}
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <h1 className="flex items-center gap-1.5 text-[15px] font-semibold">
        <ChannelIcon channel={channel} size="sm" className="mr-1" />
        <span className="truncate">{channel.name}</span>
      </h1>
      {(channel.topic || channel.description) && <p className="truncate text-xs text-muted">{channel.topic || channel.description}</p>}
    </div>
  );
}

export function Conversation({ channelId }: { channelId: string }) {
  const me = useSession();
  const router = useRouter();
  // Open thread and details panel live in the URL so they survive a refresh and can be shared.
  const [getParam, setParam] = useUrlState({ thread: '', panel: '' });
  const threadId = getParam('thread');
  const details = getParam('panel') === 'details';
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['channel', channelId], queryFn: () => api<ChannelDetails>(`/channels/${channelId}`) });
  const cachedParent = threadId
    ? qc.getQueryData<Pages>(['messages', channelId])?.pages.flatMap((p) => p.items).find((m) => m.id === threadId)
    : undefined;
  const parentQ = useQuery({ queryKey: ['message', threadId], queryFn: () => api<ChatMessage>(`/messages/${threadId}`), enabled: !!threadId && !cachedParent });
  const thread = threadId ? (cachedParent ?? parentQ.data ?? null) : null;

  // Opening a panel adds a history entry, so the browser (or phone) Back button closes it instead of leaving the conversation.
  const pushed = useRef(false);
  const openPanel = (patch: { thread?: string | null; panel?: string | null }) => {
    const alreadyOpen = !!threadId || details;
    setParam(patch, { push: !alreadyOpen });
    if (!alreadyOpen) pushed.current = true;
  };
  const closePanel = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      router.back();
    } else setParam({ thread: null, panel: null });
  }, [router, setParam]);
  const setThread = (m: ChatMessage | null) => (m ? openPanel({ thread: m.id, panel: null }) : closePanel());
  const toggleDetails = () => (details && !threadId ? closePanel() : openPanel({ panel: 'details', thread: null }));

  // A thread link whose message is gone: say so and tidy the address.
  useEffect(() => {
    if (!threadId || !parentQ.isError) return;
    toast.error("That thread isn't available", { description: 'The message may have been deleted.' });
    setParam({ thread: null });
  }, [threadId, parentQ.isError, setParam]);

  // Esc closes the open panel, unless a dialog, menu or a half-written message has first claim on the key.
  const panelOpen = !!thread || details;
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"][id], [data-radix-popper-content-wrapper]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) && t.value) return;
      closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);

  const others = q.data?.type === 'DIRECT' ? q.data.members.filter((m) => m.id !== me.user.id) : [];
  const label = q.data ? (q.data.type === 'DIRECT' ? others.map((o) => o.name).join(', ') || 'Notes to self' : `#${q.data.name}`) : 'Chat';
  usePageTitle(label);

  if (q.isError) {
    return (
      <div className="grid h-full w-full place-items-center p-8">
        <EmptyState
          icon={<MessagesSquare />}
          title="This conversation isn't available"
          description={errorMessage(q.error)}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" loading={q.isFetching} onClick={() => void q.refetch()}>
                Try again
              </Button>
              <Link href="/app/chat" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-foreground">
                <ArrowLeft className="size-4" /> Back to conversations
              </Link>
            </div>
          }
        />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="w-full p-4" role="status" aria-label="Loading conversation">
        <Skeleton className="mb-4 h-10 w-64 max-w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  const channel = q.data;
  const detailsLabel = channel.type === 'DIRECT' ? 'Conversation details' : 'Channel details';
  return (
    <div className="relative flex h-full min-h-0 w-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/app/chat" className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 md:hidden" aria-label="Back to conversations">
              <ArrowLeft className="size-4" />
            </Link>
            <HeaderTitle channel={channel} />
          </div>
          <Tooltip content={`${detailsLabel} · ${plural(channel.members.length, 'member')}`} side="bottom">
            <button
              onClick={toggleDetails}
              aria-label={detailsLabel}
              aria-pressed={details && !thread}
              className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs text-muted transition hover:bg-surface-2 hover:text-foreground', details && !thread && 'bg-surface-2 text-foreground')}
            >
              <span className="flex -space-x-1.5">
                {channel.members.slice(0, 3).map((m) => (
                  <UserAvatar key={m.id} person={m} size="xs" showPresence={false} className="rounded-full ring-2 ring-canvas" />
                ))}
              </span>
              <Users className="size-3.5" /> <span className="tabular-nums">{channel.members.length}</span>
            </button>
          </Tooltip>
        </div>
        <MessageStream channel={channel} onReply={setThread} seekHash={!threadId} />
      </div>
      <AnimatePresence>
        {thread && <ThreadPanel key={thread.id} channel={channel} parent={thread} onClose={closePanel} />}
        {details && !thread && <DetailsPanel channel={channel} onClose={closePanel} />}
      </AnimatePresence>
    </div>
  );
}
