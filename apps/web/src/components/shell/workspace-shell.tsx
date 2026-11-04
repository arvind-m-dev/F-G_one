'use client';
import { useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, presenceMeta, type Permission } from '@fg/shared';
import {
  ArrowLeftRight,
  Bell,
  CalendarDays,
  Check,
  ClipboardCheck,
  TreePalm,
  Clock,
  Megaphone,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
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
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AttendanceAssist } from '@/components/attendance/attendance-assist';
import { BrandMark } from '@/components/brand-mark';
import { CommandPalette } from '@/components/layout/command-palette';
import { clearPersistedCache } from '@/components/providers';
import { NotificationInbox } from '@/components/notifications/inbox';
import { PresenceIcon } from '@/components/presence';
import { StatusPicker } from '@/components/status-picker';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, Popover, PopoverAnchor, PopoverContent } from '@/components/ui/dropdown';
import { Kbd, Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api } from '@/lib/api';
import { useApprovalsCount, useChannels } from '@/lib/hooks';
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
  const approvals = useApprovalsCount();
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
        label: 'Operations',
        items: [
          { href: '/admin/attendance', label: 'Attendance', icon: Clock, perm: PERMISSIONS.ATTENDANCE_VIEW_ALL },
          { href: '/admin/leave', label: 'Leave', icon: TreePalm, perm: PERMISSIONS.EMPLOYEES_MANAGE },
          { href: '/admin/holidays', label: 'Holidays', icon: CalendarDays, perm: PERMISSIONS.HOLIDAYS_MANAGE },
          { href: '/admin/announcements', label: 'Announcements', icon: Megaphone, perm: PERMISSIONS.ANNOUNCEMENTS_MANAGE },
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
        ...(mod('announcements') ? [{ href: '/app/announcements', label: 'Announcements', icon: Megaphone }] : []),
        { href: '/app/people', label: 'Directory', icon: Users },
      ],
    },
    {
      label: 'My time',
      items: [
        ...(mod('attendance') ? [{ href: '/app/attendance', label: 'Attendance', icon: Clock }] : []),
        ...(mod('leave') ? [{ href: '/app/leave', label: 'Leave', icon: TreePalm }] : []),
        ...(mod('holidays') ? [{ href: '/app/holidays', label: 'Holidays', icon: CalendarDays }] : []),
      ],
    },
    ...(approvals.data?.canApprove ? [{ label: 'Manage', items: [{ href: '/app/approvals', label: 'Approvals', icon: ClipboardCheck, badge: approvals.data.total }] }] : []),
  ].filter((g) => g.items.length);
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

