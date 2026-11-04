'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, Building2, CalendarDays, Copy, MailPlus, Megaphone, Palette, ScrollText, ShieldCheck, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { toast } from 'sonner';
import { PERMISSIONS } from '@fg/shared';
import { AuditList, type AuditEntry } from '@/components/admin/audit-list';
import { Forbidden, LoadError } from '@/components/admin/page-header';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
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
              <UserAvatar person={e} size="sm" showPresence={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{e.name}</span>
                <span className="block truncate text-xs text-muted">{e.email} · added {timeAgo(e.createdAt)}</span>
              </span>
              <Link href="/admin/employees?status=INVITED" className="text-xs font-medium text-primary hover:underline">
                Set password
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminOverview() {
  const me = useSession();
  const can = useCan();
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview'), enabled: can(PERMISSIONS.ANALYTICS_VIEW), refetchInterval: 30_000 });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dash>('/dashboard') });
  if (!can(PERMISSIONS.ANALYTICS_VIEW)) return <Forbidden />;
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
        description="Live from the FG One database."
        actions={
          <>
            {can(PERMISSIONS.SETTINGS_MANAGE) && (
              <Link href="/admin/settings">
                <Button variant="outline">
                  <Palette /> Branding
                </Button>
              </Link>
            )}
            {can(PERMISSIONS.EMPLOYEES_MANAGE) && (
              <Link href="/admin/employees?invite=1">
                <Button>
                  <UserPlus /> Add employee
                </Button>
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
                  ['Online now', d.employees.onlineNow, 'bg-emerald-500'],
                  ['Invited', d.employees.invited, 'bg-amber-400'],
                  ['Deactivated', d.employees.deactivated, 'bg-slate-400'],
                  ['Channels', d.channelCount, 'bg-sky-500'],
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
                <SectionTitle icon={<Activity />} action={<span className="text-xs text-muted tabular-nums">{msgs14} msgs</span>}>
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
                <SectionTitle icon={<ShieldCheck />} action={<Link href="/admin/roles" className="text-xs text-muted hover:text-foreground">Permissions</Link>}>
                  Roles
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
                <SectionTitle icon={<Building2 />}>Shortcuts</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {can(PERMISSIONS.DEPARTMENTS_MANAGE) && <Link href="/admin/departments"><Button size="sm" variant="secondary">Departments</Button></Link>}
                  {can(PERMISSIONS.EMPLOYEES_MANAGE) && <Link href="/admin/roles"><Button size="sm" variant="secondary">Roles</Button></Link>}
                  {can(PERMISSIONS.SETTINGS_MANAGE) && <Link href="/admin/settings"><Button size="sm" variant="secondary">Attendance policy</Button></Link>}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
