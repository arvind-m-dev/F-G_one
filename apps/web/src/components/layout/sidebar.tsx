'use client';
import { PERMISSIONS, presenceMeta } from '@fg/shared';
import {
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Hash,
  Home,
  KeyRound,
  LayoutDashboard,
  Lock,
  MessagesSquare,
  Plus,
  ScrollText,
  Settings,
  UserCircle2,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { NewChannelDialog, NewMessageDialog } from '@/components/chat/new-conversation';
import { StatusPicker } from '@/components/status-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { channelLabel, useChannels } from '@/lib/hooks';
import { useLivePerson } from '@/lib/presence-store';
import { useCan, useModule, useSession } from '@/lib/session';
import type { ChannelSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  match?: (p: string) => boolean;
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = item.match ? item.match(pathname) : pathname === item.href;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-sidebar-fg/75 transition-colors hover:bg-surface-2 hover:text-sidebar-fg',
        active && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && <motion.span layoutId="nav-active" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary" />}
      <item.icon className="size-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!!item.badge && (
        <span className={cn('grid min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[10px] font-bold text-white', collapsed ? 'absolute -top-0.5 -right-0.5 h-4 min-w-4' : 'ml-auto h-5')}>
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </Link>
  );
  return collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link;
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2.5 pt-5 pb-1.5">
      <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{children}</span>
      {action}
    </div>
  );
}

