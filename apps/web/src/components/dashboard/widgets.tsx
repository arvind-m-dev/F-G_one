'use client';
import { PERMISSIONS, presenceMeta, type WidgetKey } from '@fg/shared';
import {
  Building2,
  Cake,
  CalendarDays,
  Clock3,
  Gift,
  Hash,
  Lock,
  Megaphone,
  MessageSquarePlus,
  MessagesSquare,
  Pin,
  Search,
  Smile,
  Sparkles,
  UserCog,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, EmptyState } from '@/components/ui/misc';
import { StatusLine, UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { channelLabel } from '@/lib/hooks';
import { useLivePerson } from '@/lib/presence-store';
import { useCan, useSession } from '@/lib/session';
import type { ChannelSummary, Person } from '@/lib/types';
import { cn, greeting, parseDateOnly, timeAgo } from '@/lib/utils';

export interface DashboardData {
  workday: { start: string; end: string; workingDays: number[] };
  team: Person[];
  announcements: {
    id: string;
    title: string;
    body: string;
    priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
    pinned: boolean;
    publishedAt: string;
    author: { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null } | null;
    department: { name: string } | null;
  }[];
  holidays: { id: string; name: string; date: string; type: 'MANDATORY' | 'OPTIONAL' }[];
  celebrations: { type: 'birthday' | 'anniversary'; inDays: number; years?: number; person: Person }[];
  recentChats: ChannelSummary[];
  unreadTotal: number;
  orgStats: { headcount: number; departments: number; joinersThisMonth: number; onlineNow: number };
}

export interface WidgetProps {
  data: DashboardData;
  actions: { newMessage: () => void; setStatus: () => void };
}

function useOpenDm() {
  const router = useRouter();
  return async (userId: string, draft?: string) => {
    try {
      const c = await api<{ id: string }>('/dm', { body: { userIds: [userId] } });
      router.push(`/chat/${c.id}${draft ? `?draft=${encodeURIComponent(draft)}` : ''}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

/* ───────────── Welcome ───────────── */
function WelcomeWidget({ data, actions }: WidgetProps) {
  const me = useSession();
  const live = useLivePerson({ ...me.user, online: true });
  const meta = presenceMeta(live.presence);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  return (
    <Card className="relative h-full overflow-hidden border-0 text-white">
      <div className="bg-brand-gradient absolute inset-0" />
      <div className="absolute -top-24 -right-16 size-72 rounded-full bg-white/15 blur-2xl" />
      <div className="absolute -bottom-28 left-1/3 size-72 rounded-full bg-black/10 blur-3xl" />
      <div className="relative flex h-full flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <div className="self-start rounded-full bg-white/20 p-1 backdrop-blur sm:self-center">
          <UserAvatar person={me.user} size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/80">{now ? now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : ' '}</p>
          <h1 className="mt-0.5 font-display text-2xl font-bold sm:text-3xl">
            {now ? greeting(now) : 'Hello'}, {me.user.firstName} <span className="inline-block origin-[70%_70%] animate-[wave_2s_ease-in-out_1]">👋</span>
          </h1>
          <p className="mt-1 text-sm text-white/85">
            {[me.user.designation, me.user.department?.name].filter(Boolean).join(' · ') || me.user.role.name}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={actions.setStatus} className="inline-flex items-center gap-1.5 rounded-full bg-white/18 px-3 py-1.5 text-sm font-medium backdrop-blur transition hover:bg-white/28">
              {live.statusEmoji || meta.emoji} {live.statusText || meta.label}
            </button>
            {data.unreadTotal > 0 && (
              <Link href="/chat" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-white/90">
                <MessagesSquare className="size-4" /> {data.unreadTotal} unread
              </Link>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ───────────── Clock / working hours ───────────── */
function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}
function ClockWidget({ data }: WidgetProps) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const start = minutesOf(data.workday.start);
  const end = minutesOf(data.workday.end);
  const cur = now ? now.getHours() * 60 + now.getMinutes() : 0;
  const isWorkday = now ? data.workday.workingDays.includes(now.getDay()) : true;
  const pct = Math.min(100, Math.max(0, ((cur - start) / (end - start)) * 100));
  const phase = !isWorkday ? 'Weekend — enjoy!' : cur < start ? 'Workday starts soon' : cur > end ? 'Workday complete' : 'Workday in progress';
  const remaining = Math.max(0, end - cur);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Today" icon={<Clock3 />} subtitle={phase} />
      <div className="flex flex-1 flex-col justify-between px-5 pb-5">
        <p className="font-display text-4xl font-bold tabular-nums" suppressHydrationWarning>
          {now ? now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}
        </p>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>{data.workday.start}</span>
            <span>{isWorkday && cur >= start && cur <= end ? `${Math.floor(remaining / 60)}h ${remaining % 60}m left` : 'Working hours'}</span>
            <span>{data.workday.end}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Workday progress">
            <motion.div className="bg-brand-gradient h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${isWorkday ? pct : 0}%` }} transition={{ duration: 1, ease: 'easeOut' }} />
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ───────────── Team availability ───────────── */
function TeamMember({ p }: { p: Person }) {
  const openDm = useOpenDm();
  const live = useLivePerson(p);
  return (
    <motion.button
      layout
      whileHover={{ y: -2 }}
      onClick={() => openDm(p.id)}
      className="flex items-center gap-2.5 rounded-xl border bg-surface p-2.5 text-left transition hover:border-primary/40 hover:shadow-md"
      title={`Message ${p.name}`}
    >
      <UserAvatar person={p} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{p.name}</span>
        <StatusLine person={live} className="w-full" />
      </span>
    </motion.button>
  );
}
function TeamWidget({ data }: WidgetProps) {
  const [filter, setFilter] = useState<'all' | 'online'>('all');
  const people = data.team;
  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Team availability"
        icon={<Users />}
        subtitle={`${people.length} people in your team`}
        action={
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-medium">
            {(['all', 'online'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn('rounded-md px-2.5 py-1 capitalize transition', filter === f ? 'bg-surface shadow-sm' : 'text-muted')}>
                {f}
              </button>
            ))}
          </div>
        }
      />
      <div className="px-5 pb-5">
        {people.length === 0 ? (
          <EmptyState icon={<Users />} title="No teammates yet" description="Your manager or HR can assign you to a department." />
        ) : (
          <TeamGrid people={people} onlineOnly={filter === 'online'} />
        )}
      </div>
    </Card>
  );
}
function TeamGrid({ people, onlineOnly }: { people: Person[]; onlineOnly: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {people.map((p) => (
        <TeamFilter key={p.id} p={p} onlineOnly={onlineOnly} />
      ))}
    </div>
  );
}
function TeamFilter({ p, onlineOnly }: { p: Person; onlineOnly: boolean }) {
  const live = useLivePerson(p);
  if (onlineOnly && !live.online) return null;
  return <TeamMember p={p} />;
}

/* ───────────── Announcements ───────────── */
const priorityTone = { NORMAL: 'muted', IMPORTANT: 'warning', CRITICAL: 'danger' } as const;
function AnnouncementsWidget({ data }: WidgetProps) {
  const [open, setOpen] = useState<DashboardData['announcements'][number] | null>(null);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Announcements" icon={<Megaphone />} subtitle="Company & department news" />
      <div className="flex-1 space-y-1 px-3 pb-4">
        {data.announcements.length === 0 && <EmptyState icon={<Megaphone />} title="You're all caught up" description="New announcements will appear here." />}
        {data.announcements.map((a, i) => (
          <motion.button
            key={a.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => setOpen(a)}
            className="flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition hover:bg-surface-2"
          >
            <span className={cn('mt-1 size-2 shrink-0 rounded-full', a.priority === 'CRITICAL' ? 'bg-danger' : a.priority === 'IMPORTANT' ? 'bg-warning' : 'bg-primary')} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{a.title}</span>
                {a.pinned && <Pin className="size-3 shrink-0 text-primary" />}
              </span>
              <span className="line-clamp-1 text-sm text-muted">{a.body}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {a.priority !== 'NORMAL' && <Badge tone={priorityTone[a.priority]}>{a.priority.toLowerCase()}</Badge>}
                {a.department && <Badge tone="brand">{a.department.name}</Badge>}
                {a.author && `${a.author.firstName} ${a.author.lastName} · `}
                {timeAgo(a.publishedAt)}
              </span>
            </span>
          </motion.button>
        ))}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.title ?? ''} description={open ? `${open.author ? `${open.author.firstName} ${open.author.lastName} · ` : ''}${new Date(open.publishedAt).toLocaleString()}` : undefined}>
        {open && (
          <div className="space-y-3">
            <div className="flex gap-1.5">
              <Badge tone={priorityTone[open.priority]}>{open.priority.toLowerCase()}</Badge>
              <Badge tone="brand">{open.department?.name ?? 'Company-wide'}</Badge>
            </div>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{open.body}</p>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

/* ───────────── Holidays ───────────── */
function HolidaysWidget({ data }: WidgetProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Upcoming holidays" icon={<CalendarDays />} />
      <ul className="space-y-1 px-3 pb-4">
        {data.holidays.length === 0 && <EmptyState icon={<CalendarDays />} title="No upcoming holidays" />}
        {data.holidays.map((h) => {
          const d = parseDateOnly(h.date);
          const days = Math.round((d.getTime() - today.getTime()) / 86400_000);
          return (
            <li key={h.id} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-2">
              <span className="grid w-12 shrink-0 overflow-hidden rounded-lg border text-center">
                <span className="bg-primary-soft py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
                <span className="py-0.5 font-display text-lg font-bold">{d.getDate()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{h.name}</span>
                <span className="text-xs text-muted">
                  {d.toLocaleDateString(undefined, { weekday: 'long' })} · {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`}
                </span>
              </span>
              <Badge tone={h.type === 'MANDATORY' ? 'success' : 'muted'}>{h.type === 'MANDATORY' ? 'Holiday' : 'Optional'}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ───────────── Celebrations ───────────── */
function CelebrationsWidget({ data }: WidgetProps) {
  const openDm = useOpenDm();
  const me = useSession();
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Celebrations" icon={<Gift />} subtitle="Birthdays & work anniversaries" />
      <ul className="space-y-1 px-3 pb-4">
        {data.celebrations.length === 0 && <EmptyState icon={<Cake />} title="Nothing in the next two weeks" />}
        {data.celebrations.map((c) => (
          <li key={`${c.type}-${c.person.id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-2">
            <UserAvatar person={c.person} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {c.person.id === me.user.id ? 'You' : c.person.name} {c.type === 'birthday' ? '🎂' : '🏆'}
              </span>
              <span className="text-xs text-muted">
                {c.type === 'birthday' ? 'Birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at ${me.organization.name}`} · {c.inDays === 0 ? 'today' : c.inDays === 1 ? 'tomorrow' : `in ${c.inDays} days`}
              </span>
            </span>
            {c.person.id !== me.user.id && (
              <button
                onClick={() => openDm(c.person.id, c.type === 'birthday' ? `Happy birthday, ${c.person.firstName}! 🎉` : `Happy work anniversary, ${c.person.firstName}! 🏆`)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary-soft"
              >
                Send wishes
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────────── Recent chats ───────────── */
function RecentChatsWidget({ data, actions }: WidgetProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Recent conversations"
        icon={<MessagesSquare />}
        action={
          <button onClick={actions.newMessage} className="rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-primary" aria-label="New message">
            <MessageSquarePlus className="size-4" />
          </button>
        }
      />
      <ul className="space-y-0.5 px-3 pb-4">
        {data.recentChats.length === 0 && <EmptyState icon={<MessagesSquare />} title="No conversations yet" />}
        {data.recentChats.map((c) => (
          <li key={c.id}>
            <Link href={`/chat/${c.id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-surface-2">
              {c.type === 'DIRECT' && c.participants[0] ? (
                <UserAvatar person={c.participants[0]} size="sm" />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary">{c.type === 'PRIVATE' ? <Lock className="size-3.5" /> : <Hash className="size-3.5" />}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{channelLabel(c)}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{c.lastMessage ? timeAgo(c.lastMessage.createdAt) : ''}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={cn('truncate text-xs', c.unread ? 'text-foreground' : 'text-muted')}>
                    {c.lastMessage ? `${c.lastMessage.authorName ? `${c.lastMessage.authorName}: ` : ''}${c.lastMessage.body}` : 'No messages yet'}
                  </span>
                  {c.unread > 0 && <span className="ml-auto grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">{c.unread}</span>}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────────── Quick actions ───────────── */
function QuickActionsWidget({ actions }: WidgetProps) {
  const can = useCan();
  const router = useRouter();
  const items = [
    { label: 'New message', icon: MessageSquarePlus, onClick: actions.newMessage, color: '#6366f1' },
    { label: 'Set status', icon: Smile, onClick: actions.setStatus, color: '#f59e0b' },
    { label: 'Find people', icon: Search, onClick: () => router.push('/people'), color: '#0ea5e9' },
    { label: 'Edit profile', icon: UserCog, onClick: () => router.push('/profile'), color: '#14b8a6' },
    ...(can(PERMISSIONS.EMPLOYEES_MANAGE) ? [{ label: 'Invite employee', icon: UserPlus, onClick: () => router.push('/admin/employees?invite=1'), color: '#ec4899' }] : []),
    ...(can(PERMISSIONS.SETTINGS_MANAGE) ? [{ label: 'Branding', icon: Sparkles, onClick: () => router.push('/admin/settings'), color: '#8b5cf6' }] : []),
  ];
  return (
    <Card className="h-full">
      <CardHeader title="Quick actions" icon={<Zap />} />
      <div className="grid grid-cols-2 gap-2 px-5 pb-5">
        {items.map((it) => (
          <motion.button
            key={it.label}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={it.onClick}
            className="flex flex-col items-start gap-2 rounded-xl border p-3 text-left text-sm font-medium transition hover:shadow-md"
          >
            <span className="grid size-8 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${it.color} 14%, transparent)`, color: it.color }}>
              <it.icon className="size-4" />
            </span>
            {it.label}
          </motion.button>
        ))}
      </div>
    </Card>
  );
}

/* ───────────── Org stats ───────────── */
function Counter({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: 'easeOut' });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span>{rounded}</motion.span>;
}
function OrgStatsWidget({ data }: WidgetProps) {
  const me = useSession();
  const tiles = [
    { label: 'Employees', value: data.orgStats.headcount, icon: Users },
    { label: 'Online now', value: data.orgStats.onlineNow, icon: Zap },
    { label: 'Departments', value: data.orgStats.departments, icon: Building2 },
    { label: 'Joined this month', value: data.orgStats.joinersThisMonth, icon: UserPlus },
  ];
  return (
    <Card className="h-full">
      <CardHeader title="Company snapshot" icon={<Building2 />} subtitle={me.organization.name} />
      <div className="grid grid-cols-2 gap-2 px-5 pb-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-surface-2/70 p-3">
            <t.icon className="mb-1.5 size-4 text-primary" />
            <p className="font-display text-2xl font-bold tabular-nums">
              <Counter value={t.value} />
            </p>
            <p className="text-xs text-muted">{t.label}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Widget registry: add a component here + a key in @fg/shared WIDGET_KEYS to ship a new widget. */
export const WIDGETS: Record<WidgetKey, { component: React.ComponentType<WidgetProps>; span: 1 | 2 | 3 }> = {
  welcome: { component: WelcomeWidget, span: 2 },
  clock: { component: ClockWidget, span: 1 },
  team: { component: TeamWidget, span: 2 },
  quickActions: { component: QuickActionsWidget, span: 1 },
  announcements: { component: AnnouncementsWidget, span: 2 },
  holidays: { component: HolidaysWidget, span: 1 },
  recentChats: { component: RecentChatsWidget, span: 1 },
  celebrations: { component: CelebrationsWidget, span: 1 },
  orgStats: { component: OrgStatsWidget, span: 1 },
};


