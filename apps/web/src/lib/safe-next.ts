/**
 * Where to go after signing in (`?next=`). Only paths on this site: browsers read "/\evil.com"
 * (and tabs or newlines inside it) as another site, so the value is resolved and its origin compared.
 */
export function safeNext(next: string | null | undefined, origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin, fallback = '/app/home') {
  if (!next || !next.startsWith('/')) return fallback;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
