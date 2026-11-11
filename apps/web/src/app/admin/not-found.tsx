'use client';
import { Compass } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useAdminHome } from '@/lib/admin-nav';

/** Shown inside the admin navigation when an admin address does not exist. */
export default function AdminNotFound() {
  const home = useAdminHome();
  return (
    <div className="grid h-full min-h-[60vh] place-items-center p-6">
      <div className="max-w-sm text-center">
        <Compass className="mx-auto mb-3 size-8 text-subtle" aria-hidden />
        <h1 className="text-lg font-semibold">We couldn&apos;t find that admin page</h1>
        <p className="mt-1 text-sm text-muted">The link may be old, or the page was moved. Pick a page from the menu, or start again from the admin portal.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {home && (
            <Link href={home} className={buttonVariants()}>
              Back to the admin portal
            </Link>
          )}
          <Link href="/app/home" className={buttonVariants({ variant: 'outline' })}>
            Go to your workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
