'use client';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Thin bar at the top of the window while the next page loads. Starts on internal link clicks, finishes when the URL changes. */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest('a');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setState('loading');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    setState((s) => (s === 'loading' ? 'done' : s));
  }, [pathname, search]);

  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(() => setState('idle'), 350);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <AnimatePresence>
      {state !== 'idle' && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
          role="progressbar"
          aria-label="Loading page"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          <motion.div
            className="h-full bg-primary shadow-[0_0_8px_var(--color-primary)]"
            initial={{ width: '0%' }}
            animate={state === 'loading' ? { width: '85%' } : { width: '100%' }}
            transition={state === 'loading' ? { duration: 6, ease: [0.1, 0.8, 0.2, 1] } : { duration: 0.2, ease: 'easeOut' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