function ChannelRow({ c, onNavigate }: { c: ChannelSummary; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === `/chat/${c.id}`;
  const other = c.participants[0];
  const label = channelLabel(c);
  return (
    <Link
      href={`/chat/${c.id}`}
      onClick={onNavigate}
      className={cn(
        'flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-sidebar-fg/70 transition-colors hover:bg-surface-2 hover:text-sidebar-fg',
        c.unread > 0 && 'font-semibold text-sidebar-fg',
        active && 'bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary',
      )}
    >
      {c.type === 'DIRECT' ? (
        other ? <UserAvatar person={other} size="xs" /> : <UserCircle2 className="size-4" />
      ) : c.type === 'PRIVATE' ? (
        <Lock className="size-3.5 shrink-0 opacity-70" />
      ) : (
        <Hash className="size-3.5 shrink-0 opacity-70" />
      )}
      <span className="truncate">{label}</span>
      {c.type === 'DIRECT' && other && c.participants.length === 1 && <DmStatus person={other} />}
      {c.unread > 0 && !active && <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
    </Link>
  );
}

function DmStatus({ person }: { person: ChannelSummary['participants'][number] }) {
  const live = useLivePerson(person);
  if (!live.statusEmoji) return null;
  return (
    <span className="text-xs" title={live.statusText ?? presenceMeta(live.presence).label}>
      {live.statusEmoji}
    </span>
  );
}

export function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle: () => void; onNavigate?: () => void }) {
  const me = useSession();
  const can = useCan();
  const mod = useModule();
  const chatOn = mod('chat');
  const channels = useChannels(chatOn);
  const [newChannel, setNewChannel] = useState(false);
  const [newDm, setNewDm] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const live = useLivePerson({ ...me.user, online: true });

  const groups = (channels.data ?? []).filter((c) => c.type !== 'DIRECT').sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const dms = (channels.data ?? []).filter((c) => c.type === 'DIRECT');
  const unreadTotal = (channels.data ?? []).reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);

  const main: NavItem[] = [
    { href: '/home', label: 'Home', icon: Home },
    ...(chatOn ? [{ href: '/chat', label: 'Messages', icon: MessagesSquare, badge: unreadTotal, match: (p: string) => p.startsWith('/chat') }] : []),
    { href: '/people', label: 'People', icon: Users, match: (p: string) => p.startsWith('/people') },
    { href: '/profile', label: 'My profile', icon: UserCircle2 },
  ];
  const admin: NavItem[] = [
    ...(can(PERMISSIONS.ANALYTICS_VIEW) ? [{ href: '/admin', label: 'Overview', icon: LayoutDashboard }] : []),
    ...(can(PERMISSIONS.EMPLOYEES_MANAGE) ? [{ href: '/admin/employees', label: 'Employees', icon: Users }] : []),
    ...(can(PERMISSIONS.DEPARTMENTS_MANAGE) ? [{ href: '/admin/departments', label: 'Departments', icon: Building2 }] : []),
    ...(can(PERMISSIONS.EMPLOYEES_MANAGE) ? [{ href: '/admin/roles', label: 'Roles & access', icon: KeyRound }] : []),
    ...(can(PERMISSIONS.SETTINGS_MANAGE) ? [{ href: '/admin/settings', label: 'Company settings', icon: Settings }] : []),
    ...(can(PERMISSIONS.AUDIT_READ) ? [{ href: '/admin/audit', label: 'Audit log', icon: ScrollText }] : []),
  ];

  return (
    <nav aria-label="Workspace" className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b px-4', collapsed && 'justify-center px-2')}>
        <BrandMark name={me.organization.name} logoUrl={me.organization.logoUrl} size={34} />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] leading-tight font-bold">FG One</p>
            <p className="truncate text-xs text-muted">{me.organization.name}</p>
          </div>
        )}
        {!collapsed && (
          <button onClick={onToggle} className="hidden rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground md:block" aria-label="Collapse sidebar">
            <ChevronsLeft className="size-4" />
          </button>
        )}
      </div>

      <div className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-3">
        <div className="space-y-0.5">
          {main.map((i) => (
            <NavLink key={i.href} item={i} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>

        {admin.length > 0 && (
          <>
            {collapsed ? <div className="mx-2 my-3 h-px bg-border" /> : <SectionTitle>Administration</SectionTitle>}
            <div className="space-y-0.5">
              {admin.map((i) => (
                <NavLink key={i.href} item={{ ...i, match: i.href === '/admin' ? (p) => p === '/admin' : undefined }} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </>
        )}

        {chatOn && !collapsed && (
          <>
            <SectionTitle
              action={
                <span className="flex gap-0.5">
                  <Link href="/chat" onClick={onNavigate} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Browse channels">
                    <Compass className="size-3.5" />
                  </Link>
                  {can(PERMISSIONS.CHANNELS_CREATE) && (
                    <button onClick={() => setNewChannel(true)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Create channel">
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </span>
              }
            >
              Channels
            </SectionTitle>
            <div className="space-y-0.5">
              {channels.isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="mx-2.5 my-2 h-4 animate-pulse rounded bg-surface-2" />)}
              <AnimatePresence initial={false}>
                {groups.map((c) => (
                  <motion.div key={c.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <ChannelRow c={c} onNavigate={onNavigate} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <SectionTitle
              action={
                <button onClick={() => setNewDm(true)} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="New direct message">
                  <Plus className="size-3.5" />
                </button>
              }
            >
              Direct messages
            </SectionTitle>
            <div className="space-y-0.5">
              {dms.map((c) => (
                <ChannelRow key={c.id} c={c} onNavigate={onNavigate} />
              ))}
              {!channels.isLoading && dms.length === 0 && (
                <button onClick={() => setNewDm(true)} className="px-2.5 py-1 text-xs text-muted hover:text-primary">
                  Start a conversation →
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t p-2.5">
        <Popover open={statusOpen} onOpenChange={setStatusOpen}>
          <PopoverTrigger asChild>
            <button className={cn('flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition hover:bg-surface-2', collapsed && 'justify-center')} aria-label="Set your status">
              <UserAvatar person={me.user} size="sm" />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{me.user.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {live.statusEmoji || presenceMeta(live.presence).emoji} {live.statusText || presenceMeta(live.presence).label}
                  </span>
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start">
            <StatusPicker current={live} userId={me.user.id} onDone={() => setStatusOpen(false)} />
          </PopoverContent>
        </Popover>
        {collapsed && (
          <button onClick={onToggle} className="mt-2 hidden w-full justify-center rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground md:flex" aria-label="Expand sidebar">
            <ChevronsRight className="size-4" />
          </button>
        )}
      </div>

      <NewChannelDialog open={newChannel} onOpenChange={setNewChannel} />
      <NewMessageDialog open={newDm} onOpenChange={setNewDm} />
    </nav>
  );
}
