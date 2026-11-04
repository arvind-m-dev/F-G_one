'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ArrowLeft, Crown, Info, LogOut, Pencil, UserMinus, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RT, type TypingEvent } from '@fg/shared';
import { ChannelIcon } from '@/components/chat/channel-icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge, Skeleton } from '@/components/ui/misc';
import { StatusLine, UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useLivePerson } from '@/lib/presence-store';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import type { ChannelDetails, ChatMessage, Employee } from '@/lib/types';
import { cn, fmtDayLabel } from '@/lib/utils';
import { useUrlState } from '@/lib/url-state';
import { usePageTitle } from '@/lib/use-title';
import { Composer } from './composer';
import { MessageItem } from './message-item';
import { PeoplePicker } from './new-conversation';

type Page = { items: ChatMessage[]; hasMore: boolean };
type Pages = InfiniteData<Page, string | undefined>;

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

function MessageStream({ channel, onReply, parentId }: { channel: ChannelDetails; onReply?: (m: ChatMessage) => void; parentId?: string }) {
  const me = useSession();
  const qc = useQueryClient();
  const key = parentId ? ['thread', parentId] : ['messages', channel.id];
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef(0);

  const q = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page>(`/channels/${channel.id}/messages`, { query: { before: pageParam, limit: 40, parentId } }),
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.createdAt : undefined),
    // pages[0] holds the newest messages; older pages are appended after it.
    select: (d) => d,
  });

  // Flatten: oldest first.
  const messages = q.data ? [...q.data.pages].reverse().flatMap((p) => p.items) : [];

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

  // A copied message link ends in #m-<id>: bring that message into view once and highlight it.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !messages.length) return;
    jumped.current = true;
    const hash = window.location.hash;
    if (!hash.startsWith('#m-')) return;
    const el = document.getElementById(hash.slice(1));
    if (!el || !scrollRef.current?.contains(el)) return;
    atBottom.current = false;
    el.scrollIntoView({ block: 'center' });
    el.dataset.highlight = 'true';
    setTimeout(() => delete el.dataset.highlight, 2500);
  }, [messages.length]);

  // Mark as read when new messages arrive while viewing.
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!channel.isMember || parentId || !lastId) return;
    void api(`/channels/${channel.id}/read`, { method: 'POST' }).then(() => {
      qc.setQueryData<{ id: string; unread: number }[]>(['channels'], (old) => old?.map((c) => (c.id === channel.id ? { ...c, unread: 0 } : c)));
    });
  }, [lastId, channel.id, channel.isMember, parentId, qc]);

  const onScroll = () => {
    const el = scrollRef.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && q.hasNextPage && !q.isFetchingNextPage) {
      prevHeight.current = el.scrollHeight;
      void q.fetchNextPage();
    }
  };

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
    onError: (e, v) => {
      toast.error(errorMessage(e));
      qc.setQueryData<Pages>(key, (old) => (old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.clientId !== v.clientId) })) } : old));
    },
  });

  const draft = useSearchParams().get('draft') ?? undefined;
  const typing = useTyping(channel.id, me.user.id);
  const canModerate = channel.canManage;
  const label = channel.type === 'DIRECT' ? channel.members.filter((m) => m.id !== me.user.id).map((m) => m.firstName).join(', ') || 'yourself' : `#${channel.name}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-3" role="log" aria-label="Messages">
        {q.isFetchingNextPage && <p className="py-2 text-center text-xs text-muted">Loading earlier messages…</p>}
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
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const compact = !newDay && !!prev && prev.author?.id === m.author?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          return (
            <Fragment key={m.clientId ?? m.id}>
              {newDay && (
                <div className="sticky top-0 z-[1] my-4 flex items-center gap-3 px-5">
                  <span className="rounded-md bg-canvas/90 py-0.5 text-xs font-semibold text-foreground backdrop-blur">{fmtDayLabel(m.createdAt)}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <MessageItem m={m} compact={compact} meId={me.user.id} canModerate={canModerate} onReply={onReply} inThread={!!parentId} />
            </Fragment>
          );
        })}
      </div>
      <TypingIndicator names={parentId ? [] : typing} />
      <div className="px-4 pb-4 sm:px-5">
        {channel.isMember ? (
          <Composer
            channelId={channel.id}
            initial={parentId ? undefined : draft}
            placeholder={parentId ? 'Reply in thread…' : `Message ${label}`}
            onSend={(body) => {
              atBottom.current = true;
              const clientId = sendOptimistic(qc, key, me, channel.id, body, parentId);
              send.mutate({ body, clientId });
            }}
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
              <UserAvatar key={o.id} person={o} size="lg" className="rounded-full ring-4 ring-background" />
            ))}
          </div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight">{others.map((o) => o.name).join(', ') || 'Notes to self'}</h3>
          <p className="text-sm text-muted">This is the beginning of your direct message history.</p>
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
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['channel', channel.id] });
  };
  const remove = useMutation({ mutationFn: () => api(`/channels/${channel.id}/members/${m.id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const role = useMutation({
    mutationFn: (r: 'ADMIN' | 'MEMBER') => api(`/channels/${channel.id}/members/${m.id}`, { method: 'PATCH', body: { role: r } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <UserAvatar person={m} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{m.name}</span>
          {m.id === me.user.id && <span className="text-xs text-muted">(you)</span>}
          {m.role === 'ADMIN' && channel.type !== 'DIRECT' && <Badge tone="brand">admin</Badge>}
        </span>
        <StatusLine person={live} />
      </span>
      {channel.canManage && channel.type !== 'DIRECT' && m.id !== me.user.id && (
        <span className="flex transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <button onClick={() => role.mutate(m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN')} className="rounded p-1.5 text-muted hover:bg-surface hover:text-primary" aria-label={m.role === 'ADMIN' ? 'Remove admin' : 'Make admin'} title={m.role === 'ADMIN' ? 'Remove admin' : 'Make admin'}>
            <Crown className="size-4" />
          </button>
          {!channel.isDefault && (
            <button onClick={() => remove.mutate()} className="rounded p-1.5 text-muted hover:bg-surface hover:text-danger" aria-label="Remove from channel" title="Remove from channel">
              <UserMinus className="size-4" />
            </button>
          )}
        </span>
      )}
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
      toast.success(`Added ${toAdd.length} ${toAdd.length === 1 ? 'person' : 'people'}`);
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
      refresh();
      router.push('/app/chat');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canAdd = channel.isMember && channel.type !== 'DIRECT' && (channel.type === 'PUBLIC' || channel.canManage);

  return (
    <motion.aside initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} className="absolute inset-0 z-10 flex flex-col border-l bg-canvas xl:static xl:w-80 xl:shrink-0" aria-label="Conversation details">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <p className="text-sm font-semibold">Details</p>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close details">
          <X className="size-4" />
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
        {channel.type !== 'DIRECT' && (
          <div className="mb-5 space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">About</p>
              {channel.canManage && (
                <button onClick={() => setEditing(true)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-primary" aria-label="Edit channel">
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
            <p className="text-sm">{channel.description || <span className="text-muted">No description</span>}</p>
            {channel.topic && <p className="text-sm text-muted">Topic: {channel.topic}</p>}
            <p className="text-xs text-muted">Created {new Date(channel.createdAt).toLocaleDateString()}</p>
          </div>
        )}
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{channel.members.length} members</p>
          {canAdd && (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <UserPlus /> Add
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
        <div className="mt-4 flex justify-end">
          <Button disabled={!toAdd.length} loading={add.isPending} onClick={() => add.mutate()}>
            Add {toAdd.length || ''}
          </Button>
        </div>
      </Dialog>
      <Dialog open={editing} onOpenChange={setEditing} title="Edit channel">
        <div className="space-y-4">
          <Field label="Name" htmlFor="ed-name">
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
  return (
    <motion.aside initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} className="absolute inset-0 z-10 flex flex-col border-l bg-canvas lg:static lg:w-96 lg:shrink-0">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div>
          <p className="text-sm font-semibold">Thread</p>
          <p className="text-xs text-muted">{channel.type === 'DIRECT' ? 'Direct message' : `#${channel.name}`}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close thread">
          <X className="size-4" />
        </button>
      </div>
      <div className="border-b pb-2">
        <MessageItem m={parent} compact={false} meId={me.user.id} canModerate={channel.canManage} inThread />
      </div>
      <MessageStream channel={channel} parentId={parent.id} />
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
          <h1 className="truncate text-[15px] font-semibold">{others.map((o) => o.name).join(', ') || me.user.name}</h1>
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
  // Open thread and details panel live in the URL so they survive a refresh and can be shared.
  const [getParam, setParam] = useUrlState({ thread: '', panel: '' });
  const threadId = getParam('thread');
  const details = getParam('panel') === 'details';
  const setDetails = (fn: (d: boolean) => boolean) => setParam({ panel: fn(details) ? 'details' : null });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['channel', channelId], queryFn: () => api<ChannelDetails>(`/channels/${channelId}`) });
  const cachedParent = threadId
    ? qc.getQueryData<Pages>(['messages', channelId])?.pages.flatMap((p) => p.items).find((m) => m.id === threadId)
    : undefined;
  const parentQ = useQuery({ queryKey: ['message', threadId], queryFn: () => api<ChatMessage>(`/messages/${threadId}`), enabled: !!threadId && !cachedParent });
  const thread = threadId ? (cachedParent ?? parentQ.data ?? null) : null;
  const setThread = (m: ChatMessage | null) => setParam({ thread: m?.id ?? null, panel: null });
  const label = q.data ? (q.data.type === 'DIRECT' ? 'Direct message' : `#${q.data.name}`) : 'Chat';
  usePageTitle(label);

  if (q.isError) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="text-base font-semibold">Conversation unavailable</p>
          <p className="mt-1 text-sm text-muted">{errorMessage(q.error)}</p>
        </div>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="p-4">
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  const channel = q.data;
  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/app/chat" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 md:hidden" aria-label="Back to conversations">
              <ArrowLeft className="size-4" />
            </Link>
            <HeaderTitle channel={channel} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setDetails((d) => !d)} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs text-muted transition hover:bg-surface-2" aria-label="Members">
              <div className="flex -space-x-1.5">
                {channel.members.slice(0, 3).map((m) => (
                  <UserAvatar key={m.id} person={m} size="xs" showPresence={false} className="rounded-full ring-2 ring-surface" />
                ))}
              </div>
              <Users className="size-3.5" /> {channel.members.length}
            </button>
            <Button variant="ghost" size="icon-sm" onClick={() => setDetails((d) => !d)} aria-label="Channel details" className={cn(details && 'bg-surface-2')}>
              <Info />
            </Button>
          </div>
        </div>
        <MessageStream channel={channel} onReply={setThread} />
      </div>
      <AnimatePresence>
        {thread && <ThreadPanel key={thread.id} channel={channel} parent={thread} onClose={() => setThread(null)} />}
        {details && !thread && <DetailsPanel channel={channel} onClose={() => setDetails(() => false)} />}
      </AnimatePresence>
    </div>
  );
}
