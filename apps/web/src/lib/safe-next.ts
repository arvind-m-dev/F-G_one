/**
 * Where to go after signing in (`?next=`). Only paths on this site: browsers read "/\evil.com"
 * (and tabs or newlines inside it) as another site, so the value is resolved and its origin compared.
 */
export function safeNext(next: string | null | undefined, origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin, fallback = '/app/home') {
  if (!next || !next.startsWith('/')) return fallback;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return fallback;
    const resolved = `${url.pathname}${url.search}${url.hash}`;
    // The origin check passes for same-origin inputs, but dot segments can resolve to a
    // protocol-relative path (e.g. "/.//evil.example" -> "//evil.example"), which the browser
    // then treats as another site. Only return a single-slash absolute path.
    if (!resolved.startsWith('/') || resolved.startsWith('//') || resolved.startsWith('/\\')) return fallback;
    return resolved;
  } catch {
    return fallback;
  }
}
