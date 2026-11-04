'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { CalendarDays, ClipboardCheck, TreePalm, Clock, Hash, House, LogIn, Megaphone, Lock, MessageSquareText, MessagesSquare, Moon, Search, Settings, ShieldCheck, SlidersHorizontal, Sun, UserCircle2, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { UserAvatar } from '@/components/user-avatar';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useApprovalsCount } from '@/lib/hooks';
import { useCan, useModule, useSession, useUpdatePreferences } from '@/lib/session';
import type { Person } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

interface SearchResult {
  people: Person[];
  channels: { id: string; name: string; type: string; description: string | null }[];
  messages: { id: string; body: string; createdAt: string; channelId: string; channel: { name: string | null; type: string }; author: { firstName: string; lastName: string } | null }[];
}

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const itemCls = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[13px] aria-selected:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted';
const groupCls = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted';

/** ⌘K global search & command palette — searches people, channels and messages the user may see. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const can = useCan();
  const mod = useModule();
  const me = useSession();
  const approvals = useApprovalsCount();
  const savePrefs = useUpdatePreferences();
  const { setTheme, resolvedTheme } = useTheme();
  const isAdmin = [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.EMPLOYEES_MANAGE, PERMISSIONS.DEPARTMENTS_MANAGE, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_READ].some((p) => can(p));
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());
  const results = useQuery({ queryKey: ['search', term], queryFn: () => api<SearchResult>('/search', { query: { q: term } }), enabled: term.length >= 2 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const go = (href: string) => {
    onOpenChange(false);
    setQ('');
    router.push(href);
  };

  const openDm = async (id: string) => {
    try {
      const c = await api<{ id: string }>('/dm', { body: { userIds: [id] } });
      go(`/app/chat/${c.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0b0d11]/45 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <DialogPrimitive.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-elevated shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Search FG One</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search people, channels and messages, or jump to a page.</DialogPrimitive.Description>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b px-4">
              <Search className="size-4 text-muted" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search people, channels, messages…" className="h-13 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-muted" />
            </div>
            <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
              {term.length >= 2 && results.isFetching && !results.data && <div className="px-3 py-6 text-center text-sm text-muted">Searching…</div>}
              {term.length >= 2 && results.isError && !results.data && (
                <div role="alert" className="px-3 py-6 text-center text-sm text-danger">
                  Search isn&apos;t working right now. {errorMessage(results.error)}
                </div>
              )}
              {term.length >= 2 && results.data && !results.data.people.length && !results.data.channels.length && !results.data.messages.length && (
                <div className="px-3 py-8 text-center text-sm text-muted">No results for “{term}”</div>
              )}
              {term.length >= 2 && results.data && (
                <>
                  {results.data.people.length > 0 && (
                    <Command.Group heading="People" className={groupCls}>
                      {results.data.people.map((p) => (
                        <Command.Item key={p.id} value={`p-${p.id}`} onSelect={() => go(`/app/people/${p.id}`)} className={itemCls}>
                          <UserAvatar person={p} size="xs" />
                          <span className="font-medium">{p.name}</span>
                          <span className="truncate text-xs text-muted">{p.designation}</span>
                          {p.id !== me.user.id && mod('chat') && (
                            <button
                              className="ml-auto rounded-md px-2 py-0.5 text-xs text-primary hover:bg-primary/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openDm(p.id);
                              }}
                            >
                              Message
                            </button>
                          )}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {results.data.channels.length > 0 && (
                    <Command.Group heading="Channels" className={groupCls}>
                      {results.data.channels.map((c) => (
                        <Command.Item key={c.id} value={`c-${c.id}`} onSelect={() => go(`/app/chat/${c.id}`)} className={itemCls}>
                          {c.type === 'PRIVATE' ? <Lock /> : <Hash />}
                          <span className="font-medium">{c.name}</span>
                          <span className="truncate text-xs text-muted">{c.description}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {results.data.messages.length > 0 && (
                    <Command.Group heading="Messages" className={groupCls}>
                      {results.data.messages.map((m) => (
                        <Command.Item key={m.id} value={`m-${m.id}`} onSelect={() => go(`/app/chat/${m.channelId}`)} className={itemCls}>
                          <MessageSquareText />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{m.body}</span>
                            <span className="block text-xs text-muted">
                              {m.author ? `${m.author.firstName} ${m.author.lastName}` : 'Someone'} · {m.channel.type === 'DIRECT' ? 'Direct message' : `#${m.channel.name}`} · {timeAgo(m.createdAt)}
                            </span>
                          </span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                </>
              )}
              {term.length < 2 && (
                <Command.Group heading="Jump to" className={groupCls}>
                  <Command.Item onSelect={() => go('/app/home')} className={itemCls}>
                    <House /> Home
                  </Command.Item>
                  {mod('chat') && (
                  <Command.Item onSelect={() => go('/app/chat')} className={itemCls}>
                    <MessagesSquare /> Chat
                  </Command.Item>
                  )}
                  <Command.Item onSelect={() => go('/app/people')} className={itemCls}>
                    <Users /> Directory
                  </Command.Item>
                  {mod('attendance') && (
                  <Command.Item onSelect={() => go('/app/attendance')} className={itemCls}>
                    <LogIn /> Check in or out
                  </Command.Item>
                  )}
                  {mod('attendance') && (
                  <Command.Item onSelect={() => go('/app/attendance?range=30')} className={itemCls}>
                    <Clock /> My attendance history
                  </Command.Item>
                  )}
                  {mod('announcements') && (
                  <Command.Item onSelect={() => go('/app/announcements')} className={itemCls}>
                    <Megaphone /> Announcements
                  </Command.Item>
                  )}
                  {mod('leave') && (
                  <Command.Item onSelect={() => go('/app/leave?request=1')} className={itemCls}>
                    <TreePalm /> Request time off
                  </Command.Item>
                  )}
                  {mod('leave') && (
                  <Command.Item onSelect={() => go('/app/leave?tab=team')} className={itemCls}>
                    <TreePalm /> Who&apos;s away
                  </Command.Item>
                  )}
                  {mod('holidays') && (
                  <Command.Item onSelect={() => go('/app/holidays')} className={itemCls}>
                    <CalendarDays /> Holiday calendar
                  </Command.Item>
                  )}
                  {approvals.data?.canApprove && (
                  <Command.Item onSelect={() => go('/app/approvals')} className={itemCls}>
                    <ClipboardCheck /> Approvals
                  </Command.Item>
                  )}
                  <Command.Item onSelect={() => go('/app/profile')} className={itemCls}>
                    <UserCircle2 /> My profile
                  </Command.Item>
                  <Command.Item onSelect={() => go('/app/settings')} className={itemCls}>
                    <Settings /> Settings
                  </Command.Item>
                  {isAdmin && (
                    <Command.Item onSelect={() => go('/admin')} className={itemCls}>
                      <ShieldCheck /> Admin portal
                    </Command.Item>
                  )}
                  {can(PERMISSIONS.SETTINGS_MANAGE) && (
                    <Command.Item onSelect={() => go('/admin/settings')} className={itemCls}>
                      <SlidersHorizontal /> System settings
                    </Command.Item>
                  )}
                  <Command.Item
                    onSelect={() => {
                      const next = resolvedTheme === 'dark' ? 'light' : 'dark';
                      setTheme(next);
                      // Save it like the theme menu does, so it sticks on the next visit.
                      void savePrefs({ theme: next }).catch(() => undefined);
                      onOpenChange(false);
                    }}
                    className={itemCls}
                  >
                    {resolvedTheme === 'dark' ? <Sun /> : <Moon />} Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} mode
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
