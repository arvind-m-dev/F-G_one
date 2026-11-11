'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  AtSign,
  BadgeCheck,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Clock,
  KeyRound,
  Laptop,
  LockKeyhole,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  UserRound,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type Scope } from '@fg/shared';
import { AuditList, type AuditEntry } from '@/components/admin/audit-list';
import { EmployeeAccess } from '@/components/admin/employee-access';
import { AccountStatusDialog, ChangeEmailDialog, EditEmployeeDialog, SetPasswordDialog, STATUS_ACTION_META, statusActions, type StatusAction } from '@/components/admin/employee-dialogs';
import { STATUS_LABEL, STATUS_TONE } from '@/components/admin/employee-status';
import { Forbidden, LoadError, PageHeader } from '@/components/admin/page-header';
import { timeZoneLabel } from '@/components/admin/timezones';
import { useUnsavedGuard } from '@/components/admin/use-unsaved-guard';
import { LOCATION_LABEL } from '@/components/attendance/attendance-panel';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { describeDevice } from '@/components/security/security-settings';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { UserAvatar } from '@/components/user-avatar';
import { api, ApiError, errorMessage } from '@/lib/api';
import { fmtDays, fmtDuration, fmtRange } from '@/lib/hooks';
import { useCan, useClock, useSession } from '@/lib/session';
import type { AttendanceRecord, Employee, LeaveBalance } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, timeAgo } from '@/lib/utils';

interface DeviceSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

interface Overview {
  employee: Employee & { reports: { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null; designation: string | null; status: Employee['status'] }[] };
  access: {
    role: { id: string; key: string; name: string; rank: number };
    extraRoles: { id: string; key: string; name: string; rank: number; archived: boolean }[];
    overrides: { id: string; permission: string; effect: 'ALLOW' | 'DENY'; scope: Scope | null; reason: string | null; createdAt: string }[];
    grants: Record<string, Scope>;
  };
  account: {
    status: Employee['status'];
    isSuperAdmin: boolean;
    superAdminActive: boolean;
    mfaEnabled: boolean;
    mfaEnabledAt: string | null;
    mustChangePassword: boolean;
    hasPassword: boolean;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    createdAt: string;
    deactivatedAt: string | null;
    suspendedAt: string | null;
    suspensionReason: string | null;
    archivedAt: string | null;
    lockedUntil: string | null;
    failedLogins: number;
  };
  attendance: {
    from: string;
    to: string;
    timezone: string;
    items: AttendanceRecord[];
    summary: { daysPresent: number; late: number; autoCheckedOut: number; dayOffWorked: number; office: number; home: number; clientSite: number; workedMinutes: number };
  } | null;
  leave: {
    year: { start: string; end: string };
    balances: LeaveBalance[];
    requests: {
      id: string;
      type: { id: string; name: string; code: string; color: string; paid: boolean };
      startDate: string;
      endDate: string;
      halfDay: 'NONE' | 'FIRST_HALF' | 'SECOND_HALF';
      days: number;
      reason: string | null;
      status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
      decisionNote: string | null;
      approver: { id: string; firstName: string; lastName: string } | null;
      createdAt: string;
    }[];
  };
  sessions: DeviceSession[];
  activity: (AuditEntry & { actorId: string | null })[] | null;
}

const TABS = [
  { value: 'overview', label: 'Overview', icon: UserRound },
  { value: 'employment', label: 'Employment', icon: Briefcase },
  { value: 'access', label: 'Access', icon: ShieldCheck },
  { value: 'attendance', label: 'Attendance', icon: Clock },
  { value: 'leave', label: 'Leave', icon: CalendarDays },
  { value: 'devices', label: 'Devices', icon: Laptop },
  { value: 'activity', label: 'Activity', icon: Activity },
] as const;
type Tab = (typeof TABS)[number]['value'];

