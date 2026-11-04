'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, KeyRound, ShieldCheck, UserPlus, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createAccountSchema, PERMISSION_CATALOG, SCOPE_LABELS, type CreateAccountInput, type Scope } from '@fg/shared';
import { AccessEditor } from '@/components/admin/access-editor';
import { accessPreview, accessProblem, actorFromMe } from '@/components/admin/access-model';
import { HandoverMessage, PasswordInput } from '@/components/admin/password-handover';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useDepartments, useEmployeeList, useRoles } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { AccessValue, Employee, Role } from '@/lib/types';
import { cn } from '@/lib/utils';

const STEPS = [
  { key: 'person', label: 'Person', icon: UserRound },
  { key: 'access', label: 'Access', icon: ShieldCheck },
  { key: 'password', label: 'Password', icon: KeyRound },
  { key: 'review', label: 'Review', icon: Check },
] as const;
const PERSON_FIELDS = ['firstName', 'lastName', 'email', 'designation', 'departmentId', 'managerId', 'employeeCode', 'joinedAt'] as const;

const EMPTY: CreateAccountInput = {
  email: '',
  firstName: '',
  lastName: '',
  roleId: '',
  departmentId: null,
  managerId: null,
  designation: '',
  employeeCode: '',
  joinedAt: null,
  password: '',
  extraRoleIds: [],
  overrides: [],
};

/**
 * Account creation wizard: 1) the person 2) what they can do 3) their password 4) review and create.
 * Each step is validated with the shared `createAccountSchema`; going back keeps everything entered.
 * The account, its roles and exceptions are created in one request (and one transaction on the API).
 */
