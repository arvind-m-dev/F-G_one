'use client';
import { CircleAlert } from 'lucide-react';
import { ChoosePassword } from '@/components/security/choose-password';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { RealtimeProvider } from '@/lib/realtime';
import { SessionProvider, useMeQuery } from '@/lib/session';

/** Loads the signed-in user once and provides session + realtime to a portal. */
export function PortalGate({ children }: { children: React.ReactNode }) {
  const me = useMeQuery();
  // A 401 already sends the browser to sign in; anything else (server down, network) needs a way out.
  if (!me.data && me.isError && (me.error as { status?: number }).status !== 401) {
    return (
      <div className="grid h-dvh place-items-center bg-chrome p-6">
        <div role="alert" className="max-w-sm rounded-2xl bg-canvas p-8 text-center shadow-canvas">
          <CircleAlert className="mx-auto mb-3 size-8 text-danger" />
          <p className="font-semibold">FG One can&apos;t be reached right now</p>
          <p className="mt-1 text-sm text-muted">{errorMessage(me.error)}. Check your connection and try again.</p>
          <Button className="mt-5" loading={me.isFetching} onClick={() => me.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!me.data) {
    return (
      <div className="flex h-dvh gap-2 p-2" aria-busy="true" aria-label="Loading workspace">
        <div className="hidden w-[232px] space-y-2 p-3 md:block">
          <Skeleton className="mb-6 h-8 w-36 bg-black/5 dark:bg-white/5" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full bg-black/5 dark:bg-white/5" />
          ))}
        </div>
        <div className="flex-1 rounded-xl bg-canvas p-8 shadow-canvas">
          <Skeleton className="mb-3 h-8 w-72" />
          <Skeleton className="mb-10 h-4 w-48" />
          <div className="grid gap-6 md:grid-cols-3">
            <Skeleton className="h-56 md:col-span-2" />
            <Skeleton className="h-56" />
          </div>
        </div>
      </div>
    );
  }
  if (me.data.mustChangePassword) return <ChoosePassword me={me.data} />;
  return (
    <SessionProvider me={me.data}>
      <RealtimeProvider me={me.data}>{children}</RealtimeProvider>
    </SessionProvider>
  );
}
