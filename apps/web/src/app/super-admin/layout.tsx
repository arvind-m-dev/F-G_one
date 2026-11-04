'use client';
import { BrandMark } from '@/components/brand-mark';
import { PortalGate } from '@/components/shell/portal';
import { useSession } from '@/lib/session';

function Frame({ children }: { children: React.ReactNode }) {
  const me = useSession();
  return (
    <div className="relative flex min-h-dvh flex-col bg-chrome">
      <header className="flex items-center gap-2.5 px-6 py-5">
        <BrandMark name={me.organization.name} logoUrl={me.organization.logoUrl} size={28} />
        <span className="text-sm font-semibold">FG One</span>
        <span className="truncate text-sm text-subtle">/ {me.organization.name}</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[480px] rounded-2xl border bg-canvas p-6 shadow-lg sm:p-8">{children}</div>
      </main>
    </div>
  );
}

/** Signed-in pages outside the two portals (accepting a Super Admin nomination). */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalGate>
      <Frame>{children}</Frame>
    </PortalGate>
  );
}
