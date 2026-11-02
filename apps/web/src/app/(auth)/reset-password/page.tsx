'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { NewPasswordForm } from '@/components/password-form';
import { api, errorMessage } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!token) {
    return (
      <p className="text-sm text-muted">
        This link is missing its token. <Link href="/forgot-password" className="font-medium text-primary">Request a new one</Link>.
      </p>
    );
  }
  return (
    <>
      <h2 className="font-display text-2xl font-bold">Choose a new password</h2>
      <p className="mt-1 mb-8 text-sm text-muted">You&apos;ll be signed out of other devices.</p>
      <NewPasswordForm
        submitLabel="Update password"
        onSubmit={async (password) => {
          setError(null);
          try {
            await api('/auth/reset-password', { body: { token, password } });
            toast.success('Password updated — please sign in.');
            router.replace('/login');
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      />
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
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
