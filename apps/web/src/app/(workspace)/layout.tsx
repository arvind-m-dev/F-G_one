'use client';
import { AppShell } from '@/components/layout/shell';
import { Skeleton } from '@/components/ui/misc';
import { RealtimeProvider } from '@/lib/realtime';
import { SessionProvider, useMeQuery } from '@/lib/session';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const me = useMeQuery();
  if (!me.data) {
    return (
      <div className="flex h-dvh" aria-busy="true" aria-label="Loading workspace">
        <div className="hidden w-64 border-r bg-sidebar p-4 md:block">
          <Skeleton className="mb-6 h-10 w-40" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="mb-6 h-10 w-full max-w-xl" />
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <SessionProvider me={me.data}>
      <RealtimeProvider me={me.data}>
        <AppShell>{children}</AppShell>
      </RealtimeProvider>
    </SessionProvider>
  );
}
