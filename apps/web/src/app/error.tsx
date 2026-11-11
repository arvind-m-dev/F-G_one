'use client';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

/** Friendly fallback when a page crashes. The rest of the app keeps working. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid h-full min-h-[60vh] place-items-center p-6">
      <div className="max-w-sm text-center" role="alert">
        <TriangleAlert className="mx-auto mb-3 size-8 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="mt-1 text-sm text-muted">Your data is safe. Try again, and if it keeps happening let your administrator know.</p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-subtle">Reference: {error.digest}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw /> Try again
          </Button>
          <Link href="/app/home" className={buttonVariants({ variant: 'outline' })}>
            Go to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
