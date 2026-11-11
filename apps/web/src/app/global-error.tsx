'use client';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import './globals.css';

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole document,
 * so it brings its own <html> and <body> and uses no providers.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · FG One</title>
        <div className="grid min-h-dvh place-items-center bg-chrome p-6">
          <div className="max-w-sm rounded-2xl border bg-canvas p-8 text-center shadow-lg" role="alert">
            <TriangleAlert className="mx-auto mb-3 size-8 text-warning" aria-hidden />
            <h1 className="text-lg font-semibold">FG One couldn&apos;t load</h1>
            <p className="mt-1 text-sm text-muted">Your data is safe. Try again, and if it keeps happening let your administrator know.</p>
            {error.digest && <p className="mt-2 font-mono text-[11px] text-subtle">Reference: {error.digest}</p>}
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={reset} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground">
                <RotateCcw className="size-4" aria-hidden /> Try again
              </button>
              <a href="/login" className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-surface px-3 text-[13px] font-medium">
                Go to sign in
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
