'use client';
import { useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, presenceMeta, type Permission } from '@fg/shared';
import {
  ArrowLeftRight,
  Building2,
  ChartNoAxesCombined,
  ChevronsUpDown,
  House,
  KeyRound,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BrandMark } from '@/components/brand-mark';
import { CommandPalette } from '@/components/layout/command-palette';
import { PresenceIcon } from '@/components/presence';
import { StatusPicker } from '@/components/status-picker';
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Kbd, Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api } from '@/lib/api';
import { useChannels } from '@/lib/hooks';
import { useLivePerson } from '@/lib/presence-store';
import { useRealtime } from '@/lib/realtime';
import { useCan, useModule, useSession, useUpdatePreferences } from '@/lib/session';
import { cn } from '@/lib/utils';

export type Portal = 'app' | 'admin';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  exact?: boolean;
  perm?: Permission;
}
interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const ADMIN_PERMS: Permission[] = [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.EMPLOYEES_MANAGE, PERMISSIONS.DEPARTMENTS_MANAGE, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_READ];

function useNav(portal: Portal): NavGroup[] {
  const can = useCan();
  const mod = useModule();
  const channels = useChannels(portal === 'app' && mod('chat'));
  const unread = (channels.data ?? []).reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
  if (portal === 'admin') {
    const g: NavGroup[] = [
      { items: [{ href: '/admin', label: 'Overview', icon: ChartNoAxesCombined, exact: true, perm: PERMISSIONS.ANALYTICS_VIEW }] },
      {
        label: 'People',
        items: [
          { href: '/admin/employees', label: 'Employees', icon: Users, perm: PERMISSIONS.EMPLOYEES_MANAGE },
          { href: '/admin/departments', label: 'Departments', icon: Building2, perm: PERMISSIONS.DEPARTMENTS_MANAGE },
          { href: '/admin/roles', label: 'Roles & permissions', icon: KeyRound, perm: PERMISSIONS.EMPLOYEES_MANAGE },
        ],
      },
      {
        label: 'Workspace',
        items: [
          { href: '/admin/settings', label: 'System settings', icon: SlidersHorizontal, perm: PERMISSIONS.SETTINGS_MANAGE },
          { href: '/admin/audit', label: 'Audit logs', icon: ScrollText, perm: PERMISSIONS.AUDIT_READ },
        ],
      },
    ];
    return g.map((x) => ({ ...x, items: x.items.filter((i) => !i.perm || can(i.perm)) })).filter((x) => x.items.length);
  }
  return [
    {
      items: [
        { href: '/app/home', label: 'Home', icon: House },
        ...(mod('chat') ? [{ href: '/app/chat', label: 'Chat', icon: MessageSquare, badge: unread }] : []),
        { href: '/app/people', label: 'Directory', icon: Users },
      ],
    },
  ];
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium text-muted transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]',
        active && 'bg-canvas text-foreground shadow-sm hover:bg-canvas dark:bg-white/[0.07] dark:hover:bg-white/[0.07]',
        collapsed && 'w-10 justify-center px-0',
      )}
    >
      <item.icon className={cn('size-[17px] shrink-0', active && 'text-primary')} strokeWidth={active ? 2.1 : 1.8} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!!item.badge && (
        <span className={cn('grid place-items-center rounded-full bg-primary text-[10px] font-semibold text-white tabular-nums', collapsed ? 'absolute top-0.5 right-0.5 size-4' : 'ml-auto h-[18px] min-w-[18px] px-1')}>
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </Link>
  );
  return collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link;
}