const LEAVE_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'muted' } as const;
const LEAVE_LABEL = { PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Declined', CANCELLED: 'Cancelled' } as const;
const HALF_LABEL = { NONE: '', FIRST_HALF: 'first half', SECOND_HALF: 'second half' } as const;

const fmtDate = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString(undefined, { ...opts, ...(d.length === 10 ? { timeZone: 'UTC' } : {}) }) : null;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const me = useSession();
  const [get, set] = useUrlState({ tab: 'overview' });
  const tab = (TABS.some((t) => t.value === get('tab')) ? get('tab') : 'overview') as Tab;
  // Unsaved changes in the Access tab: ask before another tab or page throws them away.
  const [accessDirty, setAccessDirty] = useState(false);
  const [leavingTo, setLeavingTo] = useState<Tab | null>(null);
  useUnsavedGuard(accessDirty, 'You have unsaved access changes. Leave without saving them?');
  const go = (t: Tab) => {
    if (tab === 'access' && accessDirty && t !== 'access') setLeavingTo(t);
    else set({ tab: t });
  };
  const q = useQuery({
    queryKey: ['employee-overview', id],
    queryFn: () => api<Overview>(`/employees/${id}/overview`),
    retry: (n, e) => !(e instanceof ApiError && [403, 404].includes(e.status)) && n < 2,
    enabled: can(PERMISSIONS.EMPLOYEES_MANAGE),
  });
  const [editing, setEditing] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [status, setStatus] = useState<StatusAction | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  if (!can(PERMISSIONS.EMPLOYEES_MANAGE)) return <Forbidden />;

  const crumbs = [{ label: 'Employees', href: '/admin/employees' }];
  const shell = (children: React.ReactNode) => <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">{children}</div>;

  if (q.isPending) {
    return shell(
      <>
        <PageHeader title="Employee" parents={crumbs} />
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="mt-8 h-9 w-full max-w-xl" />
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </>,
    );
  }

  if (q.isError) {
    const e = q.error;
    const status403 = e instanceof ApiError && e.status === 403;
    const status404 = e instanceof ApiError && e.status === 404;
    return shell(
      <>
        <PageHeader title="Employee" parents={crumbs} />
        <Card>
          {status403 ? (
            <Forbidden title="You can't manage this person" description="Their role is the same as or above yours, or they are a Super Admin. Ask a Super Admin if something needs to change." />
          ) : status404 ? (
            <EmptyState icon={<UserRound />} title="This person isn't here" description="They may have been removed, or the link is wrong." action={<Link href="/admin/employees" className={buttonVariants({ variant: 'outline' })}>Back to employees</Link>} />
          ) : (
            <div className="p-4">
              <LoadError what="this employee" error={e} onRetry={() => q.refetch()} />
            </div>
          )}
        </Card>
      </>,
    );
  }

  const o = q.data;
  const e = o.employee;
  const self = e.id === me.user.id;
  const inactive = e.status === 'DEACTIVATED' || e.status === 'ARCHIVED';

  return shell(
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <UserAvatar person={e} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{e.name}</span>
              <span className="mt-0.5 block truncate text-sm font-normal text-muted">{[e.designation, e.department?.name].filter(Boolean).join(' · ') || e.email}</span>
            </span>
          </span>
        }
        documentTitle={e.name}
        parents={crumbs}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit details
            </Button>
            {!self && (
              <DropdownMenu>
                <DropdownTrigger asChild>
                  <Button variant="outline" aria-label="More actions">
                    <MoreHorizontal /> More
                  </Button>
                </DropdownTrigger>
                <DropdownContent align="end">
                  <DropdownItem onSelect={() => setChangingEmail(true)}>
                    <AtSign /> Change email
                  </DropdownItem>
                  {!inactive && (
                    <DropdownItem onSelect={() => setSettingPassword(true)}>
                      <KeyRound /> Set a new password
                    </DropdownItem>
                  )}
                  <DropdownItem onSelect={() => setSigningOut(true)} disabled={!o.sessions.length} className="data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
                    <LogOut /> Sign out everywhere
                  </DropdownItem>
                  <DropdownSeparator />
                  {statusActions(e.status).map((a) => {
                    const meta = STATUS_ACTION_META[a];
                    return (
                      <DropdownItem key={a} danger={meta.danger} onSelect={() => setStatus(a)}>
                        <meta.icon /> {meta.label}
                      </DropdownItem>
                    );
                  })}
                </DropdownContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
          <Badge tone={e.role.key === 'administrator' ? 'brand' : 'default'}>{e.role.name}</Badge>
          {o.access.extraRoles.map((r) => (
            <Badge key={r.id}>+ {r.name}</Badge>
          ))}
          {e.isSuperAdmin && (
            <Badge tone="brand">
              <ShieldCheck className="size-3" aria-hidden /> Super Admin{!o.account.superAdminActive ? ' (paused)' : ''}
            </Badge>
          )}
          <span className="ml-1 text-muted">{e.email}</span>
        </div>
      </PageHeader>

      {self && (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">
          This is your own account. Another administrator changes your email or sets a new password; manage your own devices in <Link href="/app/settings" className="font-medium text-foreground underline">settings</Link>.
        </p>
      )}

      <Tabs value={tab} onValueChange={go} items={TABS} label="Employee sections">
        <TabPanel value="overview">
          <OverviewTab
            o={o}
            go={go}
            actions={self ? {} : { setPassword: inactive ? undefined : () => setSettingPassword(true), liftSuspension: () => setStatus('unsuspend'), restore: () => setStatus('restore') }}
          />
        </TabPanel>
        <TabPanel value="employment">
          <EmploymentTab o={o} go={go} />
        </TabPanel>
        <TabPanel value="access">
          <EmployeeAccess userId={e.id} firstName={e.firstName} onDirtyChange={setAccessDirty} />
        </TabPanel>
        <TabPanel value="attendance">
          <AttendanceTab o={o} />
        </TabPanel>
        <TabPanel value="leave">
          <LeaveTab o={o} />
        </TabPanel>
        <TabPanel value="devices">
          <DevicesTab o={o} self={self} onSignOut={() => setSigningOut(true)} />
        </TabPanel>
        <TabPanel value="activity">
          <ActivityTab o={o} />
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={!!leavingTo}
        onOpenChange={(v) => !v && setLeavingTo(null)}
        title="Leave without saving?"
        description={`Your changes to ${e.firstName}'s access have not been saved. If you leave this tab they are lost.`}
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          const t = leavingTo;
          setLeavingTo(null);
          setAccessDirty(false);
          if (t) set({ tab: t });
        }}
      />

      <EditEmployeeDialog employee={editing ? e : null} onOpenChange={(v) => !v && setEditing(false)} />
      <ChangeEmailDialog employee={changingEmail ? e : null} onOpenChange={(v) => !v && setChangingEmail(false)} />
      <SetPasswordDialog employee={settingPassword ? e : null} onOpenChange={(v) => !v && setSettingPassword(false)} />
      <AccountStatusDialog target={status ? { employee: e, action: status } : null} onOpenChange={(v) => !v && setStatus(null)} />
      <SignOutEverywhere employee={signingOut ? e : null} onOpenChange={(v) => !v && setSigningOut(false)} />
    </>,
  );
}

