'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, AtSign, KeyRound, PauseCircle, PlayCircle, UserCheck, UserX, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type UseFormRegister } from 'react-hook-form';
import { toast } from 'sonner';
import {
  changeEmployeeEmailSchema,
  setEmployeePasswordSchema,
  updateEmployeeSchema,
  type ChangeEmployeeEmailInput,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from '@fg/shared';
import { HandoverMessage, PasswordInput } from '@/components/admin/password-handover';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
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

function PeopleSelects({ register, excludeId, currentManager }: { register: UseFormRegister<PeopleFields>; excludeId?: string; currentManager?: Employee['manager'] }) {
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
          {/* Keep a current manager who is no longer pickable (for example suspended), so saving doesn't drop them. */}
          {currentManager && managers.data && !managers.data.items.some((m) => m.id === currentManager.id) && (
            <option value={currentManager.id}>
              {currentManager.firstName} {currentManager.lastName} (not active)
            </option>
          )}
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
            <PeopleSelects register={form.register as unknown as UseFormRegister<PeopleFields>} excludeId={employee.id} currentManager={employee.manager} />
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

export type StatusAction = 'suspend' | 'unsuspend' | 'deactivate' | 'activate' | 'archive' | 'restore';

/** Account status changes an admin can make from each status (shared by the list and the employee page). */
export function statusActions(status: Employee['status']): StatusAction[] {
  switch (status) {
    case 'ACTIVE':
    case 'INVITED':
      return ['suspend', 'deactivate'];
    case 'SUSPENDED':
      return ['unsuspend', 'deactivate'];
    case 'DEACTIVATED':
      return ['activate', 'archive'];
    case 'ARCHIVED':
      return ['restore'];
  }
}

/** Menu label, icon and whether it is destructive, for each status change. */
export const STATUS_ACTION_META: Record<StatusAction, { label: string; icon: LucideIcon; danger?: boolean }> = {
  suspend: { label: 'Suspend', icon: PauseCircle, danger: true },
  unsuspend: { label: 'Lift suspension', icon: PlayCircle },
  deactivate: { label: 'Deactivate', icon: UserX, danger: true },
  activate: { label: 'Reactivate', icon: UserCheck },
  archive: { label: 'Archive', icon: Archive, danger: true },
  restore: { label: 'Restore', icon: ArchiveRestore },
};

const STATUS_COPY: Record<StatusAction, { title: (n: string) => string; body: string; confirm: string; done: string }> = {
  suspend: {
    title: (n) => `Suspend ${n}?`,
    body: "They are signed out on every device right away and can't sign in until you lift the suspension. Nothing is deleted, and you can undo this at any time.",
    confirm: 'Suspend',
    done: 'Account suspended and signed out everywhere',
  },
  unsuspend: {
    title: (n) => `Lift the suspension for ${n}?`,
    body: 'They can sign in again with their current password. Accounts that never had a password stay waiting until you set one.',
    confirm: 'Lift suspension',
    done: 'Suspension lifted',
  },
  deactivate: {
    title: (n) => `Deactivate ${n}?`,
    body: 'They will be signed out on every device immediately and will not be able to sign in. Their messages and records are kept.',
    confirm: 'Deactivate',
    done: 'Account deactivated and signed out everywhere',
  },
  activate: {
    title: (n) => `Reactivate ${n}?`,
    body: 'They will be able to sign in again. Accounts that never had a password stay waiting until you set one.',
    confirm: 'Reactivate',
    done: 'Account reactivated',
  },
  archive: {
    title: (n) => `Archive ${n}?`,
    body: 'They disappear from the employee list, people pickers and everyday views. Their messages, attendance, leave and activity are kept, and you can restore them later.',
    confirm: 'Archive',
    done: 'Account archived',
  },
  restore: {
    title: (n) => `Restore ${n}?`,
    body: 'They come back as a deactivated account and show in the employee list again. Reactivate them when they should sign in.',
    confirm: 'Restore',
    done: 'Account restored as deactivated',
  },
};

/** Confirms a status change in plain language. Suspending can carry a short reason only admins see. */
export function AccountStatusDialog({ target, onOpenChange }: { target: { employee: Employee; action: StatusAction } | null; onOpenChange: (o: boolean) => void }) {
  const refresh = useRefreshEmployees();
  const reauth = useReauth();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (target) setReason('');
  }, [target]);
  const m = useMutation({
    mutationFn: (v: { id: string; action: StatusAction; reason: string }) =>
      reauth.run(() => api(`/employees/${v.id}/${v.action}`, { method: 'POST', body: v.action === 'suspend' ? { reason: v.reason.trim() || null } : undefined })),
    onSuccess: (_d, v) => {
      toast.success(STATUS_COPY[v.action].done);
      onOpenChange(false);
      refresh();
    },
    onError: (e) => {
      if (!isCancelled(e)) toast.error(errorMessage(e));
    },
  });
  const copy = target ? STATUS_COPY[target.action] : null;
  const danger = target ? STATUS_ACTION_META[target.action].danger : false;
  return (
    <>
      <Dialog open={!!target} onOpenChange={onOpenChange} title={target && copy ? copy.title(target.employee.name) : ''} className="max-w-md">
        {target && copy && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate({ id: target.employee.id, action: target.action, reason });
            }}
          >
            <p className="text-sm text-muted">{copy.body}</p>
            {target.action === 'suspend' && (
              <div className="mt-4">
                <Field label="Reason (optional)" htmlFor="suspend-reason" hint="Only administrators see this, on their page and in the activity log.">
                  <Textarea id="suspend-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Laptop reported lost" />
                </Field>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={m.isPending}>
                {copy.confirm}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      {reauth.dialog}
    </>
  );
}
