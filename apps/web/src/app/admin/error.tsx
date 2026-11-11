'use client';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

/** Friendly fallback when an admin page crashes. The navigation around it keeps working. */
export default function AdminErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid h-full min-h-[60vh] place-items-center p-6">
      <div className="max-w-sm text-center" role="alert">
        <TriangleAlert className="mx-auto mb-3 size-8 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="mt-1 text-sm text-muted">Nothing was changed. Try again, and if it keeps happening share the reference below with whoever looks after FG One.</p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-subtle">Reference: {error.digest}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw /> Try again
          </Button>
          {/* /admin sends people who cannot see the overview to the first admin page they can open. */}
          <Link href="/admin" className={buttonVariants({ variant: 'outline' })}>
            Back to the admin portal
          </Link>
        </div>
      </div>
    </div>
  );
}
