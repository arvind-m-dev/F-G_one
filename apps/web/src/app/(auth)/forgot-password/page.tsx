'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { forgotPasswordSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: useSearchParams().get('email') ?? '' } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/forgot-password', { body: values });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <>
      <Link href="/login" className="mb-6 inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      {sent ? (
        <div className="text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
            <MailCheck className="size-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Check your inbox</h2>
          <p className="mt-2 text-sm text-muted">If an account exists for that email, we&apos;ve sent a reset link. It expires in 30 minutes.</p>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-semibold tracking-tight">Reset your password</h2>
          <p className="mt-1 text-sm text-muted">Enter your work email and we&apos;ll send you a reset link.</p>
          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
            <Field label="Work email" htmlFor="email" error={formState.errors.email?.message}>
              <Input id="email" type="email" autoFocus placeholder="you@futuristglobal.com" {...register('email')} />
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" variant="gradient" size="lg" className="w-full" loading={formState.isSubmitting}>
              Send reset link
            </Button>
          </form>
        </>
      )}
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPassword />
    </Suspense>
  );
}
