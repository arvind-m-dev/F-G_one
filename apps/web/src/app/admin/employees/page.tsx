'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Pencil, Search, ShieldCheck, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createEmployeeSchema, PERMISSIONS, setEmployeePasswordSchema, updateEmployeeSchema, type CreateEmployeeInput, type UpdateEmployeeInput } from '@fg/shared';
import { HandoverMessage, PasswordInput } from '@/components/admin/password-handover';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useDepartments, useEmployeeList, useRoles } from '@/lib/hooks';
import { useCan, useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, timeAgo } from '@/lib/utils';

const statusTone = { ACTIVE: 'success', INVITED: 'warning', SUSPENDED: 'danger', DEACTIVATED: 'muted', ARCHIVED: 'muted' } as const;

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
  const [result, setResult] = useState<{ firstName: string; email: string; password: string } | null>(null);
  const defaultRole = roles.data?.roles.find((r) => r.key === 'employee')?.id ?? '';
  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: { email: '', firstName: '', lastName: '', roleId: defaultRole, departmentId: null, managerId: null, designation: '', employeeCode: '', joinedAt: null, password: '' },
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
    <Dialog open={open} onOpenChange={close} title="Add an employee" description={`Set a temporary password to hand over; they choose their own at first sign-in. Allowed domains: ${domains.join(', ')}`} className="max-w-2xl">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm">
            <b>{result.firstName}</b>&apos;s account is ready.
          </p>
          <HandoverMessage firstName={result.firstName} email={result.email} password={result.password} organization={me.organization.name} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setResult(null); form.reset({ ...form.formState.defaultValues, roleId: defaultRole }); }}>
              <UserPlus /> Add another
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
              const res = await api<{ employee: Employee }>('/employees', {
                body: { ...v, designation: v.designation || null, employeeCode: v.employeeCode || null, joinedAt: v.joinedAt || null },
              });
              void qc.invalidateQueries({ queryKey: ['employees'] });
              void qc.invalidateQueries({ queryKey: ['admin-overview'] });
              setResult({ firstName: res.employee.firstName, email: res.employee.email, password: v.password });
              toast.success(`Account created for ${res.employee.email}`);
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
          <Field label="Temporary password" htmlFor="password" error={err.password?.message} hint="10+ characters with upper, lower case and a number. You'll get a message to send them.">
            <PasswordInput id="password" {...form.register('password')} onGenerate={(pw) => form.setValue('password', pw, { shouldValidate: true })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              <UserPlus /> Create account
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
              const { email: _e, password: _p, ...rest } = v as CreateEmployeeInput & UpdateEmployeeInput;
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

function SetPasswordDialog({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const qc = useQueryClient();
  const reauth = useReauth();
  const [done, setDone] = useState<string | null>(null);
  const form = useForm<{ password: string }>({ resolver: zodResolver(setEmployeePasswordSchema), defaultValues: { password: '' } });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setDone(null);
      form.reset({ password: '' });
    }
  };
  return (
    <>
      <Dialog open={!!employee} onOpenChange={close} title={employee ? `Set a password for ${employee.name}` : ''} description="They'll be signed out everywhere and asked to choose their own password when they next sign in.">
        {employee &&
          (done ? (
            <div className="space-y-4">
              <HandoverMessage firstName={employee.firstName} email={employee.email} password={done} organization={me.organization.name} reset />
              <div className="flex justify-end">
                <Button onClick={() => close(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <form
              noValidate
              className="space-y-4"
              onSubmit={form.handleSubmit(async (v) => {
                try {
                  await reauth.run(() => api(`/employees/${employee.id}/password`, { body: v }));
                  void qc.invalidateQueries({ queryKey: ['employees'] });
                  setDone(v.password);
                  toast.success('Password set');
                } catch (e) {
                  if (!isCancelled(e)) toast.error(errorMessage(e));
                }
              })}
            >
              <Field label="New temporary password" htmlFor="set-password" error={form.formState.errors.password?.message} hint="10+ characters with upper, lower case and a number">
                <PasswordInput id="set-password" autoFocus {...form.register('password')} onGenerate={(pw) => form.setValue('password', pw, { shouldValidate: true })} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={form.formState.isSubmitting}>
                  <KeyRound /> Set password
                </Button>
              </div>
            </form>
          ))}
      </Dialog>
      {reauth.dialog}
    </>
  );
}

function EmployeesAdmin() {
  const can = useCan();
  const me = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [get, set] = useUrlState({ q: '', status: 'ALL', dept: '', page: '1' });
  const [q, setQ] = useState(get('q'));
  const debounced = get('q');
  const status = get('status');
  const dept = get('dept');
  const page = Number(get('page')) || 1;
  const setStatus = (v: string) => set({ status: v, page: null });
  const setDept = (v: string) => set({ dept: v, page: null });
  const setPage = (v: number | ((p: number) => number)) => set({ page: String(typeof v === 'function' ? v(page) : v) });
  const [inviteOpen, setInviteOpen] = useState(params.get('invite') === '1');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirm, setConfirm] = useState<{ e: Employee; action: 'deactivate' | 'activate' } | null>(null);
  const [settingPassword, setSettingPassword] = useState<Employee | null>(null);
  useEffect(() => {
    if (q === debounced) return;
    const t = setTimeout(() => set({ q, page: null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  if (!can(PERMISSIONS.EMPLOYEES_MANAGE)) return <Forbidden />;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        title="Employees"
        description="Add, update and manage access for everyone at your company."
        actions={
          <Button variant="gradient" onClick={() => setInviteOpen(true)}>
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
          <Select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} className="md:w-48" aria-label="Department">
            <option value="">All departments</option>
            {depts.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div className="scrollbar-thin flex overflow-x-auto rounded-lg bg-surface-2 p-0.5 text-sm">
            {['ALL', 'ACTIVE', 'INVITED', 'DEACTIVATED'].map((s) => (
              <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={cn('rounded-md px-3 py-1.5 text-xs font-medium capitalize transition', status === s ? 'bg-surface shadow-sm' : 'text-muted hover:text-foreground')}>
                {s.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
        <ul className="divide-y md:hidden">
          {list.data?.items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              <UserAvatar person={e} size="md" />
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(e)}>
                <span className="block truncate text-sm font-medium">{e.name}</span>
                <span className="block truncate text-xs text-muted">{[e.designation, e.department?.name].filter(Boolean).join(' · ') || e.email}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={statusTone[e.status]}>{e.status.toLowerCase()}</Badge>
                  <Badge>{e.role.name}</Badge>
                </span>
              </button>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e)}>
                <Pencil />
              </Button>
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
                    <button className="flex items-center gap-3 text-left" onClick={() => router.push(`/app/people/${e.id}`)}>
                      <UserAvatar person={e} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-medium">{e.name}</span>
                        <span className="block text-xs text-muted">{e.email}</span>
                      </span>
                    </button>
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
                        {e.id !== me.user.id && e.status !== 'DEACTIVATED' && e.status !== 'ARCHIVED' && (
                          <DropdownItem onSelect={() => setSettingPassword(e)}>
                            <KeyRound /> Set password
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
          {list.data?.items.length === 0 && <EmptyState icon={<Users />} title="No employees match" description="Adjust the filters or add someone new." />}
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
            : 'They will be able to sign in again. Accounts that never had a password stay invited until you set one.'
        }
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        danger={confirm?.action === 'deactivate'}
        loading={toggle.isPending}
        onConfirm={() => confirm && toggle.mutate({ id: confirm.e.id, action: confirm.action })}
      />
      <SetPasswordDialog employee={settingPassword} onOpenChange={(o) => !o && setSettingPassword(null)} />
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