function Rail({ portal, collapsed, onToggle, onNavigate, onSearch }: { portal: Portal; collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; onSearch: () => void }) {
  const me = useSession();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const groups = useNav(portal);
  const { connected } = useRealtime();
  const { theme, setTheme } = useTheme();
  const savePrefs = useUpdatePreferences();
  const [statusOpen, setStatusOpen] = useState(false);
  const live = useLivePerson({ ...me.user, online: true });
  const isAdmin = ADMIN_PERMS.some((p) => can(p));

  const changeTheme = (t: 'light' | 'dark' | 'system') => {
    setTheme(t);
    void savePrefs({ theme: t });
  };
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      qc.clear();
      router.replace('/login');
      toast.success('Signed out');
    }
  };

  return (
    <nav aria-label={portal === 'admin' ? 'Admin portal' : 'Workspace'} className="flex h-full flex-col px-2.5 py-3">
      {/* Workspace switcher */}
      <DropdownMenu>
        <DropdownTrigger asChild>
          <button className={cn('flex h-10 items-center gap-2.5 rounded-lg px-1.5 text-left transition hover:bg-black/[0.04] dark:hover:bg-white/[0.05]', collapsed && 'justify-center px-0')} aria-label="Workspace menu">
            <BrandMark name={me.organization.name} logoUrl={me.organization.logoUrl} size={28} />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-tight font-semibold">{me.organization.name}</span>
                  <span className="block truncate text-[11px] text-muted">{portal === 'admin' ? 'Admin portal' : 'FG One'}</span>
                </span>
                <ChevronsUpDown className="size-3.5 text-subtle" />
              </>
            )}
          </button>
        </DropdownTrigger>
        <DropdownContent align="start" className="w-60">
          <DropdownLabel>{me.organization.name}</DropdownLabel>
          {portal === 'admin' ? (
            <DropdownItem onSelect={() => router.push('/app/home')}>
              <ArrowLeftRight /> Switch to workspace
            </DropdownItem>
          ) : (
            isAdmin && (
              <DropdownItem onSelect={() => router.push('/admin')}>
                <ShieldCheck /> Open admin portal
              </DropdownItem>
            )
          )}
          <DropdownItem onSelect={() => router.push('/app/settings')}>
            <Settings /> Preferences
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem danger onSelect={logout}>
            <LogOut /> Sign out
          </DropdownItem>
        </DropdownContent>
      </DropdownMenu>

      {/* Search */}
      <button
        onClick={onSearch}
        className={cn('mt-3 flex h-8 items-center gap-2 rounded-lg border border-black/[0.06] bg-canvas/70 px-2 text-[13px] text-subtle shadow-sm transition hover:text-muted dark:border-white/[0.06] dark:bg-white/[0.03]', collapsed && 'w-10 justify-center px-0')}
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" />
        {!collapsed && (
          <>
            <span>Search</span>
            <span className="ml-auto flex gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </>
        )}
      </button>

      <div className="scrollbar-thin mt-4 flex-1 space-y-5 overflow-x-hidden overflow-y-auto">
        {groups.map((g, i) => (
          <div key={i}>
            {g.label && !collapsed && <p className="mb-1 px-2 text-[11px] font-medium text-subtle">{g.label}</p>}
            {g.label && collapsed && <div className="mx-auto mb-2 h-px w-6 bg-border-strong" />}
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink key={it.href} item={it} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-0.5 pt-3">
        {portal === 'app' && isAdmin && <NavLink item={{ href: '/admin', label: 'Admin portal', icon: ShieldCheck }} collapsed={collapsed} onNavigate={onNavigate} />}
        {portal === 'admin' && <NavLink item={{ href: '/app/home', label: 'Back to workspace', icon: ArrowLeftRight }} collapsed={collapsed} onNavigate={onNavigate} />}
        <NavLink item={{ href: '/app/settings', label: 'Settings', icon: Settings }} collapsed={collapsed} onNavigate={onNavigate} />

        <div className={cn('flex items-center gap-1 pt-2', collapsed && 'flex-col')}>
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <button className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left transition hover:bg-black/[0.04] dark:hover:bg-white/[0.05]', collapsed && 'flex-none')} aria-label="Set your status">
                <UserAvatar person={me.user} size="sm" />
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{me.user.firstName}</span>
                    <span className="flex items-center gap-1 truncate text-[11px] text-muted">
                      <PresenceIcon presence={live.presence} className="size-3" />
                      <span className="truncate">{live.statusText || presenceMeta(live.presence).label}</span>
                    </span>
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start">
              <StatusPicker current={live} userId={me.user.id} onDone={() => setStatusOpen(false)} />
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownTrigger asChild>
              <button className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]" aria-label="Theme">
                <Sun className="size-4 dark:hidden" />
                <Moon className="hidden size-4 dark:block" />
              </button>
            </DropdownTrigger>
            <DropdownContent align="start" side="top" className="min-w-40">
              {(
                [
                  ['light', Sun, 'Light'],
                  ['dark', Moon, 'Dark'],
                  ['system', Monitor, 'System'],
                ] as const
              ).map(([v, Icon, label]) => (
                <DropdownItem key={v} onSelect={() => changeTheme(v)}>
                  <Icon /> {label}
                  {theme === v && <span className="ml-auto text-primary">●</span>}
                </DropdownItem>
              ))}
            </DropdownContent>
          </DropdownMenu>
        </div>
        <div className={cn('flex items-center justify-between px-1 pt-1', collapsed && 'flex-col gap-2')}>
          <span className="flex items-center gap-1.5 text-[11px] text-subtle" title={connected ? 'Live updates connected' : 'Reconnecting…'}>
            <span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'animate-pulse bg-amber-400')} />
            {!collapsed && (connected ? 'Live' : 'Reconnecting')}
          </span>
          {onToggle && (
            <button onClick={onToggle} className="hidden rounded-md p-1 text-subtle transition hover:text-foreground md:block" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

/** Mobile: compact top bar + bottom tab bar (employee) or drawer (admin). */
function MobileTabs({ portal }: { portal: Portal }) {
  const pathname = usePathname();
  const groups = useNav(portal);
  const items = [...groups.flatMap((g) => g.items).slice(0, 3), { href: '/app/profile', label: 'Me', icon: UserRound }];
  if (portal === 'admin') return null;
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.map((it) => {
        const active = pathname.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} className={cn('relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-primary' : 'text-muted')}>
            <it.icon className="size-5" strokeWidth={active ? 2.1 : 1.8} />
            {it.label}
            {!!it.badge && <span className="absolute top-1 left-1/2 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">{it.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkspaceShell({ portal, children }: { portal: Portal; children: React.ReactNode }) {
  const me = useSession();
  const pathname = usePathname();
  const savePrefs = useUpdatePreferences();
  const [collapsed, setCollapsed] = useState(me.preferences.sidebarCollapsed ?? me.organization.settings.navigation.sidebarCollapsedByDefault);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    void savePrefs({ sidebarCollapsed: next });
  };
  const fullBleed = pathname.startsWith('/app/chat');

  return (
    <div className="flex h-dvh overflow-hidden bg-chrome">
      <motion.aside animate={{ width: collapsed ? 64 : 232 }} transition={{ type: 'spring', stiffness: 420, damping: 40 }} className="relative hidden shrink-0 md:block">
        <Rail portal={portal} collapsed={collapsed} onToggle={toggle} onSearch={() => setSearch(true)} />
      </motion.aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-[#0b0d11]/45 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 bg-chrome shadow-lg md:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 400, damping: 38 }}>
              <Rail portal={portal} collapsed={false} onNavigate={() => setDrawer(false)} onSearch={() => { setDrawer(false); setSearch(true); }} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-canvas px-3 md:hidden">
          <button onClick={() => setDrawer(true)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <BrandMark name={me.organization.name} logoUrl={me.organization.logoUrl} size={24} />
          <span className="truncate text-sm font-semibold">{portal === 'admin' ? 'Admin' : me.organization.name}</span>
          <button onClick={() => setSearch(true)} className="ml-auto grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Search">
            <Search className="size-5" />
          </button>
        </div>
        <main id="main" className={cn('relative min-h-0 flex-1 bg-canvas md:rounded-xl md:shadow-canvas', fullBleed ? 'overflow-hidden' : 'scrollbar-thin overflow-y-auto pb-16 md:pb-0')}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={fullBleed ? '/app/chat' : pathname} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="h-full">
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {!/^\/app\/chat\/.+/.test(pathname) && <MobileTabs portal={portal} />}
      <CommandPalette open={search} onOpenChange={setSearch} />
    </div>
  );
}
