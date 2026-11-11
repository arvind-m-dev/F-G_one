'use client';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { PortalGate } from '@/components/shell/portal';
import { ADMIN_PERMS, WorkspaceShell } from '@/components/shell/workspace-shell';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/session';

function AdminOnly({ children }: { children: React.ReactNode }) {
  const can = useCan();
  // UX gate only — every admin API enforces permissions server-side.
  if (!ADMIN_PERMS.some((p) => can(p))) {
    return (
      <div className="grid h-dvh place-items-center bg-chrome p-6">
        <div className="max-w-sm rounded-2xl bg-canvas p-8 text-center shadow-canvas">
          <ShieldAlert className="mx-auto mb-3 size-8 text-subtle" />
          <p className="font-semibold">The admin portal isn&apos;t available to your role</p>
          <p className="mt-1 text-sm text-muted">Ask an administrator if you need access.</p>
          <Link href="/app/home" className={cn(buttonVariants(), 'mt-5')}>
            Back to workspace
          </Link>
        </div>
      </div>
    );
  }
  return <WorkspaceShell portal="admin">{children}</WorkspaceShell>;
}

/** Admin portal (/admin). */
export default function AdminPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalGate>
      <AdminOnly>{children}</AdminOnly>
    </PortalGate>
  );
}
