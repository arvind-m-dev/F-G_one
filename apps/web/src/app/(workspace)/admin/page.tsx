'use client';
import { useQuery } from '@tanstack/react-query';
import { Activity, Building2, Hash, MailPlus, ScrollText, ShieldCheck, UserCheck, UserX, Users, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PERMISSIONS } from '@fg/shared';
import { AuditList, type AuditEntry } from '@/components/admin/audit-list';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';

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

const ROLE_COLORS = ['#8b5cf6', '#ec4899', '#0ea5e9', '#14b8a6'];

function Stat({ icon: Icon, label, value, tone, i }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: string; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
      <Card className="relative overflow-hidden p-5">
        <div className="absolute -top-6 -right-6 size-24 rounded-full opacity-15 blur-xl" style={{ background: tone }} />
        <span className="grid size-9 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${tone} 15%, transparent)`, color: tone }}>
          <Icon className="size-4" />
        </span>
        <p className="mt-3 font-display text-3xl font-bold tabular-nums">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </Card>
    </motion.div>
  );
}

const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--foreground)' };

export default function AdminOverview() {
  const can = useCan();
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview'), enabled: can(PERMISSIONS.ANALYTICS_VIEW), refetchInterval: 30_000 });
  if (!can(PERMISSIONS.ANALYTICS_VIEW)) return <Forbidden />;
  const d = q.data;
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Workspace overview"
        description="Live numbers from the FG One database."
        actions={
          can(PERMISSIONS.EMPLOYEES_MANAGE) && (
            <Link href="/admin/employees?invite=1">
              <Button variant="gradient">
                <MailPlus /> Invite employee
              </Button>
            </Link>
          )
        }
      />
      {!d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat i={0} icon={Users} label="Active employees" value={d.employees.active} tone="#6366f1" />
            <Stat i={1} icon={Zap} label="Online right now" value={d.employees.onlineNow} tone="#22c55e" />
            <Stat i={2} icon={MailPlus} label="Pending invitations" value={d.pendingInvites} tone="#f59e0b" />
            <Stat i={3} icon={Hash} label="Channels" value={d.channelCount} tone="#0ea5e9" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Messaging activity" icon={<Activity />} subtitle="Messages per day, last 14 days" />
              <div className="h-64 px-2 pb-4">
                <ResponsiveContainer>
                  <AreaChart data={d.activity} margin={{ left: 0, right: 16, top: 8 }}>
                    <defs>
                      <linearGradient id="msgFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="messages" stroke="var(--brand)" strokeWidth={2.5} fill="url(#msgFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Roles" icon={<ShieldCheck />} subtitle="Active members by role" />
              <div className="flex items-center gap-4 px-5 pb-5">
                <div className="h-40 w-40 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={d.roles} dataKey="members" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={3} stroke="none">
                        {d.roles.map((r, i) => (
                          <Cell key={r.key} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2 text-sm">
                  {d.roles.map((r, i) => (
                    <li key={r.key} className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ background: ROLE_COLORS[i % ROLE_COLORS.length] }} />
                      <span className="text-muted">{r.name}</span>
                      <b className="tabular-nums">{r.members}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Departments" icon={<Building2 />} subtitle="Headcount" />
              <div className="h-64 px-2 pb-4">
                <ResponsiveContainer>
                  <BarChart data={d.departments} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="members" radius={[0, 6, 6, 0]} barSize={16}>
                      {d.departments.map((x) => (
                        <Cell key={x.id} fill={x.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="New joiners" icon={<UserCheck />} subtitle="By joining month, last 6 months" />
              <div className="h-64 px-2 pb-4">
                <ResponsiveContainer>
                  <BarChart data={d.hiring} margin={{ right: 16, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={(v: string) => new Date(`${v}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
                    <Bar dataKey="joiners" fill="var(--brand-2)" radius={[6, 6, 0, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Account status" icon={<UserX />} />
              <div className="space-y-3 px-5 pb-5">
                {[
                  { label: 'Active', value: d.employees.active, color: '#22c55e' },
                  { label: 'Invited', value: d.employees.invited, color: '#f59e0b' },
                  { label: 'Deactivated', value: d.employees.deactivated, color: '#94a3b8' },
                ].map((s) => {
                  const total = d.employees.active + d.employees.invited + d.employees.deactivated || 1;
                  return (
                    <div key={s.label}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-muted">{s.label}</span>
                        <b className="tabular-nums">{s.value}</b>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <motion.div className="h-full rounded-full" style={{ background: s.color }} initial={{ width: 0 }} animate={{ width: `${(s.value / total) * 100}%` }} transition={{ duration: 0.8 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {can(PERMISSIONS.AUDIT_READ) && (
            <Card className="mt-4">
              <CardHeader
                title="Recent activity"
                icon={<ScrollText />}
                subtitle="Sensitive actions are recorded in the audit log"
                action={
                  <Link href="/admin/audit" className="text-sm font-medium text-primary hover:underline">
                    View all
                  </Link>
                }
              />
              <div className="pb-2">
                <AuditList items={d.recentAudit} compact />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
