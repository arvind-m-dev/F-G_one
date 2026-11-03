'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/types';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password different from the temporary one' });

/** Shown instead of the workspace after signing in with a password an admin set. */
export function ChoosePassword({ me }: { me: Me }) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const err = form.formState.errors;
  return (
    <main className="grid min-h-dvh place-items-center bg-chrome px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border bg-surface p-6 shadow-lg sm:p-8">
        <div className="mb-5 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
          <KeyRound className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Choose your own password</h1>
        <p className="mt-1.5 text-sm text-muted">
          Hi {me.user.firstName}, you signed in with a temporary password from your administrator. Set a password only you know to continue to {me.organization.name}.
        </p>
        <form
          noValidate
          className="mt-6 space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await api('/auth/change-password', { body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
              toast.success('Password saved. Welcome!');
              await qc.invalidateQueries({ queryKey: ['me'] });
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <Field label="Temporary password" htmlFor="cp-current" error={err.currentPassword?.message}>
            <Input id="cp-current" type="password" autoComplete="current-password" autoFocus {...form.register('currentPassword')} />
          </Field>
          <Field label="New password" htmlFor="cp-new" error={err.newPassword?.message} hint="10+ characters with upper, lower case and a number">
            <Input id="cp-new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </Field>
          <Field label="Confirm new password" htmlFor="cp-confirm" error={err.confirm?.message}>
            <Input id="cp-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" variant="gradient" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Save and continue
          </Button>
        </form>
        <button
          type="button"
          className="mx-auto mt-4 flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
            window.location.href = '/login';
          }}
        >
          <LogOut className="size-3.5" /> Sign out
        </button>
      </div>
    </main>
  );
}
