'use client';
import { ArrowLeft, Compass } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="bg-dots grid min-h-dvh place-items-center bg-chrome p-6">
      <div className="max-w-sm rounded-2xl border bg-canvas p-8 text-center shadow-lg">
        <Compass className="mx-auto mb-3 size-8 text-subtle" aria-hidden />
        <h1 className="text-lg font-semibold">We couldn&apos;t find that page</h1>
        <p className="mt-1 text-sm text-muted">The link may be old, or the page was moved. Let&apos;s get you back on track.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/app/home" className={buttonVariants()}>
            Go to Home
          </Link>
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft /> Go back
          </Button>
        </div>
      </div>
    </div>
  );
}
