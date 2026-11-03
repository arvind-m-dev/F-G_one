'use client';
import { PERMISSIONS, presenceMeta, type WidgetKey } from '@fg/shared';
import { Award, Building2, Cake, Check, CircleCheckBig, Clock, X, CalendarDays, Hash, Lock, Megaphone, MessageSquarePlus, Pin, Search, Sparkles, UserPlus, Users } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AttendancePanel } from '@/components/attendance/attendance-panel';
import { PresenceIcon } from '@/components/presence';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Kbd, Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { channelLabel, useAttendanceToday } from '@/lib/hooks';
import { useLivePeople, useLivePerson } from '@/lib/presence-store';
import { useCan, useClock, useModule, useSession, useUpdatePreferences } from '@/lib/session';
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
  onboarding: { sentMessage: boolean; profileComplete: boolean; statusSet: boolean };
}

export interface WidgetProps {
  data: DashboardData;
  actions: { newMessage: () => void; setStatus: () => void; search: () => void };
}

export function useOpenDm() {
  const router = useRouter();
  return async (userId: string, draft?: string) => {
    try {
      const c = await api<{ id: string }>('/dm', { body: { userIds: [userId] } });
      router.push(`/app/chat/${c.id}${draft ? `?draft=${encodeURIComponent(draft)}` : ''}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

const relDays = (d: number) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`);

/* ───────────── Greeting header ───────────── */
function WelcomeWidget({ data, actions }: WidgetProps) {
  const me = useSession();
  const { time } = useClock();
  const live = useLivePerson({ ...me.user, online: true });
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const nextHoliday = data.holidays[0];
  const summary = [
    data.unreadTotal ? `${data.unreadTotal} unread ${data.unreadTotal === 1 ? 'message' : 'messages'}` : 'no unread messages',
    nextHoliday ? `${nextHoliday.name} is ${relDays(Math.round((parseDateOnly(nextHoliday.date).getTime() - new Date(new Date().toDateString()).getTime()) / 86400_000)).toLowerCase()}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="text-[13px] text-muted tabular-nums" suppressHydrationWarning>
          {now ? `${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${time(now)}` : ' '}
        </p>
        <h1 className="mt-1.5 text-[2rem] leading-[1.15] font-semibold tracking-tight sm:text-[2.35rem]">
          {now ? greeting(now) : 'Hello'}, <span className="text-brand-gradient">{me.user.firstName}</span>.
        </h1>
        <p className="mt-2 text-[15px] text-muted">You have {summary.join(', and ')}.</p>
      </div>
      <button onClick={actions.setStatus} className="group flex shrink-0 items-center gap-3 self-start rounded-xl border bg-surface px-3.5 py-2.5 text-left shadow-sm transition hover:border-border-strong lg:self-auto">
        <span className="grid size-8 place-items-center rounded-lg bg-surface-2">
          <PresenceIcon presence={live.presence} className="size-4" />
        </span>
        <span>
          <span className="block text-[11px] text-muted">Your status</span>
          <span className="block max-w-56 truncate text-[13px] font-medium">{live.statusText || presenceMeta(live.presence).label}</span>
        </span>
      </button>
    </div>
  );
}

/* ───────────── Quick actions ───────────── */
function QuickActionsWidget({ actions }: WidgetProps) {
  const can = useCan();
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={actions.newMessage}>
        <MessageSquarePlus /> New message
      </Button>
      <Button variant="outline" onClick={() => router.push('/app/people')}>
        <Users /> Find people
      </Button>
      {can(PERMISSIONS.EMPLOYEES_MANAGE) && (
        <Button variant="outline" onClick={() => router.push('/admin/employees?invite=1')}>
          <UserPlus /> Invite employee
        </Button>
      )}
      <Button variant="ghost" onClick={actions.search} className="hidden sm:inline-flex">
        <Search /> Search <span className="ml-1 flex gap-0.5"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
      </Button>
    </div>
  );
}

/* ───────────── Day timeline ───────────── */
function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}
function ClockWidget({ data }: WidgetProps) {
  const { time, h24 } = useClock();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ws = minutesOf(data.workday.start);
  const we = minutesOf(data.workday.end);
  const from = Math.max(0, Math.floor(ws / 60) * 60 - 120);
  const to = Math.min(24 * 60, Math.ceil(we / 60) * 60 + 180);
  const span = to - from;
  const pos = (m: number) => `${((Math.min(Math.max(m, from), to) - from) / span) * 100}%`;
  const cur = now ? now.getHours() * 60 + now.getMinutes() : ws;
  const workday = now ? data.workday.workingDays.includes(now.getDay()) : true;
  const left = Math.max(0, we - cur);
  const status = !workday ? 'Not a working day' : cur < ws ? `Workday starts in ${Math.floor((ws - cur) / 60)}h ${(ws - cur) % 60}m` : cur > we ? 'Workday complete' : `${Math.floor(left / 60)}h ${left % 60}m left in the workday`;
  const ticks: number[] = [];
  for (let m = from; m <= to; m += 120) ticks.push(m);
  const label = (m: number) => {
    const d = new Date();
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return h24 ? `${String(d.getHours()).padStart(2, '0')}:00` : d.toLocaleTimeString(undefined, { hour: 'numeric' });
  };

  return (
    <section aria-label="Today's timeline">
      <SectionTitle icon={<CalendarDays />} action={<span className="text-xs text-muted">{status}</span>}>
        Today
      </SectionTitle>
      <div className="relative rounded-xl border bg-surface px-4 pt-4 pb-3">
        <div className="relative h-12">
          {/* hour grid */}
          {ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-border" style={{ left: pos(t) }} />
          ))}
          {/* workday band */}
          <div
            className={cn('absolute inset-y-2 rounded-lg', workday ? 'bg-primary-soft ring-1 ring-primary/20 ring-inset' : 'bg-surface-2')}
            style={{ left: pos(ws), width: `calc(${pos(we)} - ${pos(ws)})` }}
          >
            {workday && now && cur > ws && (
              <motion.div className="h-full rounded-lg bg-primary/15" initial={{ width: 0 }} animate={{ width: `${Math.min(100, ((cur - ws) / (we - ws)) * 100)}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
            )}
 <span className="absolute top-1/2 left-3 hidden -translate-y-1/2 truncate text-xs font-medium whitespace-nowrap text-primary-ink sm:block">
              Working hours · {time(new Date(new Date().setHours(Math.floor(ws / 60), ws % 60)))} – {time(new Date(new Date().setHours(Math.floor(we / 60), we % 60)))}
            </span>
          </div>
          {/* now marker */}
          {now && cur >= from && cur <= to && (
            <div className="absolute inset-y-0 z-10 flex -translate-x-1/2 flex-col items-center" style={{ left: pos(cur) }}>
              <span className="size-2 rounded-full bg-danger ring-4 ring-danger/15" />
              <span className="w-px flex-1 bg-danger" />
            </div>
          )}
        </div>
        <div className="relative mt-1.5 h-4 text-[10px] text-subtle tabular-nums">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>
              {label(t)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────── Needs your attention ───────────── */
function ChatRow({ c }: { c: ChannelSummary }) {
  const other = c.participants[0];
  return (
    <Link href={`/app/chat/${c.id}`} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-surface-2">
      {c.type === 'DIRECT' && other ? (
        <UserAvatar person={other} size="sm" />
      ) : (
        <span className="grid size-8 place-items-center rounded-lg bg-surface-2 text-muted">{c.type === 'PRIVATE' ? <Lock className="size-3.5" /> : <Hash className="size-3.5" />}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('truncate text-[13px]', c.unread ? 'font-semibold' : 'font-medium')}>{channelLabel(c)}</span>
          <span className="ml-auto shrink-0 text-[11px] text-subtle">{c.lastMessage ? timeAgo(c.lastMessage.createdAt) : ''}</span>
        </span>
        <span className={cn('block truncate text-[13px]', c.unread ? 'text-foreground/80' : 'text-muted')}>
          {c.lastMessage ? `${c.type !== 'DIRECT' && c.lastMessage.authorName ? `${c.lastMessage.authorName}: ` : ''}${c.lastMessage.body}` : 'No messages yet'}
        </span>
      </span>
      {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white tabular-nums">{c.unread}</span>}
    </Link>
  );
}
function RecentChatsWidget({ data, actions }: WidgetProps) {
  const unread = data.recentChats.filter((c) => c.unread > 0);
  const rest = data.recentChats.filter((c) => c.unread === 0).slice(0, Math.max(0, 5 - unread.length));
  return (
    <section>
      <SectionTitle
        icon={<Sparkles />}
        action={
          <Button size="sm" variant="ghost" onClick={actions.newMessage}>
            <MessageSquarePlus /> New
          </Button>
        }
      >
        Needs your attention
      </SectionTitle>
      {data.recentChats.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted">No conversations yet. Say hello in a channel.</p>
      ) : (
        <div className="-mx-2">
          {unread.length === 0 && <p className="px-2 pb-1 text-[13px] text-muted">You&apos;re all caught up. Recent conversations:</p>}
          {[...unread, ...rest].map((c) => (
            <ChatRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ───────────── Announcements (editorial) ───────────── */
const priorityLabel = { NORMAL: 'Update', IMPORTANT: 'Important', CRITICAL: 'Urgent' } as const;
const priorityTone = { NORMAL: 'muted', IMPORTANT: 'warning', CRITICAL: 'danger' } as const;
function AnnouncementsWidget({ data }: WidgetProps) {
  const [open, setOpen] = useState<DashboardData['announcements'][number] | null>(null);
  const [lead, ...others] = data.announcements;
  return (
    <section>
      <SectionTitle icon={<Megaphone />}>Announcements</SectionTitle>
      {!lead ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted">No announcements right now.</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
          <button onClick={() => setOpen(lead)} className="group relative overflow-hidden rounded-xl border bg-surface p-5 text-left transition hover:border-border-strong hover:shadow-md">
            <div className="bg-aurora pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <Badge tone={priorityTone[lead.priority]}>{priorityLabel[lead.priority]}</Badge>
                {lead.pinned && (
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <Pin className="size-3" /> Pinned
                  </span>
                )}
              </div>
              <h3 className="mt-3 text-lg leading-snug font-semibold tracking-tight group-hover:text-primary-ink">{lead.title}</h3>
              <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted">{lead.body}</p>
              <p className="mt-4 text-xs text-subtle">
                {lead.author ? `${lead.author.firstName} ${lead.author.lastName}` : 'Company'} · {lead.department?.name ?? 'Everyone'} · {timeAgo(lead.publishedAt)}
              </p>
            </div>
          </button>
          <ul className="divide-y">
            {others.slice(0, 4).map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpen(a)} className="group w-full py-3 text-left first:pt-0">
                  <span className="flex items-center gap-2 text-[11px] text-subtle">
                    {a.priority !== 'NORMAL' && <span className={cn('size-1.5 rounded-full', a.priority === 'CRITICAL' ? 'bg-danger' : 'bg-warning')} />}
                    {a.department?.name ?? 'Everyone'} · {timeAgo(a.publishedAt)}
                  </span>
                  <span className="mt-0.5 block text-sm font-medium group-hover:text-primary-ink">{a.title}</span>
                  <span className="line-clamp-1 text-[13px] text-muted">{a.body}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.title ?? ''}
        description={open ? `${open.author ? `${open.author.firstName} ${open.author.lastName} · ` : ''}${new Date(open.publishedAt).toLocaleString()}` : undefined}
      >
        {open && (
          <div className="space-y-3">
            <div className="flex gap-1.5">
              <Badge tone={priorityTone[open.priority]}>{priorityLabel[open.priority]}</Badge>
              <Badge tone="brand">{open.department?.name ?? 'Company-wide'}</Badge>
            </div>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{open.body}</p>
          </div>
        )}
      </Dialog>
    </section>
  );
}

/* ───────────── Team pulse ───────────── */
const GROUPS = [
  { key: 'available', label: 'Available' },
  { key: 'busy', label: 'Busy or focused' },
  { key: 'away', label: 'Away or on a break' },
  { key: 'offline', label: 'Offline' },
] as const;
function TeamWidget({ data }: WidgetProps) {
  const openDm = useOpenDm();
  const people = useLivePeople(data.team);
  const grouped = GROUPS.map((g) => ({
    ...g,
    people: people.filter((p) => (p.online ? presenceMeta(p.presence).group === g.key || (g.key === 'offline' && p.presence === 'offline') : g.key === 'offline')),
  })).filter((g) => g.people.length);
  return (
    <section>
      <SectionTitle icon={<Users />} action={<Link href="/app/people" className="text-xs text-muted hover:text-foreground">Directory</Link>}>
        Team pulse
      </SectionTitle>
      {people.length === 0 ? (
        <p className="text-sm text-muted">Join a department to see your team here.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.key}>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
                <PresenceIcon presence={g.key === 'available' ? 'available' : g.key === 'busy' ? 'busy' : g.key === 'away' ? 'away' : 'offline'} muted={g.key === 'offline'} className="size-3" />
                {g.label} <span className="text-subtle">{g.people.length}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.people.map((p) => (
                  <Tooltip key={p.id} side="top" content={`${p.name}${p.statusText ? ` — ${p.statusText}` : ''}`}>
                    <button onClick={() => openDm(p.id)} className={cn('rounded-full transition hover:-translate-y-0.5', g.key === 'offline' && 'opacity-60 hover:opacity-100')} aria-label={`Message ${p.name}`}>
                      <UserAvatar person={p} size="sm" />
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ───────────── Coming up ───────────── */
function HolidaysWidget({ data }: WidgetProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    <section>
      <SectionTitle icon={<CalendarDays />}>Upcoming holidays</SectionTitle>
      {data.holidays.length === 0 && <p className="text-sm text-muted">No upcoming holidays.</p>}
      <ul className="space-y-0.5">
        {data.holidays.slice(0, 5).map((h) => {
          const d = parseDateOnly(h.date);
          const days = Math.round((d.getTime() - today.getTime()) / 86400_000);
          return (
            <li key={h.id} className="flex items-center gap-3 py-1.5">
              <span className="w-10 shrink-0 text-center">
                <span className="block text-[10px] font-medium tracking-wide text-subtle uppercase">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
                <span className="block text-base leading-tight font-semibold tabular-nums">{d.getDate()}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{h.name}</span>
                <span className="text-xs text-muted">
                  {d.toLocaleDateString(undefined, { weekday: 'long' })} · {relDays(days)}
                </span>
              </span>
              {h.type === 'OPTIONAL' && <Badge tone="muted">Optional</Badge>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CelebrationsWidget({ data }: WidgetProps) {
  const openDm = useOpenDm();
  const me = useSession();
  return (
    <section>
      <SectionTitle icon={<Cake />}>Celebrations</SectionTitle>
      {data.celebrations.length === 0 && <p className="text-sm text-muted">Nothing in the next two weeks.</p>}
      <ul className="space-y-1">
        {data.celebrations.map((c) => (
          <li key={`${c.type}-${c.person.id}`} className="flex items-center gap-3 py-1.5">
            <span className="relative">
              <UserAvatar person={c.person} size="sm" showPresence={false} />
              <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-canvas ring-1 ring-border">
                {c.type === 'birthday' ? <Cake className="size-2.5 text-rose-500" /> : <Award className="size-2.5 text-amber-500" />}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{c.person.id === me.user.id ? 'You' : c.person.name}</span>
              <span className="text-xs text-muted">
                {c.type === 'birthday' ? 'Birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at ${me.organization.name}`} · {relDays(c.inDays).toLowerCase()}
              </span>
            </span>
            {c.person.id !== me.user.id && (
              <button
                onClick={() => openDm(c.person.id, c.type === 'birthday' ? `Happy birthday, ${c.person.firstName}!` : `Happy work anniversary, ${c.person.firstName}!`)}
                className="rounded-md px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary-soft"
              >
                Send wishes
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrgStatsWidget({ data }: WidgetProps) {
  const me = useSession();
  const items = [
    ['People', data.orgStats.headcount],
    ['Online', data.orgStats.onlineNow],
    ['Teams', data.orgStats.departments],
    ['New this month', data.orgStats.joinersThisMonth],
  ] as const;
  return (
    <section>
      <SectionTitle icon={<Building2 />}>{me.organization.name}</SectionTitle>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border">
        {items.map(([k, v]) => (
          <div key={k} className="bg-surface px-3 py-2.5">
            <dt className="text-[11px] text-muted">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ───────────── Attendance ───────────── */
function AttendanceWidget() {
  const mod = useModule();
  if (!mod('attendance')) return null;
  return (
    <section aria-label="Attendance">
      <AttendancePanel compact />
    </section>
  );
}

/* ───────────── Getting started ───────────── */
function GettingStartedWidget({ data, actions }: WidgetProps) {
  const me = useSession();
  const router = useRouter();
  const mod = useModule();
  const save = useUpdatePreferences();
  const att = useAttendanceToday();
  if (me.preferences.onboardingDismissed) return null;
  const steps = [
    ...(mod('attendance') ? [{ done: !!att.data?.record, title: 'Check in for today', text: 'Tell your team you’ve started and where you’re working.', action: () => router.push('/app/attendance') }] : []),
    { done: data.onboarding.statusSet, title: 'Set your status', text: 'Let people know if you’re available, in a meeting or on a break.', action: actions.setStatus },
    ...(mod('chat') ? [{ done: data.onboarding.sentMessage, title: 'Say hello in a channel', text: 'Open #general and introduce yourself.', action: () => router.push('/app/chat') }] : []),
    { done: data.onboarding.profileComplete, title: 'Complete your profile', text: 'Add a short bio and your work phone.', action: () => router.push('/app/profile') },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section aria-label="Getting started" className="rounded-xl border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CircleCheckBig className="size-4 text-primary" /> Getting started
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {done} of {steps.length} done. A few quick steps to get the most out of FG One.
          </p>
        </div>
        <button onClick={() => void save({ onboardingDismissed: true })} className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground" aria-label="Hide getting started">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title}>
            <button onClick={s.action} disabled={s.done} className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition', s.done ? 'border-transparent bg-surface-2/60' : 'hover:border-primary/40 hover:bg-primary-soft/40')}>
              <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold', s.done ? 'bg-emerald-500 text-white' : 'border border-border-strong text-muted')}>
                {s.done ? <Check className="size-3" /> : i + 1}
              </span>
              <span>
                <span className={cn('block text-[13px] font-medium', s.done && 'text-muted line-through decoration-muted/50')}>{s.title}</span>
                {!s.done && <span className="block text-xs text-muted">{s.text}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Widget registry. `column` places the widget in the page composition; `fixed` widgets can't be hidden.
 * Add a key in @fg/shared WIDGET_KEYS and an entry here to ship a new widget.
 */
export const WIDGETS: Record<WidgetKey, { component: React.ComponentType<WidgetProps>; column: 'header' | 'main' | 'side'; fixed?: boolean }> = {
  welcome: { component: WelcomeWidget, column: 'header', fixed: true },
  gettingStarted: { component: GettingStartedWidget, column: 'header' },
  attendance: { component: AttendanceWidget, column: 'side' },
  quickActions: { component: QuickActionsWidget, column: 'header' },
  clock: { component: ClockWidget, column: 'header' },
  recentChats: { component: RecentChatsWidget, column: 'main' },
  announcements: { component: AnnouncementsWidget, column: 'main' },
  team: { component: TeamWidget, column: 'side' },
  holidays: { component: HolidaysWidget, column: 'side' },
  celebrations: { component: CelebrationsWidget, column: 'side' },
  orgStats: { component: OrgStatsWidget, column: 'side' },
};