function SignOutEverywhere({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const reauth = useReauth();
  const m = useMutation({
    mutationFn: (id: string) => reauth.run(() => api<{ count: number }>(`/employees/${id}/sessions/revoke`, { method: 'POST' })),
    onSuccess: (r) => {
      toast.success(r.count ? `Signed out of ${r.count} device${r.count === 1 ? '' : 's'}` : 'They were not signed in anywhere');
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['employee-overview'] });
    },
    onError: (e) => {
      if (!isCancelled(e)) toast.error(errorMessage(e));
    },
  });
  return (
    <>
      <ConfirmDialog
        open={!!employee}
        onOpenChange={onOpenChange}
        title={employee ? `Sign ${employee.firstName} out everywhere?` : ''}
        description="Every device they are signed in on is signed out right away. They can sign in again with their email and password."
        confirmLabel="Sign out everywhere"
        danger
        loading={m.isPending}
        onConfirm={() => employee && m.mutate(employee.id)}
      />
      {reauth.dialog}
    </>
  );
}

/* ───────────── tabs ───────────── */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children ?? <span className="text-subtle">Not set</span>}</dd>
    </div>
  );
}

function PersonLink({ p }: { p: { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null; designation?: string | null } }) {
  const name = `${p.firstName} ${p.lastName}`;
  return (
    <Link href={`/admin/employees/${p.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-surface-2">
      <UserAvatar person={{ ...p, name }} size="sm" showPresence={false} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        {p.designation && <span className="block truncate text-xs text-muted">{p.designation}</span>}
      </span>
    </Link>
  );
}

/** Things an admin can do straight from a "needs attention" notice. Left out when not allowed (your own account, inactive accounts). */
interface NoticeActions {
  setPassword?: () => void;
  liftSuspension?: () => void;
  restore?: () => void;
}

function OverviewTab({ o, go, actions }: { o: Overview; go: (t: Tab) => void; actions: NoticeActions }) {
  const a = o.account;
  const att = o.attendance;
  const pending = o.leave.requests.filter((r) => r.status === 'PENDING').length;
  const attention: { icon: React.ReactNode; text: string; tone: 'warning' | 'danger'; action?: { label: string; onClick?: () => void; href?: string } }[] = [];
  const act = (label: string, onClick?: () => void) => (onClick ? { label, onClick } : undefined);
  if (a.status === 'SUSPENDED')
    attention.push({
      icon: <PauseCircle />,
      text: `Suspended${a.suspendedAt ? ` since ${fmtWhen(a.suspendedAt)}` : ''}: they can't sign in until the suspension is lifted.${a.suspensionReason ? ` Reason: ${a.suspensionReason}` : ''}`,
      tone: 'danger',
      action: act('Lift suspension', actions.liftSuspension),
    });
  if (a.status === 'ARCHIVED')
    attention.push({ icon: <Archive />, text: `Archived${a.archivedAt ? ` on ${fmtDate(a.archivedAt)}` : ''}. Hidden from lists and pickers; their history is kept. Restore them to make changes.`, tone: 'warning', action: act('Restore', actions.restore) });
  if (a.lockedUntil) attention.push({ icon: <LockKeyhole />, text: `Sign-in is locked until ${fmtWhen(a.lockedUntil)} after too many wrong passwords. Setting a new password unlocks it.`, tone: 'danger', action: act('Set a new password', actions.setPassword) });
  if (!a.hasPassword) attention.push({ icon: <KeyRound />, text: 'No password yet. Set one so they can sign in.', tone: 'warning', action: act('Set a password', actions.setPassword) });
  if (a.mustChangePassword) attention.push({ icon: <KeyRound />, text: 'They will choose their own password at next sign-in.', tone: 'warning' });
  if (a.isSuperAdmin && !a.superAdminActive) attention.push({ icon: <ShieldOff />, text: 'Super Admin authority is paused until they turn on two-step verification.', tone: 'warning' });
  if (pending) attention.push({ icon: <CalendarClock />, text: `${pending} leave request${pending === 1 ? '' : 's'} waiting for approval.`, tone: 'warning', action: { label: 'Review leave', href: '/admin/leave?status=PENDING' } });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="space-y-8">
        {attention.length > 0 && (
          <ul className="space-y-2" aria-label="Needs attention">
            {attention.map((x, i) => (
              <li key={i} className={cn('flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-lg border px-3 py-2 text-[13px]', x.tone === 'danger' ? 'border-danger/25 bg-danger/8' : 'border-warning/30 bg-warning/10')}>
                <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', x.tone === 'danger' ? 'text-danger' : 'text-warning')} aria-hidden>
                  {x.icon}
                </span>
                <span className="min-w-0 flex-1 basis-56">{x.text}</span>
                {x.action &&
                  (x.action.href ? (
                    <Link href={x.action.href} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                      {x.action.label}
                    </Link>
                  ) : (
                    <Button size="sm" variant="outline" onClick={x.action.onClick}>
                      {x.action.label}
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        )}

        <section>
          <SectionTitle icon={<ShieldCheck />}>Account</SectionTitle>
          <Card className="p-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Fact label="Status">
                {STATUS_LABEL[a.status]}
                {a.status === 'SUSPENDED' && a.suspendedAt ? ` since ${fmtDate(a.suspendedAt)}` : a.status === 'ARCHIVED' && a.archivedAt ? ` since ${fmtDate(a.archivedAt)}` : a.status === 'DEACTIVATED' && a.deactivatedAt ? ` since ${fmtDate(a.deactivatedAt)}` : ''}
              </Fact>
              <Fact label="Last sign-in">{a.lastLoginAt ? <span title={fmtWhen(a.lastLoginAt)}>{timeAgo(a.lastLoginAt)}</span> : 'Never'}</Fact>
              <Fact label="Last active">{a.lastSeenAt ? <span title={fmtWhen(a.lastSeenAt)}>{timeAgo(a.lastSeenAt)}</span> : 'Never'}</Fact>
              <Fact label="Two-step verification">
                {a.mfaEnabled ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <BadgeCheck className="size-3.5" aria-hidden /> On
                  </span>
                ) : (
                  'Off'
                )}
              </Fact>
              <Fact label="Password">{!a.hasPassword ? 'Not set' : a.mustChangePassword ? 'Temporary' : 'Set'}</Fact>
              <Fact label="Account created">{fmtDate(a.createdAt)}</Fact>
            </dl>
          </Card>
        </section>

        <section>
          <SectionTitle
            icon={<Clock />}
            action={
              <button className="text-xs text-muted hover:text-foreground" onClick={() => go('attendance')}>
                See attendance
              </button>
            }
          >
            Attendance, last 30 days
          </SectionTitle>
          {att ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Days present', String(att.summary.daysPresent)],
                ['Late arrivals', String(att.summary.late)],
                ['Time worked', fmtDuration(att.summary.workedMinutes)],
                ['From home', String(att.summary.home)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border bg-surface px-4 py-3">
                  <p className="text-xs text-muted">{k}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">You don&apos;t have permission to see this person&apos;s attendance.</p>
          )}
        </section>

        <section>
          <SectionTitle
            icon={<CalendarDays />}
            action={
              <button className="text-xs text-muted hover:text-foreground" onClick={() => go('leave')}>
                See leave
              </button>
            }
          >
            Leave left this year
          </SectionTitle>
          <BalanceList balances={o.leave.balances.filter((b) => b.allowance > 0).slice(0, 4)} />
        </section>
      </div>

      <aside className="space-y-8">
        <section>
          <SectionTitle icon={<Users />}>Reporting line</SectionTitle>
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs text-muted">Reports to</p>
              {o.employee.manager ? <PersonLink p={o.employee.manager} /> : <p className="text-sm text-subtle">No manager</p>}
            </div>
            <div>
              <p className="mb-1 text-xs text-muted">Direct reports ({o.employee.reports.length})</p>
              {o.employee.reports.length ? (
                <div className="-mx-2">
                  {o.employee.reports.map((r) => (
                    <PersonLink key={r.id} p={r} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-subtle">Nobody reports to them</p>
              )}
            </div>
          </div>
        </section>
        <section>
          <SectionTitle
            icon={<Laptop />}
            action={
              <button className="text-xs text-muted hover:text-foreground" onClick={() => go('devices')}>
                Manage
              </button>
            }
          >
            Signed in on
          </SectionTitle>
          <p className="text-sm">{o.sessions.length ? `${o.sessions.length} device${o.sessions.length === 1 ? '' : 's'}` : 'Not signed in anywhere'}</p>
        </section>
        <section>
          <SectionTitle icon={<MessageSquare />}>Contact</SectionTitle>
          <dl className="space-y-3">
            <Fact label="Work email">{o.employee.email}</Fact>
            <Fact label="Work phone">{o.employee.phone}</Fact>
            <Fact label="Time zone">{o.employee.timezone ? timeZoneLabel(o.employee.timezone) : null}</Fact>
          </dl>
        </section>
      </aside>
    </div>
  );
}

function EmploymentTab({ o, go }: { o: Overview; go: (t: Tab) => void }) {
  const e = o.employee;
  return (
    <div className="space-y-8">
      <section>
        <SectionTitle icon={<Briefcase />}>Employment</SectionTitle>
        <Card className="p-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Designation">{e.designation}</Fact>
            <Fact label="Department">{e.department?.name}</Fact>
            <Fact label="Reports to">{e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : null}</Fact>
            <Fact label="Employee code">{e.employeeCode}</Fact>
            <Fact label="Date of joining">{fmtDate(e.joinedAt)}</Fact>
            <Fact label="Birthday">{e.birthday && e.birthday.length === 10 ? fmtDate(e.birthday, { day: 'numeric', month: 'long', year: 'numeric' }) : null}</Fact>
            <Fact label="Work phone">{e.phone}</Fact>
            <Fact label="Pronouns">{e.pronouns}</Fact>
            <Fact label="Time zone">{e.timezone ? timeZoneLabel(e.timezone) : null}</Fact>
          </dl>
        </Card>
      </section>

      <section>
        <SectionTitle
          icon={<ShieldCheck />}
          action={
            <button className="text-xs text-muted hover:text-foreground" onClick={() => go('access')}>
              Manage access
            </button>
          }
        >
          Role
        </SectionTitle>
        <Card className="flex flex-wrap items-center gap-2 p-5 text-sm">
          <Badge tone="brand">{o.access.role.name}</Badge>
          {o.access.extraRoles.map((r) => (
            <Badge key={r.id} tone={r.archived ? 'muted' : 'default'}>
              + {r.name}
              {r.archived ? ' (archived)' : ''}
            </Badge>
          ))}
          {o.access.overrides.length > 0 && (
            <span className="text-muted">
              · {o.access.overrides.length} exception{o.access.overrides.length === 1 ? '' : 's'}
            </span>
          )}
          {o.account.isSuperAdmin && (
            <Badge tone="brand">
              <ShieldCheck className="size-3" aria-hidden /> Super Admin{o.account.superAdminActive ? '' : ' (paused)'}
            </Badge>
          )}
        </Card>
      </section>
    </div>
  );
}

function AttendanceTab({ o }: { o: Overview }) {
  const clock = useClock();
  const att = o.attendance;
  if (!att) return <EmptyState icon={<Clock />} title="Attendance is hidden" description="You don't have permission to see this person's attendance." />;
  const tz = att.timezone;
  const s = att.summary;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {fmtRange(att.from, att.to)} · times shown for {timeZoneLabel(tz)}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {(
          [
            ['Days present', s.daysPresent],
            ['Time worked', fmtDuration(s.workedMinutes)],
            ['Late arrivals', s.late],
            ['Office', s.office],
            ['Home', s.home],
            ['Client site', s.clientSite],
            ['Closed automatically', s.autoCheckedOut],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <Card className="overflow-hidden">
        {att.items.length === 0 ? (
          <EmptyState icon={<Clock />} title="No attendance in the last 30 days" description="Days they check in will appear here." />
        ) : (
          <ul className="divide-y" aria-label="Attendance records">
            {att.items.map((r) => (
              <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[180px_1fr_auto]">
                <div>
                  <p className="text-sm font-medium">{fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                  <p className="text-xs text-muted">{LOCATION_LABEL[r.location]}</p>
                </div>
                <p className="col-span-2 row-start-2 text-[13px] text-muted sm:col-span-1 sm:row-start-auto">
                  {clock.time(r.checkInAt, tz)} to {r.checkOutAt ? clock.time(r.checkOutAt, tz) : r.state === 'on_break' ? 'on a break' : 'still working'}
                  {r.breakMinutes > 0 && ` · ${fmtDuration(r.breakMinutes)} break`}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {r.late && <Badge tone="warning">Late</Badge>}
                  {r.dayOff && <Badge>Day off</Badge>}
                  {r.autoCheckedIn && <Badge tone="muted">Auto check-in</Badge>}
                  {r.autoCheckOutReason && <Badge tone="muted">Auto check-out</Badge>}
                  <span className="text-sm font-medium tabular-nums">{fmtDuration(r.workedMinutes)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BalanceList({ balances }: { balances: LeaveBalance[] }) {
  if (!balances.length) return <p className="text-sm text-muted">No leave types with an allowance.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {balances.map((b) => {
        const pct = b.allowance > 0 ? Math.min(100, ((b.used + b.pending) / b.allowance) * 100) : 0;
        return (
          <li key={b.type.id} className="rounded-xl border bg-surface px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span className="size-2 shrink-0 rounded-full" style={{ background: b.type.color }} aria-hidden />
                <span className="truncate">{b.type.name}</span>
              </p>
              <p className="shrink-0 text-sm tabular-nums">{b.remaining === null ? 'No limit' : `${fmtDays(b.remaining)} left`}</p>
            </div>
            {b.allowance > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="mt-1.5 text-xs text-muted">
              {fmtDays(b.used)} used{b.pending ? ` · ${fmtDays(b.pending)} waiting` : ''}
              {b.allowance > 0 ? ` · ${fmtDays(b.allowance)} a year` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function LeaveTab({ o }: { o: Overview }) {
  const l = o.leave;
  return (
    <div className="space-y-8">
      <section>
        <SectionTitle icon={<CalendarDays />}>Balances · {fmtRange(l.year.start, l.year.end)}</SectionTitle>
        <BalanceList balances={l.balances} />
      </section>
      <section>
        <SectionTitle icon={<CalendarClock />} action={<Link href="/admin/leave" className="text-xs text-muted hover:text-foreground">Leave management</Link>}>
          Recent requests
        </SectionTitle>
        <Card className="overflow-hidden">
          {l.requests.length === 0 ? (
            <EmptyState icon={<CalendarDays />} title="No leave requests yet" />
          ) : (
            <ul className="divide-y" aria-label="Leave requests">
              {l.requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: r.type.color }} aria-hidden />
                      {r.type.name} · {fmtRange(r.startDate, r.endDate)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {fmtDays(r.days)}
                      {r.halfDay !== 'NONE' && ` (${HALF_LABEL[r.halfDay]})`}
                      {r.reason && ` · ${r.reason}`}
                    </p>
                    {r.approver && (
                      <p className="mt-0.5 text-xs text-muted">
                        {r.status === 'APPROVED' ? 'Approved' : r.status === 'REJECTED' ? 'Declined' : 'Handled'} by {r.approver.firstName} {r.approver.lastName}
                        {r.decisionNote && `: ${r.decisionNote}`}
                      </p>
                    )}
                  </div>
                  <Badge tone={LEAVE_TONE[r.status]}>{LEAVE_LABEL[r.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function DevicesTab({ o, self, onSignOut }: { o: Overview; self: boolean; onSignOut: () => void }) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Signed-in devices</p>
          <p className="text-[13px] text-muted">If a device looks wrong, sign them out everywhere and set a new password.</p>
        </div>
        {!self && (
          <Button variant="outline" onClick={onSignOut} disabled={!o.sessions.length}>
            <LogOut /> Sign out everywhere
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {o.sessions.length === 0 ? (
          <EmptyState icon={<Laptop />} title="Not signed in anywhere" description="Devices appear here when they sign in." />
        ) : (
          <ul className="divide-y" aria-label="Signed-in devices">
            {o.sessions.map((s) => {
              const d = describeDevice(s.userAgent);
              const Icon = d.mobile ? Smartphone : Laptop;
              return (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {d.label}
                      {s.current && <Badge tone="brand">This device</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      Active {timeAgo(s.lastSeenAt)} · signed in {fmtWhen(s.createdAt)}
                      {s.ip && <span className="font-mono"> · {s.ip}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

function ActivityTab({ o }: { o: Overview }) {
  if (!o.activity) return <EmptyState icon={<Activity />} title="Activity is hidden" description="You need permission to view audit logs to see this." />;
  return (
    <section>
      <p className="mb-4 text-[13px] text-muted">The last 50 things they did, and changes others made to their account.</p>
      <Card className="overflow-hidden">
        {o.activity.length === 0 ? (
          <EmptyState icon={<Activity />} title="No activity yet" />
        ) : (
          <AuditList items={o.activity} />
        )}
      </Card>
    </section>
  );
}

export default function EmployeeDetailPage() {
  return (
    <Suspense>
      <EmployeePage />
    </Suspense>
  );
}
