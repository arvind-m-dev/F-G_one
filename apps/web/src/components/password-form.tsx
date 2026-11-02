'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { passwordSchema } from '@fg/shared';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Field, Input } from './ui/input';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

const RULES = [
  { test: (s: string) => s.length >= 10, label: '10+ characters' },
  { test: (s: string) => /[a-z]/.test(s), label: 'Lowercase letter' },
  { test: (s: string) => /[A-Z]/.test(s), label: 'Uppercase letter' },
  { test: (s: string) => /\d/.test(s), label: 'Number' },
];

export function NewPasswordForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (password: string) => Promise<void> }) {
  const { register, handleSubmit, watch, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const pw = watch('password');
  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v.password))} className="space-y-4" noValidate>
      <Field label="New password" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" autoFocus {...register('password')} />
      </Field>
      <ul className="grid grid-cols-2 gap-1.5 text-xs" aria-label="Password requirements">
        {RULES.map((r) => {
          const ok = r.test(pw);
          return (
            <li key={r.label} className={cn('flex items-center gap-1.5 transition-colors', ok ? 'text-success' : 'text-muted')}>
              {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />} {r.label}
            </li>
          );
        })}
      </ul>
      <Field label="Confirm password" htmlFor="confirm" error={formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
      </Field>
      <Button type="submit" variant="gradient" size="lg" className="w-full" loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
