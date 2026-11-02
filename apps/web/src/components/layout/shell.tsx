'use client';
import { useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, presenceMeta } from '@fg/shared';
import { Hash, LogOut, Menu, Monitor, Moon, Plus, Search, Smile, Sun, UserCircle2, UserPlus, MessageSquarePlus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from 'next-themes';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { NewChannelDialog, NewMessageDialog } from '@/components/chat/new-conversation';
import { StatusPicker } from '@/components/status-picker';
import { Button } from '@/components/ui/button';
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Kbd } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api } from '@/lib/api';
import { useLivePerson } from '@/lib/presence-store';
import { useRealtime } from '@/lib/realtime';
import { useCan, useModule, useSession, useUpdatePreferences } from '@/lib/session';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useSession();
  const can = useCan();
  const mod = useModule();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const savePrefs = useUpdatePreferences();
  const { theme, setTheme } = useTheme();
  const { connected } = useRealtime();
  const [collapsed, setCollapsed] = useState(me.preferences.sidebarCollapsed ?? me.organization.settings.navigation.sidebarCollapsedByDefault);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [newDm, setNewDm] = useState(false);
  const [newChannel, setNewChannel] = useState(false);
  const live = useLivePerson({ ...me.user, online: true });
  const meta = presenceMeta(live.presence);

  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    void savePrefs({ sidebarCollapsed: next });
  };
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
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 264 }}
        transition={{ type: 'spring', stiffness: 400, damping: 38 }}
        className="relative z-20 hidden shrink-0 border-r md:block"
      >
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 border-r shadow-2xl md:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
              <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-surface/80 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>

          <button
            onClick={() => setSearchOpen(true)}
            className="group flex h-10 min-w-0 max-w-md flex-1 items-center gap-2 rounded-xl border bg-surface-2/60 px-3 text-sm text-muted transition hover:border-primary/40 hover:bg-surface"
            aria-label="Search (Ctrl+K)"
          >
            <Search className="size-4" />
            <span className="truncate">Search people, channels, messages…</span>
            <span className="ml-auto hidden items-center gap-1 sm:flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
            <span className={cn('hidden size-2 rounded-full lg:block', connected ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse')} title={connected ? 'Live updates connected' : 'Reconnecting…'} />

            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button variant="gradient" size="sm" className="h-9 rounded-xl" aria-label="Quick actions">
                  <Plus /> <span className="hidden sm:inline">New</span>
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownLabel>Quick actions</DropdownLabel>
                {mod('chat') && (
                  <DropdownItem onSelect={() => setNewDm(true)}>
                    <MessageSquarePlus /> New message
                  </DropdownItem>
                )}
                {mod('chat') && can(PERMISSIONS.CHANNELS_CREATE) && (
                  <DropdownItem onSelect={() => setNewChannel(true)}>
                    <Hash /> New channel
                  </DropdownItem>
                )}
                {can(PERMISSIONS.EMPLOYEES_MANAGE) && (
                  <DropdownItem onSelect={() => router.push('/admin/employees?invite=1')}>
                    <UserPlus /> Invite employee
                  </DropdownItem>
                )}
                <DropdownItem onSelect={() => setTimeout(() => setStatusOpen(true), 50)}>
                  <Smile /> Update status
                </DropdownItem>
              </DropdownContent>
            </DropdownMenu>

            <Popover open={statusOpen} onOpenChange={setStatusOpen}>
              <PopoverTrigger asChild>
                <button className="hidden h-9 items-center gap-1.5 rounded-xl border px-2.5 text-sm transition hover:bg-surface-2 lg:flex" aria-label="Your status">
                  <span>{live.statusEmoji || meta.emoji}</span>
                  <span className="max-w-36 truncate text-muted">{live.statusText || meta.label}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent>
                <StatusPicker current={live} userId={me.user.id} onDone={() => setStatusOpen(false)} />
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Theme" className="hidden sm:inline-flex">
                  <Sun className="dark:hidden" />
                  <Moon className="hidden dark:block" />
                </Button>
              </DropdownTrigger>
              <DropdownContent className="min-w-40">
                <DropdownItem onSelect={() => changeTheme('light')}>
                  <Sun /> Light {theme === 'light' && '✓'}
                </DropdownItem>
                <DropdownItem onSelect={() => changeTheme('dark')}>
                  <Moon /> Dark {theme === 'dark' && '✓'}
                </DropdownItem>
                <DropdownItem onSelect={() => changeTheme('system')}>
                  <Monitor /> System {theme === 'system' && '✓'}
                </DropdownItem>
              </DropdownContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownTrigger asChild>
                <button className="rounded-full p-0.5 transition hover:ring-4 hover:ring-primary-soft" aria-label="Account menu">
                  <UserAvatar person={me.user} size="sm" />
                </button>
              </DropdownTrigger>
              <DropdownContent className="w-64">
                <div className="flex items-center gap-3 px-2.5 py-2">
                  <UserAvatar person={me.user} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{me.user.name}</p>
                    <p className="truncate text-xs text-muted">{me.user.email}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-primary">{me.user.role.name}</p>
                  </div>
                </div>
                <DropdownSeparator />
                <DropdownItem onSelect={() => router.push('/profile')}>
                  <UserCircle2 /> Profile & preferences
                </DropdownItem>
                <DropdownItem onSelect={() => setTimeout(() => setStatusOpen(true), 50)}>
                  <Smile /> Set status
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem danger onSelect={logout}>
                  <LogOut /> Sign out
                </DropdownItem>
              </DropdownContent>
            </DropdownMenu>
          </div>
        </header>

        <main id="main" className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname.startsWith('/chat') ? '/chat' : pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <NewMessageDialog open={newDm} onOpenChange={setNewDm} />
      <NewChannelDialog open={newChannel} onOpenChange={setNewChannel} />
    </div>
  );
}
