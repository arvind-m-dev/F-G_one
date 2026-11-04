'use client';
import { AlertTriangle, AtSign, ChevronRight, KeyRound, MoreHorizontal, Pencil, RotateCw, Search, ShieldCheck, UserCheck, UserPlus, UserRound, UserX, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { AccountStatusDialog, AddEmployeeDialog, ChangeEmailDialog, EditEmployeeDialog, SetPasswordDialog } from '@/components/admin/employee-dialogs';
import { STATUS_LABEL, STATUS_TONE } from '@/components/admin/employee-status';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { useDepartments, useEmployeeList } from '@/lib/hooks';
import { useCan, useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, timeAgo } from '@/lib/utils';

function EmployeesAdmin() {
  const can = useCan();
  const me = useSession();
  const router = useRouter();
  // `add=1` opens the add dialog (older links use `invite=1`).
  const [get, set] = useUrlState({ q: '', status: 'ALL', dept: '', page: '1', add: '', invite: '' });
  const [q, setQ] = useState(get('q'));
  const debounced = get('q');
  const status = get('status');
  const dept = get('dept');
  const page = Number(get('page')) || 1;
  const setStatus = (v: string) => set({ status: v, page: null });
  const setDept = (v: string) => set({ dept: v, page: null });
  const setPage = (v: number | ((p: number) => number)) => set({ page: String(typeof v === 'function' ? v(page) : v) });
  const addOpen = get('add') === '1' || get('invite') === '1';
  const setAddOpen = (o: boolean) => set({ add: o ? '1' : null, invite: null });
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirm, setConfirm] = useState<{ employee: Employee; action: 'deactivate' | 'activate' } | null>(null);
  const [settingPassword, setSettingPassword] = useState<Employee | null>(null);
  const [changingEmail, setChangingEmail] = useState<Employee | null>(null);
  useEffect(() => {
    if (q === debounced) return;
    const t = setTimeout(() => set({ q, page: null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const depts = useDepartments();
  const list = useEmployeeList({ q: debounced || undefined, status, departmentId: dept || undefined, page, pageSize: 20 });

  if (!can(PERMISSIONS.EMPLOYEES_MANAGE)) return <Forbidden />;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        title="Employees"
        description="Add, update and manage access for everyone at your company."
        actions={
          <Button variant="gradient" onClick={() => setAddOpen(true)}>
            <UserPlus /> Add employee
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b p-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, designation" className="pl-9" aria-label="Search employees" />
          </div>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="md:w-48" aria-label="Department">
            <option value="">All departments</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div className="scrollbar-thin flex overflow-x-auto rounded-lg bg-surface-2 p-0.5 text-sm">
            {(['ALL', 'ACTIVE', 'INVITED', 'DEACTIVATED'] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={cn('shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition', status === s ? 'bg-surface shadow-sm' : 'text-muted hover:text-foreground')}>
                {s === 'ALL' ? 'All' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        {list.isError && (
          <EmptyState
            icon={<AlertTriangle />}
            title="Couldn't load employees"
            description="Check your connection and try again."
            action={
              <Button variant="outline" onClick={() => void list.refetch()}>
                <RotateCw /> Try again
              </Button>
            }
          />
        )}
        <ul className="divide-y md:hidden">
          {list.isPending &&
            Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="px-4 py-3">
                <Skeleton className="h-10" />
              </li>
            ))}
          {list.data?.items.map((e) => (
            <li key={e.id}>
              <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2/40">
                <UserAvatar person={e} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-muted">{[e.designation, e.department?.name].filter(Boolean).join(' · ') || e.email}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                    <Badge>{e.role.name}</Badge>
                    {e.isSuperAdmin && <Badge tone="brand">Super Admin</Badge>}
                  </span>
                </span>
                <ChevronRight className="size-4 text-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface-2/50 text-left text-xs font-semibold tracking-wide text-muted uppercase">
              <tr>
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Department</th>
                <th className="px-4 py-2.5">Manager</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Last sign-in</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.isPending &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-3">
                      <Skeleton className="h-8" />
                    </td>
                  </tr>
                ))}
              {list.data?.items.map((e) => (
                <tr key={e.id} className="transition hover:bg-surface-2/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/employees/${e.id}`} className="group flex items-center gap-3 rounded-md text-left">
                      <UserAvatar person={e} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-medium group-hover:underline">{e.name}</span>
                        <span className="block text-xs text-muted">{e.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <Badge tone={e.role.key === 'administrator' ? 'brand' : 'default'}>{e.role.name}</Badge>
                      {e.isSuperAdmin && (
                        <Badge tone="brand">
                          <ShieldCheck className="size-3" aria-hidden /> Super Admin
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {e.department ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: e.department.color }} />
                        {e.department.name}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {e.designation && <span className="block text-xs text-muted">{e.designation}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—'}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{e.lastLoginAt ? timeAgo(e.lastLoginAt) : 'Never'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <DropdownMenu>
                      <DropdownTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent>
                        <DropdownItem onSelect={() => router.push(`/admin/employees/${e.id}`)}>
                          <UserRound /> Open employee page
                        </DropdownItem>
                        <DropdownItem onSelect={() => setEditing(e)}>
                          <Pencil /> Edit details
                        </DropdownItem>
                        {e.id !== me.user.id && (
                          <DropdownItem onSelect={() => setChangingEmail(e)}>
                            <AtSign /> Change email
                          </DropdownItem>
                        )}
                        {e.id !== me.user.id && e.status !== 'DEACTIVATED' && e.status !== 'ARCHIVED' && (
                          <DropdownItem onSelect={() => setSettingPassword(e)}>
                            <KeyRound /> Set a new password
                          </DropdownItem>
                        )}
                        {e.id !== me.user.id && (
                          <>
                            <DropdownSeparator />
                            {e.status === 'DEACTIVATED' ? (
                              <DropdownItem onSelect={() => setConfirm({ employee: e, action: 'activate' })}>
                                <UserCheck /> Reactivate
                              </DropdownItem>
                            ) : (
                              <DropdownItem danger onSelect={() => setConfirm({ employee: e, action: 'deactivate' })}>
                                <UserX /> Deactivate
                              </DropdownItem>
                            )}
                          </>
                        )}
                      </DropdownContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data?.items.length === 0 && <EmptyState icon={<Users />} title="No employees match" description="Adjust the filters or add someone new." />}
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted">
          <span>{list.data ? `${list.data.total} total` : ''}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      <AddEmployeeDialog open={addOpen} onOpenChange={setAddOpen} onCreated={(e) => router.push(`/admin/employees/${e.id}`)} />
      <EditEmployeeDialog employee={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <AccountStatusDialog target={confirm} onOpenChange={(o) => !o && setConfirm(null)} />
      <SetPasswordDialog employee={settingPassword} onOpenChange={(o) => !o && setSettingPassword(null)} />
      <ChangeEmailDialog employee={changingEmail} onOpenChange={(o) => !o && setChangingEmail(null)} />
    </div>
  );
}

export default function EmployeesAdminPage() {
  return (
    <Suspense>
      <EmployeesAdmin />
    </Suspense>
  );
}