const iconBtn = 'relative grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]';

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const savePrefs = useUpdatePreferences();
  const changeTheme = (t: 'light' | 'dark' | 'system') => {
    setTheme(t);
    void savePrefs({ theme: t });
  };
  return (
    <DropdownMenu>
      <Tooltip content="Theme">
        <DropdownTrigger asChild>
          <button className={iconBtn} aria-label="Theme">
            <Sun className="size-[17px] dark:hidden" strokeWidth={1.8} />
            <Moon className="hidden size-[17px] dark:block" strokeWidth={1.8} />
          </button>
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent align="end" className="min-w-40">
        {(
          [
            ['light', Sun, 'Light'],
            ['dark', Moon, 'Dark'],
            ['system', Monitor, 'System'],
          ] as const
        ).map(([v, Icon, label]) => (
          <DropdownItem key={v} onSelect={() => changeTheme(v)}>
            <Icon /> {label}
            {theme === v && <Check className="ml-auto text-primary" aria-label="Selected" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

/** Avatar menu: who you are, your status, profile, preferences, portal switch and sign out. */
function UserMenu({ portal }: { portal: Portal }) {
  const me = useSession();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const live = useLivePerson({ ...me.user, online: true });
  const [statusOpen, setStatusOpen] = useState(false);
  // "Set status" opens the status popover once the menu has finished closing, so focus return doesn't dismiss it.
  const wantsStatus = useRef(false);
  const isAdmin = ADMIN_PERMS.some((p) => can(p));

  const logout = async () => {
    // Even if the server can't be reached, forget everything on this device.
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    clearPersistedCache();
    router.replace('/login');
    toast.success('Signed out');
  };

  return (
    <Popover open={statusOpen} onOpenChange={setStatusOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownTrigger asChild>
            <button className="flex h-9 items-center gap-2 rounded-full p-0.5 transition hover:bg-black/[0.04] lg:pr-2 dark:hover:bg-white/[0.05]" aria-label="Your account">
              <UserAvatar person={me.user} size="sm" />
              <span className="hidden max-w-28 truncate text-[13px] font-medium lg:block">{me.user.firstName}</span>
              <ChevronDown className="hidden size-3.5 text-subtle lg:block" />
            </button>
          </DropdownTrigger>
        </PopoverAnchor>
        <DropdownContent
          align="end"
          className="w-64"
          onCloseAutoFocus={(e) => {
            if (!wantsStatus.current) return;
            e.preventDefault();
            wantsStatus.current = false;
            setStatusOpen(true);
          }}
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <UserAvatar person={me.user} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{me.user.name}</p>
              <p className="truncate text-xs text-muted">{me.user.email}</p>
              <p className="mt-0.5 truncate text-xs text-muted">
                Role: <span className="font-medium text-foreground">{me.user.role.name}</span>
                {me.isSuperAdmin && <span className="text-primary"> · Super Admin</span>}
              </p>
            </div>
          </div>
          <DropdownItem onSelect={() => (wantsStatus.current = true)}>
            <PresenceIcon presence={live.presence} />
            <span className="truncate">{live.statusText || presenceMeta(live.presence).label}</span>
            <span className="ml-auto text-xs text-subtle">Change</span>
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem onSelect={() => router.push('/app/profile')}>
            <UserRound /> My profile
          </DropdownItem>
          <DropdownItem onSelect={() => router.push('/app/settings')}>
            <Settings /> Preferences
          </DropdownItem>
          {portal === 'admin' ? (
            <DropdownItem onSelect={() => router.push('/app/home')}>
              <ArrowLeftRight /> Back to workspace
            </DropdownItem>
          ) : (
            isAdmin && (
              <DropdownItem onSelect={() => router.push('/admin')}>
                <ShieldCheck /> Admin portal
              </DropdownItem>
            )
          )}
          <DropdownSeparator />
          <DropdownItem danger onSelect={logout}>
            <LogOut /> Sign out
          </DropdownItem>
        </DropdownContent>
      </DropdownMenu>
      <PopoverContent align="end">
        <StatusPicker current={live} userId={me.user.id} onDone={() => setStatusOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function NotificationsButton({ side }: { side?: 'right' | 'bottom' }) {
  return (
    <NotificationInbox
      side={side}
      trigger={(unread) => (
        <button className={iconBtn} aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
          <Bell className="size-[17px]" strokeWidth={1.8} />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white tabular-nums">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    />
  );
}

/** Desktop top bar: search, portal switch, notifications, theme and the account menu. */
function TopBar({ portal, onSearch }: { portal: Portal; onSearch: () => void }) {
  const can = useCan();
  const isAdmin = ADMIN_PERMS.some((p) => can(p));
  const switchLink = portal === 'admin' ? { href: '/app/home', label: 'Back to workspace', icon: ArrowLeftRight } : isAdmin ? { href: '/admin', label: 'Admin portal', icon: ShieldCheck } : null;
  return (
    <header className="hidden h-12 shrink-0 items-center gap-3 pl-1 md:flex">
      <button
        onClick={onSearch}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-black/[0.06] bg-canvas/70 px-2.5 text-[13px] text-subtle shadow-sm transition hover:text-muted dark:border-white/[0.06] dark:bg-white/[0.03]"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" />
        <span>Search people, channels and pages</span>
        <span className="ml-auto flex gap-0.5">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-1">
        {switchLink && (
          <Link href={switchLink.href} className="mr-1 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]">
            <switchLink.icon className="size-4" strokeWidth={1.8} />
            <span className="hidden lg:inline">{switchLink.label}</span>
          </Link>
        )}
        <Tooltip content="Notifications">
          <span>
            <NotificationsButton side="bottom" />
          </span>
        </Tooltip>
        <ThemeMenu />
        <div className="mx-1.5 h-5 w-px bg-border-strong" />
        <UserMenu portal={portal} />
      </div>
    </header>
  );
}

function Rail({ portal, collapsed, onToggle, onNavigate }: { portal: Portal; collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const me = useSession();
  const groups = useNav(portal);
  const { connected } = useRealtime();

  return (
    <nav aria-label={portal === 'admin' ? 'Admin portal' : 'Workspace'} className="flex h-full flex-col px-2.5 py-3">
      <Link href={portal === 'admin' ? '/admin' : '/app/home'} onClick={onNavigate} className={cn('flex h-10 items-center gap-2.5 rounded-lg px-1.5', collapsed && 'justify-center px-0')} aria-label={`${me.organization.name} home`}>
        <BrandMark name={me.organization.name} logoUrl={me.organization.logoUrl} size={28} />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-semibold">{me.organization.name}</span>
            <span className="block truncate text-[11px] text-muted">{portal === 'admin' ? 'Admin portal' : 'FG One'}</span>
          </span>
        )}
      </Link>

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
        <NavLink item={{ href: '/app/settings', label: 'Settings', icon: Settings }} collapsed={collapsed} onNavigate={onNavigate} />
        <div className={cn('flex items-center justify-between px-1 pt-2', collapsed && 'flex-col gap-2')}>
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
  const all = groups.flatMap((g) => g.items);
  const pick = ['/app/home', '/app/chat', '/app/attendance', '/app/leave'];
  const items = [...pick.map((h) => all.find((i) => i.href === h)).filter(Boolean) as NavItem[], { href: '/app/profile', label: 'Me', icon: UserRound }];
  if (portal === 'admin') return null;
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
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
  // On tablets (768–1099px) the rail is icon-only so content keeps enough room.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (max-width: 1099px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  useEffect(() => setDrawer(false), [pathname]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    void savePrefs({ sidebarCollapsed: next });
  };
  const fullBleed = pathname.startsWith('/app/chat');

  return (
    <div className="flex h-dvh overflow-hidden bg-chrome">
      <motion.aside animate={{ width: collapsed || narrow ? 64 : 232 }} transition={{ type: 'spring', stiffness: 420, damping: 40 }} className="relative hidden shrink-0 md:block">
        <Rail portal={portal} collapsed={collapsed || narrow} onToggle={narrow ? undefined : toggle} />
      </motion.aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-[#0b0d11]/45 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 bg-chrome shadow-lg md:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 400, damping: 38 }}>
              <Rail portal={portal} collapsed={false} onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col md:pr-2 md:pb-2">
        <TopBar portal={portal} onSearch={() => setSearch(true)} />
        <div className="flex h-12 shrink-0 items-center gap-1 border-b bg-canvas px-3 md:hidden">
          <button onClick={() => setDrawer(true)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <BrandMark name={me.organization.name} logoUrl={me.organization.logoUrl} size={24} />
          <span className="truncate text-sm font-semibold">{portal === 'admin' ? 'Admin' : me.organization.name}</span>
          <span className="ml-auto" />
          <button onClick={() => setSearch(true)} className={iconBtn} aria-label="Search">
            <Search className="size-[17px]" strokeWidth={1.8} />
          </button>
          <NotificationsButton side="bottom" />
          <UserMenu portal={portal} />
        </div>
        {portal === 'app' && <AttendanceAssist />}
        <main id="main" className={cn('relative min-h-0 flex-1 bg-canvas md:rounded-xl md:shadow-canvas', fullBleed ? 'overflow-hidden' : 'scrollbar-thin overflow-y-auto pb-16 md:pb-0')}>
          {/*
            Enter animation only. An exit animation (AnimatePresence mode="wait") rendered the new route inside the
            outgoing wrapper first and then mounted it again, so clicks in the first moments were lost.
          */}
          <motion.div key={fullBleed ? '/app/chat' : pathname} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="h-full">
            {children}
          </motion.div>
        </main>
      </div>
      {!/^\/app\/chat\/.+/.test(pathname) && <MobileTabs portal={portal} />}
      <CommandPalette open={search} onOpenChange={setSearch} />
    </div>
  );
}
