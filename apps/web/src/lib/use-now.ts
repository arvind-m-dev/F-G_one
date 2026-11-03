'use client';
import { useEffect, useState } from 'react';

/**
 * The current time, updated on every minute boundary and immediately when the tab is shown again
 * (background tabs throttle timers, so a tab left open overnight would otherwise show yesterday's greeting).
 * `null` until mounted so server and client renders match.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 60_000 - (d.getTime() % 60_000) + 50);
    };
    const onVisible = () => document.visibilityState === 'visible' && tick();
    tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return now;
}
