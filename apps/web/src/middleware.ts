import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/invite'];

/**
 * UX-level gate only: bounces visitors without a session cookie to /login.
 * Real authentication/authorization is enforced by the API on every request.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = req.cookies.has(process.env.SESSION_COOKIE_NAME ?? 'fg_session');
  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Keep the query too, so filters and tabs in a shared link survive signing in.
    url.search = pathname !== '/' ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : '';
    return NextResponse.redirect(url);
  }
  if (pathname === '/login' && hasSession) {
    // Let the login page decide (the cookie may be stale); no redirect loop.
    return NextResponse.next();
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|socket.io|_next|favicon.ico|opengraph-image|apple-icon|.*\\..*).*)'] };
