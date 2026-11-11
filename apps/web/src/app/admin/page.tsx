'use client';
import { useQuery } from '@tanstack/react-query';
import { Activity, Ban, CalendarDays, Crown, KeyRound, MailPlus, Megaphone, Palette, ScrollText, ShieldAlert, ShieldCheck, UserPlus, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { PERMISSIONS } from '@fg/shared';
import { AuditList, type AuditEntry } from '@/components/admin/audit-list';
import { TodayAttendance } from '@/components/admin/today-attendance';
import { Forbidden, LoadError } from '@/components/admin/page-header';
import { PageLoading } from '@/components/page-loading';
import { PageHeader } from '@/components/shell/page';
import { buttonVariants } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { firstAdminPage } from '@/lib/admin-nav';
import { api, errorMessage } from '@/lib/api';
import { useEmployeeList } from '@/lib/hooks';
import { useCan, useSession } from '@/lib/session';
import { parseDateOnly, timeAgo } from '@/lib/utils';

interface Overview {
  employees: { active: number; invited: number; deactivated: number; onlineNow: number };
  pendingInvites: number;
  channelCount: number;
  departments: { id: string; name: string; color: string; members: number }[];
  roles: { key: string; name: string; members: number }[];
  activity: { date: string; messages: number }[];
  hiring: { month: string; joiners: number }[];
  recentAudit: AuditEntry[];
  /** Only for people who manage accounts (and Super Admins). */
  access: AccessSummary | null;
}
type PersonLink = { id: string; name: string; avatarUrl: string | null; avatarColor: string };
interface AccessSummary {
  accounts: { active: number; suspended: number; deactivated: number; archived: number; waitingForPassword: number };
  suspended: PersonLink[];
  locked: { count: number; people: (PersonLink & { lockedUntil: string })[] };
  adminsWithoutMfa: { count: number; people: (PersonLink & { roleName: string; isSuperAdmin: boolean })[] };
  superAdmins: { active: number; pending: number; used: number; limit: number } | null;
}
interface Dash {
  holidays: { id: string; name: string; date: string; type: string }[];
  announcements: { id: string; title: string; priority: string; publishedAt: string }[];
}

/** Accounts that exist but cannot sign in yet because no password was set (older invitations). */
function PendingInvites() {
  const list = useEmployeeList({ status: 'INVITED', pageSize: 6 });
  const items = list.data?.items ?? [];
  if (!list.isPending && items.length === 0) return null;
  return (
    <section>
      <SectionTitle icon={<MailPlus />} action={<Link href="/admin/employees?status=INVITED" className="text-xs text-muted hover:text-foreground">Open list</Link>}>
        Waiting for a password
      </SectionTitle>
      {list.isPending ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="divide-y rounded-xl border">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
              <Link href={`/admin/employees/${e.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar person={e} size="sm" showPresence={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium group-hover:underline">{e.name}</span>
                  <span className="block truncate text-xs text-muted">{e.email} · added {timeAgo(e.createdAt)}</span>
                </span>
              </Link>
              <Link href={`/admin/employees/${e.id}`} className="text-xs font-medium text-primary hover:underline" aria-label={`Set a password for ${e.name}`}>
                Set password
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PeopleLinks<T extends PersonLink>({ people, more, detail }: { people: T[]; more: number; detail?: (p: T) => string }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {people.map((p) => (
        <li key={p.id}>
          <Link href={`/admin/employees/${p.id}`} className="flex items-center gap-1.5 rounded-full border bg-surface py-0.5 pr-2.5 pl-0.5 text-xs transition hover:bg-surface-2">
            <UserAvatar person={p} size="xs" showPresence={false} />
            <span className="font-medium">{p.name}</span>
            {detail && <span className="text-muted">{detail(p)}</span>}
          </Link>
        </li>
      ))}
      {more > 0 && <li className="self-center text-xs text-muted">and {more} more</li>}
    </ul>
  );
}

/** Who can sign in, and the security gaps an admin should close. Each number links to where it can be acted on. */
function AccessAndSecurity({ a }: { a: AccessSummary }) {
  const states: { label: string; value: number; dot: string; href?: string }[] = [
    { label: 'Active', value: a.accounts.active, dot: 'bg-success', href: '/admin/employees?status=ACTIVE' },
    { label: 'Waiting for a password', value: a.accounts.waitingForPassword, dot: 'bg-warning', href: '/admin/employees?status=INVITED' },
    { label: 'Suspended', value: a.accounts.suspended, dot: 'bg-danger', href: '/admin/employees?status=SUSPENDED' },
    { label: 'Deactivated', value: a.accounts.deactivated, dot: 'bg-subtle', href: '/admin/employees?status=DEACTIVATED' },
    ...(a.accounts.archived ? [{ label: 'Archived', value: a.accounts.archived, dot: 'bg-border-strong' }] : []),
  ];
  const sa = a.superAdmins;
  const checks: { ok: boolean; info?: boolean; title: string; body: React.ReactNode }[] = [
    {
      ok: a.adminsWithoutMfa.count === 0,
      title: a.adminsWithoutMfa.count === 0 ? 'Everyone with admin access uses two-step verification' : `${a.adminsWithoutMfa.count} ${a.adminsWithoutMfa.count === 1 ? 'person' : 'people'} with admin access ${a.adminsWithoutMfa.count === 1 ? 'does' : 'do'} not use two-step verification`,
      body:
        a.adminsWithoutMfa.count > 0 ? (
          <>
            <p className="text-xs text-muted">Ask them to turn it on in Settings, Security. A stolen password is then not enough to get in.</p>
            <PeopleLinks people={a.adminsWithoutMfa.people} more={a.adminsWithoutMfa.count - a.adminsWithoutMfa.people.length} detail={(p) => (p.isSuperAdmin ? 'Super Admin' : p.roleName)} />
          </>
        ) : null,
    },
    {
      ok: a.locked.count === 0,
      title: a.locked.count === 0 ? 'No accounts are locked' : `${a.locked.count} ${a.locked.count === 1 ? 'account is' : 'accounts are'} locked after too many wrong passwords`,
      body:
        a.locked.count > 0 ? (
          <>
            <p className="text-xs text-muted">They unlock by themselves. To let someone in sooner, open their page and set a new password.</p>
            <PeopleLinks people={a.locked.people} more={a.locked.count - a.locked.people.length} detail={(p) => `until ${new Date(p.lockedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`} />
          </>
        ) : null,
    },
    ...(a.accounts.suspended > 0
      ? [{ ok: true, info: true, title: `${a.accounts.suspended} suspended ${a.accounts.suspended === 1 ? 'account' : 'accounts'} cannot sign in`, body: <PeopleLinks people={a.suspended} more={a.accounts.suspended - a.suspended.length} /> }]
      : []),
  ];
  return (
    <section aria-labelledby="access-title">
      <SectionTitle icon={<ShieldCheck />} action={sa && <Link href="/admin/super-admins" className="text-xs text-muted hover:text-foreground">Super Admins</Link>}>
        <span id="access-title">Access and security</span>
      </SectionTitle>
      <div className="rounded-xl border">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-t-xl border-b bg-border sm:grid-cols-4">
          {states.slice(0, 4).map((s) => {
            const inner = (
              <>
                <dt className="flex items-center gap-1.5 text-xs text-muted">
                  <span className={`size-1.5 rounded-full ${s.dot}`} /> {s.label}
                </dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{s.value}</dd>
              </>
            );
            return s.href ? (
              <Link key={s.label} href={s.href} className="bg-surface px-3.5 py-2.5 transition hover:bg-surface-2" aria-label={`${s.label}: ${s.value}. Open the list`}>
                {inner}
              </Link>
            ) : (
              <div key={s.label} className="bg-surface px-3.5 py-2.5">
                {inner}
              </div>
            );
          })}
        </dl>
        <ul className="divide-y">
          {checks.map((c) => (
            <li key={c.title} className="flex gap-3 px-3.5 py-3">
              {c.info ? <Ban className="mt-0.5 size-4 shrink-0 text-muted" /> : c.ok ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{c.title}</p>
                {c.body}
              </div>
            </li>
          ))}
          {sa && (
            <li className="flex gap-3 px-3.5 py-3">
              <Crown className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">
                  {sa.active} Super Admin{sa.active === 1 ? '' : 's'}
                  {sa.pending ? `, ${sa.pending} waiting to accept` : ''} · {sa.used} of {sa.limit} places used
                </p>
                {sa.active < 2 && <p className="text-xs text-muted">With only one, your company is stuck if that person loses access. Consider nominating a second.</p>}
              </div>
              <Link href="/admin/super-admins" className="self-center text-xs font-medium text-primary hover:underline">
                Manage
              </Link>
            </li>
          )}
          {a.accounts.archived > 0 && (
            <li className="px-3.5 py-2.5 text-xs text-muted">{a.accounts.archived} archived {a.accounts.archived === 1 ? 'account is' : 'accounts are'} kept for history and cannot sign in.</li>
          )}
        </ul>
      </div>
    </section>
  );
}

/** Loading and error states for the side sections fed by the shared dashboard query. */
function DashState({ q, what }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; what: string }) {
  if (q.isPending) return <Skeleton className="h-14" />;
  if (!q.isError) return null;
  return (
    <p role="alert" className="text-[13px] text-muted">
      We couldn&apos;t load {what}. {errorMessage(q.error)}{' '}
      <button type="button" className="font-medium text-primary hover:underline" onClick={() => void q.refetch()}>
        Try again
      </button>
    </p>
  );
}

export default function AdminOverview() {
  const me = useSession();
  const can = useCan();
  const router = useRouter();
  const allowed = can(PERMISSIONS.ANALYTICS_VIEW);
  // People who manage one area but cannot see company analytics start on the first page they can open.
  const fallback = allowed ? null : firstAdminPage(can, me.isSuperAdmin || me.superAdminNeedsMfa);
  useEffect(() => {
    if (fallback) router.replace(fallback);
  }, [fallback, router]);
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview'), enabled: allowed, refetchInterval: 30_000 });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dash>('/dashboard'), enabled: allowed });
  if (fallback)
    return (
      <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
        <PageLoading />
      </div>
    );
  if (!allowed) return <Forbidden />;
  const d = q.data;
  const total = d ? d.departments.reduce((n, x) => n + x.members, 0) : 0;
  const unassigned = d ? d.employees.active - total : 0;
  const msgs14 = d ? d.activity.reduce((n, x) => n + x.messages, 0) : 0;

  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        className="px-0 pt-0 sm:px-0"
        eyebrow="Admin portal"
        title={`${me.organization.name} at a glance`}
        description="People, access and activity across your company. Updates every 30 seconds."
        actions={
          <>
            {can(PERMISSIONS.SETTINGS_MANAGE) && (
              <Link href="/admin/settings?tab=branding" className={buttonVariants({ variant: 'outline' })}>
                <Palette /> Branding
              </Link>
            )}
            {can(PERMISSIONS.EMPLOYEES_MANAGE) && (
              <Link href="/admin/employees?add=1" className={buttonVariants()}>
                <UserPlus /> Add employee
              </Link>
            )}
          </>
        }
      />

      {q.isError && !d ? (
        <LoadError what="the overview" error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="space-y-6">
          <Skeleton className="h-28" />
          <div className="grid gap-8 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      ) : (
        <>
          {/* Team composition band */}
          <section className="rounded-2xl border bg-surface p-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-sm text-muted">Active team</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{d.employees.active}</p>
              </div>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                {[
                  ['Online now', d.employees.onlineNow, 'bg-success'],
                  // Account states are listed once: in Access and security when you can see it, otherwise here.
                  ...(d.access
                    ? []
                    : [
                        ['Waiting for a password', d.employees.invited, 'bg-warning'],
                        ['Deactivated', d.employees.deactivated, 'bg-subtle'],
                      ]),
                  ['Departments', d.departments.length, 'bg-primary'],
                  ['Channels', d.channelCount, 'bg-info'],
                ].map(([k, v, c]) => (
                  <div key={k as string}>
                    <dt className="flex items-center gap-1.5 text-xs text-muted">
                      <span className={`size-1.5 rounded-full ${c}`} /> {k}
                    </dt>
                    <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Headcount by department">
              {d.departments
                .filter((x) => x.members)
                .map((x, i) => (
                  <motion.div key={x.id} initial={{ width: 0 }} animate={{ width: `${(x.members / Math.max(1, d.employees.active)) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.05 }} style={{ background: x.color }} title={`${x.name}: ${x.members}`} className="h-full border-r-2 border-surface last:border-0" />
                ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
              {d.departments.map((x) => (
                <li key={x.id} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: x.color }} /> {x.name} <span className="text-foreground tabular-nums">{x.members}</span>
                </li>
              ))}
              {unassigned > 0 && <li>No department <span className="text-foreground">{unassigned}</span></li>}
            </ul>
          </section>

          <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-10">
              {can(PERMISSIONS.ATTENDANCE_VIEW_ALL) && <TodayAttendance />}
              {d.access && <AccessAndSecurity a={d.access} />}
              {can(PERMISSIONS.EMPLOYEES_MANAGE) && <PendingInvites />}
              {can(PERMISSIONS.AUDIT_READ) && (
                <section>
                  <SectionTitle icon={<ScrollText />} action={<Link href="/admin/audit" className="text-xs text-muted hover:text-foreground">Audit logs</Link>}>
                    Recent administrative activity
                  </SectionTitle>
                  <div className="-mx-5">
                    <AuditList items={d.recentAudit} compact />
                  </div>
                </section>
              )}
            </div>
            <aside className="space-y-9 lg:border-l lg:pl-10">
              <section>
                <SectionTitle icon={<Activity />} action={<span className="text-xs text-muted tabular-nums">{msgs14} {msgs14 === 1 ? 'message' : 'messages'}</span>}>
                  Conversation activity
                </SectionTitle>
                <div className="h-24">
                  <ResponsiveContainer>
                    <AreaChart data={d.activity} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="act" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" hide />
                      <Tooltip contentStyle={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} labelFormatter={(v: string) => new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                      <Area type="monotone" dataKey="messages" stroke="var(--brand)" strokeWidth={2} fill="url(#act)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-xs text-muted">Last 14 days, all channels and direct messages.</p>
              </section>
              <section>
                <SectionTitle icon={<KeyRound />} action={<Link href="/admin/roles" className="text-xs text-muted hover:text-foreground">Roles &amp; permissions</Link>}>
                  People in each role
                </SectionTitle>
                <ul className="space-y-2 text-[13px]">
                  {d.roles.map((r) => (
                    <li key={r.key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-muted">{r.name}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <motion.span className="block h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(r.members / Math.max(1, d.employees.active)) * 100}%` }} transition={{ duration: 0.6 }} />
                      </span>
                      <span className="w-6 text-right tabular-nums">{r.members}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <SectionTitle icon={<CalendarDays />}>Upcoming holidays</SectionTitle>
                <DashState q={dash} what="holidays" />
                {dash.data && !dash.data.holidays.length && <p className="text-[13px] text-muted">No holidays coming up.</p>}
                <ul className="space-y-1.5 text-[13px]">
                  {(dash.data?.holidays ?? []).slice(0, 3).map((h) => (
                    <li key={h.id} className="flex justify-between gap-3">
                      <span className="truncate">{h.name}</span>
                      <span className="shrink-0 text-muted tabular-nums">{parseDateOnly(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <SectionTitle icon={<Megaphone />}>Live announcements</SectionTitle>
                <DashState q={dash} what="announcements" />
                {dash.data && !dash.data.announcements.length && <p className="text-[13px] text-muted">No announcements right now.</p>}
                <ul className="space-y-2 text-[13px]">
                  {(dash.data?.announcements ?? []).slice(0, 3).map((a) => (
                    <li key={a.id}>
                      <p className="truncate font-medium">{a.title}</p>
                      <p className="text-xs text-muted">{timeAgo(a.publishedAt)}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <SectionTitle icon={<Zap />}>Shortcuts</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {can(PERMISSIONS.DEPARTMENTS_MANAGE) && <Link href="/admin/departments" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>Departments</Link>}
                  {can(PERMISSIONS.EMPLOYEES_MANAGE) && <Link href="/admin/roles" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>Roles &amp; permissions</Link>}
                  {can(PERMISSIONS.SETTINGS_MANAGE) && <Link href="/admin/settings?tab=attendance" className={buttonVariants({ size: 'sm', variant: 'secondary' })}>Attendance policy</Link>}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
