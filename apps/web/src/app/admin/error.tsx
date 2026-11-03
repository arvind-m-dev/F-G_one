'use client';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';

/** Friendly fallback when a page crashes. The rest of the app keeps working. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid h-full min-h-[60vh] place-items-center p-6">
      <div className="max-w-sm text-center">
        <TriangleAlert className="mx-auto mb-3 size-8 text-amber-500" />
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="mt-1 text-sm text-muted">Your data is safe. Try again, and if it keeps happening let your administrator know.</p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-subtle">Reference: {error.digest}</p>}
        <button onClick={reset} className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white">
          <RotateCcw className="size-4" /> Try again
        </button>
      </div>
    </div>
  );
}
