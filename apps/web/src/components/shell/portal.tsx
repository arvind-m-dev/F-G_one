'use client';
import { Skeleton } from '@/components/ui/misc';
import { RealtimeProvider } from '@/lib/realtime';
import { SessionProvider, useMeQuery } from '@/lib/session';

/** Loads the signed-in user once and provides session + realtime to a portal. */
export function PortalGate({ children }: { children: React.ReactNode }) {
  const me = useMeQuery();
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
  return (
    <SessionProvider me={me.data}>
      <RealtimeProvider me={me.data}>{children}</RealtimeProvider>
    </SessionProvider>
  );
}
