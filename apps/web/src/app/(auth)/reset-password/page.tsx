'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { NewPasswordForm } from '@/components/password-form';
import { api, errorMessage } from '@/lib/api';
import { usePageTitle } from '@/lib/use-title';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  usePageTitle('Choose a new password');
  if (!token) {
    return (
      <div role="alert">
        <h1 className="text-xl font-semibold tracking-tight">This reset link is incomplete</h1>
        <p className="mt-2 text-sm text-muted">Open the link again from the email we sent you, or ask for a new one.</p>
        <Link href="/forgot-password" className="mt-6 inline-block rounded text-sm font-medium text-primary hover:underline">
          Get a new link
        </Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 mb-8 text-sm text-muted">You&apos;ll be signed out of other devices.</p>
      <NewPasswordForm
        submitLabel="Update password"
        onSubmit={async (password) => {
          setError(null);
          try {
            await api('/auth/reset-password', { body: { token, password } });
            toast.success('Password updated. Sign in with your new password.');
            router.replace('/login');
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      />
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/8 px-3 py-2 text-[13px] text-danger">
          {error}{' '}
          <Link href="/forgot-password" className="font-medium underline underline-offset-2">
            Get a new link
          </Link>
        </p>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
