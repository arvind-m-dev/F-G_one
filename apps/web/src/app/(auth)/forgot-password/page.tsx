'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { emailSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { usePageTitle } from '@/lib/use-title';

/**
 * Where people choose their own passwords, they can ask for a reset link by email.
 * Where administrators set passwords (the default), an administrator sets a new one.
 * The reply is the same whether or not the email belongs to an account.
 */
export default function ForgotPasswordPage() {
  usePageTitle('Forgot your password');
  // Shares the sign-in layout's cached branding request.
  const policy = useQuery({ queryKey: ['branding'], queryFn: () => api<{ selfServicePassword?: boolean }>('/public/branding') });
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Enter a valid email');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { body: { email: parsed.data } });
      setSentTo(parsed.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Link href="/login" className="mb-6 inline-flex items-center gap-1 rounded text-[13px] text-muted hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Back to sign in
    </Link>
  );

  if (policy.isPending) {
    return (
      <>
        {back}
        <div className="space-y-3" role="status" aria-label="Loading">
          <Skeleton className="mx-auto size-14 rounded-2xl" />
          <Skeleton className="mx-auto h-6 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      </>
    );
  }

  if (sentTo) {
    return (
      <>
        {back}
        <div className="text-center" role="status">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-ink">
            <MailCheck className="size-6" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-sm text-muted">
            If <strong className="font-medium text-foreground">{sentTo}</strong> has an FG One account, a link to choose a new password is on its way. The link works for 30 minutes.
          </p>
          <p className="mt-3 text-xs text-muted">Nothing after a few minutes? Check your spam folder, or ask your HR team or administrator to set a new password for you.</p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => {
              setSentTo(null);
              setEmail('');
            }}
          >
            Use a different email
          </Button>
        </div>
      </>
    );
  }

  // Administrators set passwords here (or the policy could not be read): there is no email reset to offer.
  if (!policy.data?.selfServicePassword) {
    return (
      <>
        {back}
        <div className="text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-ink">
            <KeyRound className="size-6" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Forgot your password?</h1>
          <p className="mt-2 text-sm text-muted">
            Ask your HR team or administrator to set a new one for you. For your security, passwords can&apos;t be looked up or sent by email.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <form onSubmit={submit} noValidate>
        <h1 className="text-xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="mt-1 text-sm text-muted">Enter your work email and we&apos;ll send you a link to choose a new one.</p>
        <div className="mt-6 space-y-4">
          <Field label="Work email" htmlFor="forgot-email" error={error ?? undefined}>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-invalid={!!error}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Email me a reset link
          </Button>
        </div>
        <p className="mt-5 text-center text-xs text-muted">No access to your email? Ask your HR team or administrator to set a new password.</p>
      </form>
    </>
  );
}
