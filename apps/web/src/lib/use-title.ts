'use client';
import { useEffect } from 'react';

// The most recently mounted page title wins; earlier ones resume when it unmounts.
const stack: { id: number; title: string }[] = [];
let seq = 0;
let observer: MutationObserver | null = null;

function apply() {
  const top = stack[stack.length - 1];
  if (top && document.title !== top.title) document.title = top.title;
}

/**
 * Sets the browser tab title, e.g. "Attendance · FG One".
 * Next.js may rewrite <title> from route metadata after hydration, so the title is
 * re-applied whenever something else changes it.
 */
export function usePageTitle(title: string | undefined | null, unread = 0) {
  useEffect(() => {
    if (!title) return;
    const entry = { id: ++seq, title: `${unread > 0 ? `(${unread}) ` : ''}${title} · FG One` };
    stack.push(entry);
    apply();
    if (!observer) {
      observer = new MutationObserver(apply);
      observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    }
    return () => {
      const i = stack.findIndex((e) => e.id === entry.id);
      if (i >= 0) stack.splice(i, 1);
      apply();
    };
  }, [title, unread]);
}
