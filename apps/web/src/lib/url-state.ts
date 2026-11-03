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
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '' || v === defaults[k]) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, pathname, router],
  );
  return [get, set] as const;
}
