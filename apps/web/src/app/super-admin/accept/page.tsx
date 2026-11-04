'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, Crown, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { superAdminAcceptSchema } from '@fg/shared';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { usePageTitle } from '@/lib/use-title';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Person } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';

interface Nomination {
  invitedBy: Person | null;
  createdAt: string;
  expiresAt: string;
  mfaEnabled: boolean;
  limitReached: boolean;
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Heading({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <span className="mb-4 grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">{icon}</span>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children && <div className="mt-1.5 text-sm text-muted">{children}</div>}
    </div>
  );
}

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="alert">
      <span className="mb-4 grid size-11 place-items-center rounded-xl bg-danger/10 text-danger">
        <CircleAlert className="size-5" />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-1.5 text-sm text-muted">{children}</div>
      <Link href="/app/home">
        <Button variant="outline" className="mt-6">
          Go to your workspace
        </Button>
      </Link>
    </div>
  );
}

function AcceptInner() {
  const me = useSession();
  const qc = useQueryClient();
  const reauth = useReauth();
  const [get] = useUrlState({ token: '' });
  const token = get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  usePageTitle('Accept Super Admin nomination');

  const valid = superAdminAcceptSchema.shape.token.safeParse(token).success;
  const q = useQuery({
    queryKey: ['super-admin-nomination', token],
    queryFn: () => api<Nomination>('/super-admins/invitations/check', { body: { token } }),
    enabled: valid && !accepted,
    retry: false,
    // Coming back from turning on two-step verification in another tab refreshes the step.
    refetchOnWindowFocus: true,
  });

  const accept = useMutation({
    mutationFn: () => reauth.run(() => api('/super-admins/invitations/accept', { body: { token, password } })),
    onSuccess: async () => {
      setAccepted(true);
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => {
      if (isCancelled(e)) return;
      if (e instanceof ApiError && e.code === 'MFA_SETUP_REQUIRED') void q.refetch();
      setError(errorMessage(e));
    },
  });

  if (accepted) {
    return (
      <div role="status">
        <Heading icon={<Crown />} title="You are now a Super Admin">
          You have full control of FG One for {me.organization.name}. Every change you make as a Super Admin is recorded in the audit log.
        </Heading>
        <Link href="/admin/super-admins">
          <Button size="lg" className="w-full">
            Open the admin portal <ArrowRight />
          </Button>
        </Link>
      </div>
    );
  }

  if (!valid) {
    return (
      <Problem title="This link is incomplete">
        The nomination link is missing a part. Open it again from the message you were sent, or ask a Super Admin for a new one.
      </Problem>
    );
  }
  if (q.isPending) {
    return (
      <div aria-busy="true" aria-label="Checking your nomination" className="space-y-3">
        <Skeleton className="size-11" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (q.isError) {
    if (me.isSuperAdmin) {
      return (
        <Problem title="You are already a Super Admin">
          This link has already been used or is no longer needed.{' '}
          <Link href="/admin/super-admins" className="text-primary hover:underline">
            Go to Super Admins
          </Link>
          .
        </Problem>
      );
    }
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound ? (
      <Problem title="This nomination link is not valid">
        It may have expired, been withdrawn or already been used, or it was sent to someone else. You are signed in as <span className="font-medium text-foreground">{me.user.email}</span>. Ask a Super Admin for a new link if you still need one.
      </Problem>
    ) : (
      <Problem title="We could not check your nomination">
        {errorMessage(q.error)}.{' '}
        <button type="button" className="text-primary hover:underline" onClick={() => q.refetch()}>
          Try again
        </button>
      </Problem>
    );
  }

  const n = q.data;
  const by = n.invitedBy?.name ?? 'A Super Admin';
  const intro = (
    <Heading icon={<Crown />} title="You have been nominated as a Super Admin">
      <p>
        {by} nominated you for {me.organization.name}. The link works until {fmtWhen(n.expiresAt)}.
      </p>
    </Heading>
  );
  const explainer = (
    <div className="mb-5 rounded-xl bg-surface-2 p-4 text-[13px]">
      <p className="mb-1.5 font-medium">What it means</p>
      <ul className="list-disc space-y-1 pl-4 text-muted">
        <li>Full control of FG One: every admin page, every employee and every setting.</li>
        <li>You can change security settings and manage other administrators and Super Admins.</li>
        <li>Your account must always use two-step verification.</li>
      </ul>
    </div>
  );

  if (n.limitReached) {
    return (
      <Problem title="There is no free place for another Super Admin">
        {by} nominated you, but your company already has as many Super Admins as it allows. Ask a Super Admin to make room, then open this link again before {fmtWhen(n.expiresAt)}.
      </Problem>
    );
  }

  if (!n.mfaEnabled) {
    return (
      <div>
        {intro}
        {explainer}
        <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/8 p-4 text-[13px]">
          <ShieldOff className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">First, turn on two-step verification</p>
            <p className="mt-1 text-muted">
              Super Admins must use it, so a stolen password is never enough. It takes about a minute with an authenticator app on your phone. Then come back to this page to accept.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link href="/app/settings#security" className="flex-1">
            <Button className="w-full">
              <ShieldCheck /> Turn on two-step verification
            </Button>
          </Link>
          <Button variant="outline" onClick={() => q.refetch()} loading={q.isFetching}>
            <RefreshCw /> I have turned it on
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">Keep this link: you need it again after turning on two-step verification.</p>
      </div>
    );
  }

  return (
    <div>
      {reauth.dialog}
      {intro}
      {explainer}
      {n.invitedBy && (
        <p className="mb-5 flex items-center gap-2 text-xs text-muted">
          <UserAvatar person={n.invitedBy} size="xs" showPresence={false} /> Nominated by {n.invitedBy.name}
        </p>
      )}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!password) return setError('Enter your password to confirm');
          setError(null);
          accept.mutate();
        }}
      >
        <Field label="Your password" htmlFor="accept-password" hint={`Signed in as ${me.user.email}.`}>
          <Input id="accept-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/8 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={accept.isPending}>
          <Crown /> Accept and become a Super Admin
        </Button>
        <Link href="/app/home" className="block text-center text-[13px] text-muted hover:text-foreground">
          Not now
        </Link>
      </form>
    </div>
  );
}

export default function AcceptSuperAdminPage() {
  return (
    <Suspense>
      <AcceptInner />
    </Suspense>
  );
}
