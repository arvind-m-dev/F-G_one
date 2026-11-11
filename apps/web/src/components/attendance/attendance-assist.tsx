'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LOCATION_LABEL } from '@/components/attendance/attendance-panel';
import { api } from '@/lib/api';
import { useAttendanceToday } from '@/lib/hooks';
import { useClock, useModule, useSession } from '@/lib/session';
import type { AttendanceToday } from '@/lib/types';
import { useNow } from '@/lib/use-now';

const DISMISS_KEY = 'fg-checkin-reminder-dismissed';

/**
 * Employee-portal helper driven by the company's attendance settings:
 * automatic check-in on opening FG One, a reminder when you haven't checked in, and the activity heartbeat for idle check-out.
 */
export function AttendanceAssist() {
  const me = useSession();
  const mod = useModule();
  const qc = useQueryClient();
  const pathname = usePathname();
  const enabled = mod('attendance');
  const policy = me.organization.settings.attendance;
  const today = useAttendanceToday(enabled);
  const now = useNow();
  const { hm } = useClock();
  const day = now?.toDateString();
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Automatic check-in: once per tab per day, including a tab left open overnight.
  useEffect(() => {
    if (!enabled || !day || policy.checkInMode !== 'auto') return;
    const key = `fg-auto-checkin:${me.user.id}:${day}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage unavailable: the server still refuses a second check-in */
    }
    api<{ checkedIn: boolean; today: AttendanceToday }>('/attendance/auto-check-in', { method: 'POST', body: {} })
      .then((res) => {
        qc.setQueryData(['attendance-today'], res.today);
        if (res.checkedIn && res.today.record) toast.success('You were checked in automatically', { description: `Location: ${LOCATION_LABEL[res.today.record.location]}.` });
      })
      .catch(() => undefined);
  }, [enabled, day, policy.checkInMode, me.user.id, qc]);

  // Activity heartbeat while working, only when the idle check-out rule is on.
  const idleRule = policy.autoCheckOut.idleMinutes > 0;
  const working = today.data?.record?.state === 'working';
  useEffect(() => {
    if (!enabled || !idleRule || !working) return;
    let lastInput = Date.now();
    let lastSent = 0;
    const mark = () => (lastInput = Date.now());
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const beat = () => {
      const t = Date.now();
      if (document.visibilityState !== 'visible' || t - lastInput > 120_000 || t - lastSent < 60_000) return;
      lastSent = t;
      void api('/attendance/activity', { method: 'POST', body: {} }).catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [enabled, idleRule, working]);

  const d = today.data;
  const remind = enabled && policy.checkInMode !== 'manual' && d && (!d.record || (d.record.state === 'checked_out' && d.record.date !== d.date)) && d.isWorkingDay && !d.onLeave && dismissed !== d.date && !pathname.startsWith('/app/attendance');
  if (!remind) return null;

  const dismiss = () => {
    setDismissed(d.date);
    try {
      localStorage.setItem(DISMISS_KEY, d.date);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div role="status" className="mx-3 mt-2 flex items-center gap-3 rounded-xl border bg-canvas px-3.5 py-2.5 text-[13px] shadow-sm md:mx-0 md:mt-0 md:mb-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
        <Clock className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">You haven&apos;t checked in today.</span> <span className="text-muted">Working hours {hm(d.policy.workdayStart)} – {hm(d.policy.workdayEnd)}.</span>
      </span>
      <Link href="/app/attendance" className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:opacity-90">
        Check in
      </Link>
      <button onClick={dismiss} className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-foreground" aria-label="Hide for today">
        <X className="size-4" />
      </button>
    </div>
  );
}
