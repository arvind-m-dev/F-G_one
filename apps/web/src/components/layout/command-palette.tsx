'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { CalendarDays, ClipboardCheck, Clock, Hash, House, ListTodo, Lock, LogIn, Megaphone, MessageSquareText, MessagesSquare, Moon, Search, Settings, ShieldCheck, SlidersHorizontal, Sun, TreePalm, type LucideIcon, UserCircle2, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { UserAvatar } from '@/components/user-avatar';
import { toast } from 'sonner';
import { ADMIN_PERMS } from '@/lib/admin-perms';
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

/** A page or action the palette can jump to. `words` are extra terms people may type to find it. */
interface Destination {
  label: string;
  icon: LucideIcon;
  words?: string;
  href?: string;
  run?: () => void;
  show?: boolean;
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
const groupCls = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted';

/** Global search and command palette: pages, plus the people, channels and messages the user may see. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const can = useCan();
  const mod = useModule();
  const me = useSession();
  const approvals = useApprovalsCount();
  const savePrefs = useUpdatePreferences();
  const { setTheme, resolvedTheme } = useTheme();
  const isAdmin = ADMIN_PERMS.some((p) => can(p));
  const [q, setQ] = useState('');
  const typed = q.trim();
  const term = useDebounced(typed);
  const searching = typed.length >= 2;
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
  /** Opens the conversation at the message that was found. */
  const goToMessage = (channelId: string, messageId: string) => {
    const path = `/app/chat/${channelId}`;
    go(`${path}#m-${messageId}`);
    // Already in that conversation: the page doesn't reload, so tell the message list to look at the new address.
    if (pathname === path) setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 60);
  };

  const openDm = async (id: string) => {
    try {
      const c = await api<{ id: string }>('/dm', { body: { userIds: [id] } });
      go(`/app/chat/${c.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const destinations: Destination[] = [
    { label: 'Home', icon: House, href: '/app/home', words: 'dashboard start' },
    { label: 'Chat', icon: MessagesSquare, href: '/app/chat', words: 'messages channels conversations', show: mod('chat') },
    { label: 'My work', icon: ListTodo, href: '/app/work', words: 'tasks todo plan workload', show: mod('tasks') },
    { label: 'New task', icon: ListTodo, href: '/app/work?new=1', words: 'add create task todo bug', show: mod('tasks') },
    { label: 'Task board', icon: ListTodo, href: '/app/work?view=board', words: 'kanban board tasks status', show: mod('tasks') },
    { label: 'Projects', icon: ListTodo, href: '/app/work?view=projects', words: 'projects roadmap timeline', show: mod('tasks') },
    { label: 'Daily work report', icon: ListTodo, href: '/app/work?view=report', words: 'report done finished overdue', show: mod('tasks') },
    { label: 'Directory', icon: Users, href: '/app/people', words: 'people colleagues employees team' },
    { label: 'Check in or out', icon: LogIn, href: '/app/attendance', words: 'attendance break', show: mod('attendance') },
    { label: 'My attendance history', icon: Clock, href: '/app/attendance?range=30', words: 'hours worked correction', show: mod('attendance') },
    { label: 'Announcements', icon: Megaphone, href: '/app/announcements', words: 'news notices', show: mod('announcements') },
    { label: 'Request time off', icon: TreePalm, href: '/app/leave?request=1', words: 'leave holiday vacation sick', show: mod('leave') },
    { label: "Who's away", icon: TreePalm, href: '/app/leave?tab=team', words: 'leave calendar team absent', show: mod('leave') },
    { label: 'Holiday calendar', icon: CalendarDays, href: '/app/holidays', words: 'holidays days off', show: mod('holidays') },
    { label: 'Approvals', icon: ClipboardCheck, href: '/app/approvals', words: 'approve leave requests corrections', show: !!approvals.data?.canApprove },
    { label: 'My profile', icon: UserCircle2, href: '/app/profile', words: 'photo bio password account' },
    { label: 'Settings', icon: Settings, href: '/app/settings', words: 'preferences theme notifications security' },
    { label: 'Admin portal', icon: ShieldCheck, href: '/admin', words: 'administration manage', show: isAdmin },
    { label: 'System settings', icon: SlidersHorizontal, href: '/admin/settings', words: 'company organization configuration', show: can(PERMISSIONS.SETTINGS_MANAGE) },
    {
      label: `Switch to ${nextTheme} mode`,
      icon: nextTheme === 'light' ? Sun : Moon,
      words: 'theme appearance dark light',
      run: () => {
        setTheme(nextTheme);
        // Save it like the theme menu does, so it sticks on the next visit.
        void savePrefs({ theme: nextTheme });
        onOpenChange(false);
      },
    },
  ].filter((d) => d.show !== false);
  const needle = typed.toLowerCase();
  const pages = needle ? destinations.filter((d) => `${d.label} ${d.words ?? ''}`.toLowerCase().includes(needle)) : destinations;
  const found = results.data;
  const nothingFound = searching && typed === term && !results.isFetching && !!found && !found.people.length && !found.channels.length && !found.messages.length;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in" />
        <DialogPrimitive.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-elevated shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Search FG One</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search pages, people, channels and messages.</DialogPrimitive.Description>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b px-4">
              <Search className="size-4 text-muted" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search pages, people, channels and messages" className="h-13 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-muted" />
            </div>
            <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
              {pages.length > 0 && (
                <Command.Group heading={needle ? 'Pages' : 'Jump to'} className={groupCls}>
                  {pages.map((d) => (
                    <Command.Item key={d.label} value={`page-${d.label}`} onSelect={() => (d.run ? d.run() : go(d.href!))} className={itemCls}>
                      <d.icon /> {d.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {searching && results.isFetching && !found && <div className="px-3 py-6 text-center text-sm text-muted">Searching…</div>}
              {searching && results.isError && !found && (
                <div role="alert" className="px-3 py-6 text-center text-sm text-danger">
                  Search isn&apos;t working right now. {errorMessage(results.error)}
                </div>
              )}
              {needle && !searching && pages.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">Keep typing to search people, channels and messages.</div>}
              {nothingFound && pages.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">No results for “{term}”</div>}
              {searching && found && (
                <>
                  {found.people.length > 0 && (
                    <Command.Group heading="People" className={groupCls}>
                      {found.people.map((p) => (
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
                  {found.channels.length > 0 && (
                    <Command.Group heading="Channels" className={groupCls}>
                      {found.channels.map((c) => (
                        <Command.Item key={c.id} value={`c-${c.id}`} onSelect={() => go(`/app/chat/${c.id}`)} className={itemCls}>
                          {c.type === 'PRIVATE' ? <Lock /> : <Hash />}
                          <span className="font-medium">{c.name}</span>
                          <span className="truncate text-xs text-muted">{c.description}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {found.messages.length > 0 && (
                    <Command.Group heading="Messages" className={groupCls}>
                      {found.messages.map((m) => (
                        <Command.Item key={m.id} value={`m-${m.id}`} onSelect={() => goToMessage(m.channelId, m.id)} className={itemCls}>
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
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