export function AccountWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (e: Employee) => void }) {
  const me = useSession();
  const qc = useQueryClient();
  const reauth = useReauth();
  const roles = useRoles();
  const depts = useDepartments();
  const managers = useEmployeeList({ pageSize: 100 }, open);
  const selfService = me.organization.settings.auth.selfServicePassword;
  const domains = me.organization.settings.auth.allowedEmailDomains;
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{ employee: Employee; password: string } | null>(null);
  const form = useForm<CreateAccountInput>({ resolver: zodResolver(createAccountSchema), defaultValues: EMPTY, mode: 'onTouched' });
  const err = form.formState.errors;
  const v = form.watch();

  // Default main role: Employee (or the first role the admin may give).
  const roleList = roles.data?.roles ?? [];
  const defaultRole = roleList.find((r) => r.key === 'employee' && r.assignable)?.id ?? roleList.find((r) => r.assignable && !r.archivedAt)?.id ?? '';
  useEffect(() => {
    if (defaultRole && !form.getValues('roleId')) form.setValue('roleId', defaultRole);
  }, [defaultRole, form]);

  const access: AccessValue = { roleId: v.roleId, extraRoleIds: v.extraRoleIds ?? [], overrides: (v.overrides ?? []).map((o) => ({ permission: o.permission, effect: o.effect, scope: o.scope ?? null })) };
  const problem = roleList.length ? accessProblem(actorFromMe(me), roleList, null, access) : null;

  const reset = () => {
    form.reset({ ...EMPTY, roleId: defaultRole });
    setStep(0);
    setResult(null);
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  const next = async () => {
    if (step === 0 && !(await form.trigger([...PERSON_FIELDS]))) return;
    if (step === 1 && (!(await form.trigger(['roleId', 'extraRoleIds', 'overrides'])) || problem)) return;
    if (step === 2 && !(await form.trigger(['password']))) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = form.handleSubmit(
    async (values) => {
      try {
        const body = { ...values, designation: values.designation || null, employeeCode: values.employeeCode || null, joinedAt: values.joinedAt || null };
        const res = await reauth.run(() => api<{ employee: Employee }>('/employees', { body }));
        for (const k of ['employees', 'employee-overview', 'admin-overview']) void qc.invalidateQueries({ queryKey: [k] });
        setResult({ employee: res.employee, password: values.password });
        toast.success(`Account created for ${res.employee.email}`);
      } catch (e) {
        if (!isCancelled(e)) toast.error(errorMessage(e));
      }
    },
    // A field from an earlier step is invalid (for example after editing): go back to it.
    (errors) => {
      if (PERSON_FIELDS.some((f) => errors[f])) setStep(0);
      else if (errors.roleId || errors.extraRoleIds || errors.overrides) setStep(1);
      else if (errors.password) setStep(2);
    },
  );

  const role = roleList.find((r) => r.id === v.roleId);
  const dept = depts.data?.find((d) => d.id === v.departmentId);
  const manager = managers.data?.items.find((m) => m.id === v.managerId);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={close}
        title="Add an employee"
        description={result ? undefined : 'Create their account in four short steps. Nothing is saved until you press Create account.'}
        className="max-w-4xl"
      >
        {result ? (
          <div className="space-y-4">
            <p className="text-sm">
              <b>{result.employee.firstName}</b>&apos;s account is ready. They can sign in now.
            </p>
            <HandoverMessage firstName={result.employee.firstName} email={result.employee.email} password={result.password} organization={me.organization.name} selfService={selfService} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                <UserPlus /> Add another
              </Button>
              {onCreated && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const e = result.employee;
                    close(false);
                    onCreated(e);
                  }}
                >
                  Open their page
                </Button>
              )}
              <Button onClick={() => close(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (step < STEPS.length - 1) void next();
              else void submit();
            }}
          >
            <ol className="mb-6 grid grid-cols-4 gap-1.5" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s.key}>
                  <button
                    type="button"
                    disabled={i > step}
                    onClick={() => setStep(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cn(
                      'flex w-full flex-col items-start gap-1 rounded-lg border-t-2 pt-2 text-left text-xs transition disabled:cursor-default',
                      i < step ? 'border-primary text-foreground' : i === step ? 'border-primary font-semibold text-foreground' : 'border-border text-subtle',
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">
                      <s.icon aria-hidden />
                      <span className="hidden sm:inline">
                        {i + 1}. {s.label}
                      </span>
                      <span className="sm:hidden">{i + 1}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <h3 className="mb-4 text-sm font-semibold sm:hidden">{STEPS[step]!.label}</h3>

            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" htmlFor="w-first" error={err.firstName?.message}>
                  <Input id="w-first" autoFocus {...form.register('firstName')} />
                </Field>
                <Field label="Last name" htmlFor="w-last" error={err.lastName?.message}>
                  <Input id="w-last" {...form.register('lastName')} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Work email" htmlFor="w-email" error={err.email?.message} hint={`This is what they sign in with. Must end with ${domains.map((d) => `@${d}`).join(' or ')}.`}>
                    <Input id="w-email" type="email" autoComplete="off" placeholder={`name@${domains[0]}`} {...form.register('email')} />
                  </Field>
                </div>
                <Field label="Designation" htmlFor="w-designation" error={err.designation?.message}>
                  <Input id="w-designation" placeholder="e.g. Software Engineer" {...form.register('designation')} />
                </Field>
                <Field label="Department" htmlFor="w-dept">
                  <Select id="w-dept" {...form.register('departmentId', { setValueAs: (x) => x || null })}>
                    <option value="">No department</option>
                    {depts.data?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reports to" htmlFor="w-manager">
                  <Select id="w-manager" {...form.register('managerId', { setValueAs: (x) => x || null })}>
                    <option value="">No manager</option>
                    {managers.data?.items.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.designation ? `· ${m.designation}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Employee code" htmlFor="w-code" error={err.employeeCode?.message}>
                  <Input id="w-code" placeholder="e.g. FG1042" {...form.register('employeeCode')} />
                </Field>
                <Field label="Date of joining" htmlFor="w-joined" error={err.joinedAt?.message}>
                  <Input id="w-joined" type="date" {...form.register('joinedAt', { setValueAs: (x) => x || null })} />
                </Field>
              </div>
            )}

            {step === 1 &&
              (roles.isPending ? (
                <Skeleton className="h-64" />
              ) : roles.isError ? (
                <p className="text-sm text-danger">Couldn&apos;t load roles. Close this and try again.</p>
              ) : (
                <AccessEditor
                  roles={roleList}
                  value={access}
                  onChange={(a) => {
                    form.setValue('roleId', a.roleId, { shouldDirty: true });
                    form.setValue('extraRoleIds', a.extraRoleIds, { shouldDirty: true });
                    form.setValue(
                      'overrides',
                      a.overrides.map((o) => ({ permission: o.permission, effect: o.effect, scope: (o.scope as Scope | null) ?? null })),
                      { shouldDirty: true },
                    );
                  }}
                />
              ))}

            {step === 2 && (
              <div className="max-w-lg space-y-3">
                <Field
                  label={selfService ? 'Temporary password' : 'Password'}
                  htmlFor="w-password"
                  error={err.password?.message}
                  hint="10+ characters with upper and lower case letters and a number. You'll get a message with it to send them."
                >
                  <PasswordInput id="w-password" autoFocus {...form.register('password')} onGenerate={(pw) => form.setValue('password', pw, { shouldValidate: true })} />
                </Field>
                <p className="text-xs text-muted">
                  {selfService
                    ? 'They will be asked to choose their own password the first time they sign in.'
                    : 'This is their password. Only administrators can change it later (Set a new password on their page).'}
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-6 md:grid-cols-2">
                <dl className="space-y-3 text-sm">
                  <Review label="Name">{`${v.firstName} ${v.lastName}`}</Review>
                  <Review label="Work email">{v.email}</Review>
                  <Review label="Designation">{v.designation}</Review>
                  <Review label="Department">{dept?.name}</Review>
                  <Review label="Reports to">{manager?.name}</Review>
                  <Review label="Employee code">{v.employeeCode}</Review>
                  <Review label="Date of joining">{v.joinedAt}</Review>
                  <Review label={selfService ? 'Temporary password' : 'Password'}>Set (shown once after you create the account)</Review>
                </dl>
                <ReviewAccess access={access} roles={roleList} roleName={role?.name} />
              </div>
            )}

            {problem && step >= 1 && (
              <p role="alert" className="mt-4 text-xs text-danger">
                {problem}
              </p>
            )}
            <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
              <Button type="button" variant="ghost" onClick={() => (step === 0 ? close(false) : setStep((s) => s - 1))}>
                {step === 0 ? (
                  'Cancel'
                ) : (
                  <>
                    <ArrowLeft /> Back
                  </>
                )}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button type="submit" disabled={step === 1 && (!!problem || roles.isPending)}>
                  Next <ArrowRight />
                </Button>
              ) : (
                <Button type="submit" variant="gradient" loading={form.formState.isSubmitting}>
                  <UserPlus /> Create account
                </Button>
              )}
            </div>
          </form>
        )}
      </Dialog>
      {reauth.dialog}
    </>
  );
}

function ReviewAccess({ access, roles, roleName }: { access: AccessValue; roles: Role[]; roleName?: string }) {
  const p = accessPreview(roles, access);
  const extras = access.extraRoleIds.map((id) => roles.find((r) => r.id === id)?.name).filter(Boolean);
  return (
    <div className="space-y-3 text-sm">
      <Review label="Main role">{roleName}</Review>
      <Review label="Extra roles">{extras.length ? extras.join(', ') : 'None'}</Review>
      <div>
        <dt className="text-xs text-muted">Exceptions</dt>
        <dd className="mt-1">
          {access.overrides.length ? (
            <ul className="space-y-1">
              {access.overrides.map((o) => (
                <li key={o.permission} className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={o.effect === 'DENY' ? 'danger' : 'success'}>{o.effect === 'DENY' ? 'Blocked' : 'Allowed'}</Badge>
                  {PERMISSION_CATALOG.find((c) => c.key === o.permission)?.label ?? o.permission}
                  {o.effect === 'ALLOW' && o.scope && <span className="text-xs text-muted">· {SCOPE_LABELS[o.scope as Scope]}</span>}
                </li>
              ))}
            </ul>
          ) : (
            'None'
          )}
        </dd>
      </div>
      <p className="text-xs text-muted">
        In total they will have {p.count} permission{p.count === 1 ? '' : 's'} beyond their own account.
      </p>
    </div>
  );
}

function Review({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children || <span className="text-subtle">Not set</span>}</dd>
    </div>
  );
}
