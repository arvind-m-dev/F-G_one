'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Keeps a piece of UI state (filters, tabs, open panels) in the URL query string so it survives
 * a refresh, can be shared as a link, and works with the browser back button.
 */
export function useUrlState(defaults: Record<string, string>) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => params.get(k) ?? defaults[k] ?? '';
  const set = useCallback(
    (patch: Record<string, string | null | undefined>, opts: { push?: boolean } = {}) => {
      // Read the live URL, not the captured `params`/`pathname`: back-to-back `set` calls in the
      // same tick would otherwise each start from the same stale snapshot and clobber each
      // other's keys, and a `set` that races with `router.push(/somewhere-else)` could rewrite
      // the new route back to the old one.
      const livePath = typeof window === 'undefined' ? pathname : window.location.pathname;
      const liveSearch = typeof window === 'undefined' ? params.toString() : window.location.search.replace(/^\?/, '');
      const next = new URLSearchParams(liveSearch);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || v === defaults[k]) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const url = qs ? `${livePath}?${qs}` : livePath;
      if (opts.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, pathname, router],
  );
  return [get, set] as const;
}
