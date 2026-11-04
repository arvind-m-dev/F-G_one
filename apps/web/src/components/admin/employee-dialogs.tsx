'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AtSign, KeyRound, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { toast } from 'sonner';
import {
  changeEmployeeEmailSchema,
  createEmployeeSchema,
  setEmployeePasswordSchema,
  updateEmployeeSchema,
  type ChangeEmployeeEmailInput,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from '@fg/shared';
import { HandoverMessage, PasswordInput } from '@/components/admin/password-handover';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useDepartments, useEmployeeList, useRoles } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Employee } from '@/lib/types';

/** Refresh every view that shows employees (list, the employee page, admin overview). */
function useRefreshEmployees() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['employees'] });
    void qc.invalidateQueries({ queryKey: ['employee-overview'] });
    void qc.invalidateQueries({ queryKey: ['admin-overview'] });
  };
}

/** Whether people choose their own passwords; otherwise the admin-set password is final. */
function useSelfServicePassword() {
  return useSession().organization.settings.auth.selfServicePassword;
}

type PeopleFields = Pick<CreateEmployeeInput, 'roleId' | 'departmentId' | 'managerId'>;

function PeopleSelects({ register, excludeId }: { register: UseFormRegister<PeopleFields>; excludeId?: string }) {
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
          <option value="">No department</option>
          {depts.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reports to" htmlFor="managerId">
        <Select id="managerId" {...register('managerId', { setValueAs: (v) => v || null })}>
          <option value="">No manager</option>
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

/** Creates an account with a password the admin hands over. */
export function AddEmployeeDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (e: Employee) => void }) {
  const me = useSession();
  const refresh = useRefreshEmployees();
  const roles = useRoles();
  const selfService = useSelfServicePassword();
  const [result, setResult] = useState<{ employee: Employee; password: string } | null>(null);
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
  const reset = () => form.reset({ ...form.formState.defaultValues, roleId: defaultRole });

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setResult(null);
      reset();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Add an employee"
      description={`${selfService ? 'Set a temporary password to hand over; they choose their own at first sign-in.' : 'Set their password and hand it over. Only administrators can change it later.'} Allowed email domains: ${domains.join(', ')}`}
      className="max-w-2xl"
    >
      {result ? (
        <div className="space-y-4">
          <p className="text-sm">
            <b>{result.employee.firstName}</b>&apos;s account is ready.
          </p>
          <HandoverMessage firstName={result.employee.firstName} email={result.employee.email} password={result.password} organization={me.organization.name} selfService={selfService} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setResult(null);
                reset();
              }}
            >
              <UserPlus /> Add another
            </Button>
            {onCreated && (
              <Button variant="outline" onClick={() => { const e = result.employee; close(false); onCreated(e); }}>
                Open their page
              </Button>
            )}
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
              refresh();
              setResult({ employee: res.employee, password: v.password });
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
            <PeopleSelects register={form.register as unknown as UseFormRegister<PeopleFields>} />
            <Field label="Date of joining" htmlFor="joinedAt" error={err.joinedAt?.message}>
              <Input id="joinedAt" type="date" {...form.register('joinedAt', { setValueAs: (v) => v || null })} />
            </Field>
          </div>
          <Field
            label={selfService ? 'Temporary password' : 'Password'}
            htmlFor="password"
            error={err.password?.message}
            hint="10+ characters with upper, lower case and a number. You'll get a message to send them."
          >
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

/** Edit profile and employment details (not email or password: those have their own actions). */
export function EditEmployeeDialog({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (o: boolean) => void }) {
  const refresh = useRefreshEmployees();
  const form = useForm<UpdateEmployeeInput>({ resolver: zodResolver(updateEmployeeSchema) });
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
              await api(`/employees/${employee.id}`, {
                method: 'PATCH',
                body: { ...v, designation: v.designation || null, employeeCode: v.employeeCode || null, phone: v.phone || null, joinedAt: v.joinedAt || null, birthday: v.birthday || null },
              });
              refresh();
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
            <PeopleSelects register={form.register as unknown as UseFormRegister<PeopleFields>} excludeId={employee.id} />
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

/** Sets a new password and shows it once to hand over. Existing passwords are never shown. */
export function SetPasswordDialog({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const refresh = useRefreshEmployees();
  const reauth = useReauth();
  const selfService = useSelfServicePassword();
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
      <Dialog
        open={!!employee}
        onOpenChange={close}
        title={employee ? `Set a new password for ${employee.name}` : ''}
        description={
          selfService
            ? "They'll be signed out everywhere and asked to choose their own password when they next sign in."
            : "They'll be signed out everywhere and sign in again with the new password. You'll see it once to hand over."
        }
      >
        {employee &&
          (done ? (
            <div className="space-y-4">
              <HandoverMessage firstName={employee.firstName} email={employee.email} password={done} organization={me.organization.name} reset selfService={selfService} />
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
                  refresh();
                  setDone(v.password);
                  toast.success('Password set');
                } catch (e) {
                  if (!isCancelled(e)) toast.error(errorMessage(e));
                }
              })}
            >
              <Field label="New password" htmlFor="set-password" error={form.formState.errors.password?.message} hint="10+ characters with upper, lower case and a number">
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

/** Changes the work email they sign in with. They are signed out everywhere. */
export function ChangeEmailDialog({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const refresh = useRefreshEmployees();
  const reauth = useReauth();
  const domains = me.organization.settings.auth.allowedEmailDomains;
  const form = useForm<ChangeEmployeeEmailInput>({ resolver: zodResolver(changeEmployeeEmailSchema), defaultValues: { email: '' } });
  useEffect(() => {
    if (employee) form.reset({ email: employee.email });
  }, [employee, form]);
  return (
    <>
      <Dialog
        open={!!employee}
        onOpenChange={onOpenChange}
        title={employee ? `Change ${employee.firstName}'s email` : ''}
        description="This is the address they sign in with. They'll be signed out on every device and sign in again with the new email. Their password stays the same."
      >
        {employee && (
          <form
            noValidate
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              try {
                await reauth.run(() => api(`/employees/${employee.id}/email`, { body: v }));
                refresh();
                toast.success(`Email changed to ${v.email}. Let ${employee.firstName} know.`);
                onOpenChange(false);
              } catch (e) {
                if (!isCancelled(e)) toast.error(errorMessage(e));
              }
            })}
          >
            <Field label="New work email" htmlFor="change-email" error={form.formState.errors.email?.message} hint={`Must end with ${domains.map((d) => `@${d}`).join(' or ')}`}>
              <Input id="change-email" type="email" autoFocus autoComplete="off" {...form.register('email')} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={form.formState.isSubmitting}>
                <AtSign /> Change email
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      {reauth.dialog}
    </>
  );
}

/** Confirms deactivating (signs out everywhere, blocks sign-in) or reactivating an account. */
export function AccountStatusDialog({ target, onOpenChange }: { target: { employee: Employee; action: 'deactivate' | 'activate' } | null; onOpenChange: (o: boolean) => void }) {
  const refresh = useRefreshEmployees();
  const reauth = useReauth();
  const toggle = useMutation({
    mutationFn: (v: { id: string; action: 'deactivate' | 'activate' }) => reauth.run(() => api(`/employees/${v.id}/${v.action}`, { method: 'POST' })),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'deactivate' ? 'Account deactivated and signed out everywhere' : 'Account reactivated');
      onOpenChange(false);
      refresh();
    },
    onError: (e) => {
      if (!isCancelled(e)) toast.error(errorMessage(e));
    },
  });
  const deactivating = target?.action === 'deactivate';
  return (
    <>
      <ConfirmDialog
        open={!!target}
        onOpenChange={onOpenChange}
        title={target ? `${deactivating ? 'Deactivate' : 'Reactivate'} ${target.employee.name}?` : ''}
        description={
          deactivating
            ? 'They will be signed out on every device immediately and will not be able to sign in. Their messages and records are kept.'
            : 'They will be able to sign in again. Accounts that never had a password stay waiting until you set one.'
        }
        confirmLabel={deactivating ? 'Deactivate' : 'Reactivate'}
        danger={deactivating}
        loading={toggle.isPending}
        onConfirm={() => target && toggle.mutate({ id: target.employee.id, action: target.action })}
      />
      {reauth.dialog}
    </>
  );
}
