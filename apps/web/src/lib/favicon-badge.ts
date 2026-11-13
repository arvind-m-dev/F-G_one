'use client';
import { useEffect } from 'react';

// Same gradient as apps/web/src/app/icon.svg so the badged favicon reads as the same mark.
const GRADIENT = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient><linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
const MARK = `<rect width="64" height="64" rx="15" fill="url(#g)"/><rect width="64" height="64" rx="15" fill="url(#shine)"/><path d="M23 46V19h19M23 32.5h13" fill="none" stroke="#fff" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>`;
const BADGE_ID = 'fg-favicon-badge';

function badgedSvg(unread: number): string {
  const label = unread > 99 ? '99+' : String(unread);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${GRADIENT}</defs>${MARK}<circle cx="47" cy="17" r="15" fill="#ef4444" stroke="#fff" stroke-width="3"/><text x="47" y="22.5" text-anchor="middle" font-family="-apple-system, system-ui, Segoe UI, sans-serif" font-size="${label.length >= 3 ? 14 : 18}" font-weight="700" fill="#fff">${label}</text></svg>`;
}

/**
 * Renders the chat unread count on the browser-tab favicon.
 * Owns a single <link id="fg-favicon-badge">, appended last, so browsers that pick the
 * last-declared icon show the badged one when there's unread. The link is removed when the
 * count drops to zero and the page falls back to the real favicon. Next.js-managed
 * <link rel="icon"> elements are never touched — mutating them would thrash metadata
 * reconciliation and visibly stall client-side navigation.
 */
export function useFaviconBadge(unread: number) {
  useEffect(() => {
    const n = Math.max(0, Math.floor(unread));
    const head = document.head;
    const existing = document.getElementById(BADGE_ID) as HTMLLinkElement | null;
    if (n === 0) {
      if (existing) existing.remove();
      return;
    }
    const href = `data:image/svg+xml;utf8,${encodeURIComponent(badgedSvg(n))}`;
    if (existing) {
      if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
      return;
    }
    const link = document.createElement('link');
    link.id = BADGE_ID;
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = href;
    head.appendChild(link);
  }, [unread]);
}
