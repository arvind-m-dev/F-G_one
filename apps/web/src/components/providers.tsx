'use client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { MotionConfig } from 'motion/react';
import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
import { ApiError } from '@/lib/api';

/** Bump to invalidate every cached payload after a breaking API change. */
const CACHE_BUSTER = 'fg-2026-11-03';
/** Query keys that are safe to restore after a reload (no search results, no secrets). */
const PERSISTED = new Set(['me', 'dashboard', 'channels', 'channel', 'messages', 'departments', 'roles', 'attendance-today', 'announcements', 'notifications']);

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 24 * 3600_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && count < 2,
      },
    },
  });
}

/**
 * The query cache is persisted to sessionStorage (this tab only) so a page refresh shows the
 * last data instantly while fresh data loads in the background. It's cleared on sign-out.
 */
const persister =
  typeof window !== 'undefined'
    ? createSyncStoragePersister({
        storage: (() => {
          try {
            return window.sessionStorage;
          } catch {
            return undefined;
          }
        })(),
        key: 'fg.cache',
        throttleTime: 1000,
      })
    : undefined;

export function clearPersistedCache() {
  try {
    window.sessionStorage.removeItem('fg.cache');
  } catch {
    /* ignore */
  }
}

/** Toasts follow the light/dark theme and, on phones, sit at the top so they never cover the tab bar or the chat composer. */
function AppToaster() {
  const { resolvedTheme } = useTheme();
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return <Toaster richColors closeButton theme={resolvedTheme === 'dark' ? 'dark' : 'light'} position={phone ? 'top-center' : 'bottom-right'} toastOptions={{ className: 'font-sans' }} />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <PersistQueryClientProvider
        client={client}
        // Show restored data instantly, then refresh everything in the background.
        onSuccess={() => void client.invalidateQueries()}
        persistOptions={{
          persister: persister!,
          buster: CACHE_BUSTER,
          maxAge: 12 * 3600_000,
          dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && PERSISTED.has(String(q.queryKey[0])) },
        }}
      >
        {/* Honour the device's "reduce motion" setting for JS-driven animation too (CSS handles the rest). */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            {children}
            <AppToaster />
          </TooltipProvider>
        </MotionConfig>
      </PersistQueryClientProvider>
    </ThemeProvider>
  );
}
