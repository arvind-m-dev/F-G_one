'use client';
import { useQuery } from '@tanstack/react-query';
import { PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewPasswordForm } from '@/components/password-form';
import { Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<{ email: string; firstName: string; organization: { name: string } }>(`/auth/invitations/${token}`),
    retry: false,
  });

  if (invite.isPending) return <Skeleton className="h-64 w-full" />;
  if (invite.isError) {
    return (
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Invitation unavailable</h2>
        <p className="mt-2 text-sm text-muted">{errorMessage(invite.error)}</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary">Go to sign in</Link>
      </div>
    );
  }
  const data = invite.data!;
  return (
    <>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
        <PartyPopper className="size-5" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">Welcome, {data.firstName}!</h2>
      <p className="mt-1 mb-8 text-sm text-muted">
        Set a password to join <strong className="text-foreground">{data.organization.name}</strong> on FG One as <strong className="text-foreground">{data.email}</strong>.
      </p>
      <NewPasswordForm
        submitLabel="Activate my account"
        onSubmit={async (password) => {
          setError(null);
          try {
            await api('/auth/accept-invitation', { body: { token, password } });
            router.replace('/app/home?welcome=1');
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      />
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    </>
  );
}
