'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, MailPlus, MoreHorizontal, Pencil, RefreshCw, Search, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createEmployeeSchema, PERMISSIONS, updateEmployeeSchema, type CreateEmployeeInput, type UpdateEmployeeInput } from '@fg/shared';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton, Switch } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useDepartments, useEmployeeList, useRoles } from '@/lib/hooks';
import { useCan, useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

const statusTone = { ACTIVE: 'success', INVITED: 'warning', DEACTIVATED: 'muted' } as const;

function InviteLinkBox({ url, expiresAt }: { url: string; expiresAt: string }) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4">
      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Invitation ready</p>
      <p className="mt-1 text-xs text-muted">If email delivery is configured it has been sent. You can also share this single-use link directly — it expires {new Date(expiresAt).toLocaleDateString()}.</p>
      <div className="mt-3 flex gap-2">
        <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Invitation link" />
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            toast.success('Invite link copied');
          }}
        >
          <Copy /> Copy
        </Button>
      </div>
    </div>
  );
}

function PeopleSelects({ register, excludeId }: { register: ReturnType<typeof useForm<CreateEmployeeInput>>['register']; excludeId?: string }) {
  const depts = useDepartments();
  const roles = useRoles();
  const managers = useEmployeeList({ pageSize: 100 });
  return (
    <>
      <Field label="Role" htmlFor="roleId">
        <Select id="roleId" {...register('roleId')}>
          {roles.data?.roles.map((r) => (
            <option key={r.id} value={r.id} disabled={!r.assignable}>
              {r.name}
              {!r.assignable ? ' (not assignable)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Department" htmlFor="departmentId">
        <Select id="departmentId" {...register('departmentId', { setValueAs: (v) => v || null })}>
          <option value="">— None —</option>
          {depts.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reports to" htmlFor="managerId">
        <Select id="managerId" {...register('managerId', { setValueAs: (v) => v || null })}>
          <option value="">— No manager —</option>
          {managers.data?.items
            .filter((m) => m.id !== excludeId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.designation ? `· ${m.designation}` : ''}
              </option>
            ))}
        </Select>
      </Field>
    </>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const qc = useQueryClient();
  const roles = useRoles();
  const [result, setResult] = useState<{ url: string; expiresAt: string; name: string } | null>(null);
  const defaultRole = roles.data?.roles.find((r) => r.key === 'employee')?.id ?? '';
  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: { email: '', firstName: '', lastName: '', roleId: defaultRole, departmentId: null, managerId: null, designation: '', employeeCode: '', joinedAt: null, sendInvite: true },
  });
  useEffect(() => {
    if (defaultRole && !form.getValues('roleId')) form.setValue('roleId', defaultRole);
  }, [defaultRole, form]);
  const err = form.formState.errors;
  const domains = me.organization.settings.auth.allowedEmailDomains;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setResult(null);
      form.reset({ ...form.formState.defaultValues, roleId: defaultRole });
    }
  };

  return (
    <Dialog open={open} onOpenChange={close} title="Invite an employee" description={`They'll set their own password. Allowed domains: ${domains.join(', ')}`} className="max-w-2xl">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm">
            <b>{result.name}</b> has been added with status <Badge tone="warning">invited</Badge>
          </p>
          <InviteLinkBox url={result.url} expiresAt={result.expiresAt} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setResult(null); form.reset({ ...form.formState.defaultValues, roleId: defaultRole }); }}>
              <UserPlus /> Invite another
            </Button>
            <Button onClick={() => close(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              const res = await api<{ employee: Employee; inviteUrl: string; inviteExpiresAt: string }>('/employees', {
                body: { ...v, designation: v.designation || null, employeeCode: v.employeeCode || null, joinedAt: v.joinedAt || null },
              });
              void qc.invalidateQueries({ queryKey: ['employees'] });
              void qc.invalidateQueries({ queryKey: ['admin-overview'] });
              setResult({ url: res.inviteUrl, expiresAt: res.inviteExpiresAt, name: res.employee.name });
              toast.success(`Invitation created for ${res.employee.email}`);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName" error={err.firstName?.message}>
              <Input id="firstName" autoFocus {...form.register('firstName')} />
            </Field>
            <Field label="Last name" htmlFor="lastName" error={err.lastName?.message}>
              <Input id="lastName" {...form.register('lastName')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Work email" htmlFor="email" error={err.email?.message}>
                <Input id="email" type="email" placeholder={`name@${domains[0]}`} {...form.register('email')} />
              </Field>
            </div>
            <Field label="Designation" htmlFor="designation">
              <Input id="designation" placeholder="e.g. Software Engineer" {...form.register('designation')} />
            </Field>
            <Field label="Employee code" htmlFor="employeeCode">
              <Input id="employeeCode" placeholder="e.g. FG1042" {...form.register('employeeCode')} />
            </Field>
            <PeopleSelects register={form.register} />
            <Field label="Date of joining" htmlFor="joinedAt" error={err.joinedAt?.message}>
              <Input id="joinedAt" type="date" {...form.register('joinedAt', { setValueAs: (v) => v || null })} />
            </Field>
          </div>
          <label className="flex items-center gap-3 rounded-xl bg-surface-2/60 p-3 text-sm">
            <Switch checked={form.watch('sendInvite')} onCheckedChange={(v) => form.setValue('sendInvite', v)} />
            Email the invitation now (the link is shown to you either way)
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              <MailPlus /> Create invitation
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EditDrawer({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<UpdateEmployeeInput & CreateEmployeeInput>({ resolver: zodResolver(updateEmployeeSchema) as never });
  useEffect(() => {
    if (employee)
      form.reset({
        firstName: employee.firstName,
        lastName: employee.lastName,
        roleId: employee.role.id,
        departmentId: employee.department?.id ?? null,
        managerId: employee.manager?.id ?? null,
        designation: employee.designation ?? '',
        employeeCode: employee.employeeCode ?? '',
        phone: employee.phone ?? '',
        joinedAt: employee.joinedAt,
        birthday: employee.birthday && employee.birthday.length === 10 ? employee.birthday : null,
      });
  }, [employee, form]);
  const err = form.formState.errors;
  return (
    <Dialog open={!!employee} onOpenChange={onOpenChange} side="right" title={employee ? `Edit ${employee.name}` : ''} description={employee?.email}>
      {employee && (
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              const { email: _e, sendInvite: _s, ...rest } = v as CreateEmployeeInput & UpdateEmployeeInput;
              await api(`/employees/${employee.id}`, {
                method: 'PATCH',
                body: { ...rest, designation: rest.designation || null, employeeCode: rest.employeeCode || null, phone: rest.phone || null, joinedAt: rest.joinedAt || null, birthday: rest.birthday || null },
              });
              void qc.invalidateQueries({ queryKey: ['employees'] });
              toast.success('Employee updated');
              onOpenChange(false);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="e-first" error={err.firstName?.message}>
              <Input id="e-first" {...form.register('firstName')} />
            </Field>
            <Field label="Last name" htmlFor="e-last" error={err.lastName?.message}>
              <Input id="e-last" {...form.register('lastName')} />
            </Field>
            <Field label="Designation" htmlFor="e-designation">
              <Input id="e-designation" {...form.register('designation')} />
            </Field>
            <Field label="Employee code" htmlFor="e-code">
              <Input id="e-code" {...form.register('employeeCode')} />
            </Field>
            <PeopleSelects register={form.register as never} excludeId={employee.id} />
            <Field label="Work phone" htmlFor="e-phone">
              <Input id="e-phone" {...form.register('phone')} />
            </Field>
            <Field label="Date of joining" htmlFor="e-joined">
              <Input id="e-joined" type="date" {...form.register('joinedAt', { setValueAs: (v) => v || null })} />
            </Field>
            <Field label="Birthday" htmlFor="e-bday">
              <Input id="e-bday" type="date" {...form.register('birthday', { setValueAs: (v) => v || null })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save changes
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EmployeesAdmin() {
  const can = useCan();
  const me = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('ALL');
  const [dept, setDept] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(params.get('invite') === '1');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirm, setConfirm] = useState<{ e: Employee; action: 'deactivate' | 'activate' } | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const depts = useDepartments();
  const list = useEmployeeList({ q: debounced || undefined, status, departmentId: dept || undefined, page, pageSize: 20 });

  const toggle = useMutation({
    mutationFn: (v: { id: string; action: 'deactivate' | 'activate' }) => api(`/employees/${v.id}/${v.action}`, { method: 'POST' }),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'deactivate' ? 'Account deactivated and signed out everywhere' : 'Account reactivated');
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resend = useMutation({
    mutationFn: (id: string) => api<{ url: string; expiresAt: string }>(`/employees/${id}/invite`, { method: 'POST' }),
    onSuccess: (r) => {
      setLink(r);
      toast.success('New invitation issued; previous links no longer work');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!can(PERMISSIONS.EMPLOYEES_MANAGE)) return <Forbidden />;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Employees"
        description="Invite, update and manage access for everyone at your company."
        actions={
          <Button variant="gradient" onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite employee
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, designation" className="pl-9" aria-label="Search employees" />
          </div>
          <Select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} className="md:w-48" aria-label="Department">
            <option value="">All departments</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-sm">
            {['ALL', 'ACTIVE', 'INVITED', 'DEACTIVATED'].map((s) => (
              <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={cn('rounded-md px-3 py-1.5 text-xs font-medium capitalize transition', status === s ? 'bg-surface shadow-sm' : 'text-muted hover:text-foreground')}>
                {s.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
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
              {list.isLoading &&
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
                    <button className="flex items-center gap-3 text-left" onClick={() => router.push(`/people/${e.id}`)}>
                      <UserAvatar person={e} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-medium">{e.name}</span>
                        <span className="block text-xs text-muted">{e.email}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={e.role.key === 'super_admin' ? 'brand' : 'default'}>{e.role.name}</Badge>
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
                    <Badge tone={statusTone[e.status]}>{e.status.toLowerCase()}</Badge>
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
                        <DropdownItem onSelect={() => setEditing(e)}>
                          <Pencil /> Edit details
                        </DropdownItem>
                        {e.status === 'INVITED' && (
                          <DropdownItem onSelect={() => resend.mutate(e.id)}>
                            <RefreshCw /> Re-issue invitation
                          </DropdownItem>
                        )}
                        {e.id !== me.user.id && (
                          <>
                            <DropdownSeparator />
                            {e.status === 'DEACTIVATED' ? (
                              <DropdownItem onSelect={() => setConfirm({ e, action: 'activate' })}>
                                <UserCheck /> Reactivate
                              </DropdownItem>
                            ) : (
                              <DropdownItem danger onSelect={() => setConfirm({ e, action: 'deactivate' })}>
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
          {list.data?.items.length === 0 && <EmptyState icon={<Users />} title="No employees match" description="Adjust the filters or invite someone new." />}
        </div>
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

      <InviteDialog
        open={inviteOpen}
        onOpenChange={(o) => {
          setInviteOpen(o);
          if (!o && params.get('invite')) router.replace('/admin/employees');
        }}
      />
      <EditDrawer employee={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === 'deactivate' ? `Deactivate ${confirm?.e.name}?` : `Reactivate ${confirm?.e.name}?`}
        description={
          confirm?.action === 'deactivate'
            ? 'They will be signed out on every device immediately and will not be able to sign in. Their messages and records are kept.'
            : 'They will be able to sign in again. Accounts that never set a password return to the invited state.'
        }
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        danger={confirm?.action === 'deactivate'}
        loading={toggle.isPending}
        onConfirm={() => confirm && toggle.mutate({ id: confirm.e.id, action: confirm.action })}
      />
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)} title="New invitation link">
        {link && <InviteLinkBox url={link.url} expiresAt={link.expiresAt} />}
      </Dialog>
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
