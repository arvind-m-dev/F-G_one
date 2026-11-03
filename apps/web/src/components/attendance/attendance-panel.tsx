'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Coffee, House, LogIn, LogOut, MapPin, Play } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { WORK_LOCATIONS } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InfoHint, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { fmtDuration, useAttendanceToday } from '@/lib/hooks';
import { useClock } from '@/lib/session';
import type { AttendanceRecord, AttendanceToday } from '@/lib/types';
import { cn } from '@/lib/utils';

export const LOCATION_ICON = { WFO: Building2, WFH: House, ON_DUTY: MapPin } as const;
export const LOCATION_LABEL = { WFO: 'Office', WFH: 'Home', ON_DUTY: 'Client site' } as const;
export const AUTO_CHECKOUT_LABEL = { workday_end: 'the workday had ended', max_shift: 'the shift reached its maximum length', idle: 'there was no activity in FG One' } as const;

/** Live minutes since a timestamp (re-renders every 30s). */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function liveWorked(r: AttendanceRecord, now: number) {
  if (r.state === 'checked_out') return r.workedMinutes;
  const end = now;
  const brk = r.breaks.reduce((n, b) => n + Math.max(0, ((b.endAt ? new Date(b.endAt).getTime() : end) - new Date(b.startAt).getTime()) / 60_000), 0);
  return Math.max(0, Math.round((end - new Date(r.checkInAt).getTime()) / 60_000 - brk));
}

/** Visual bar of the day: work segments, breaks, and gaps between check-ins. */
export function DayBar({ r, now }: { r: AttendanceRecord; now: number }) {
  const start = new Date(r.checkInAt).getTime();
  const end = r.checkOutAt ? new Date(r.checkOutAt).getTime() : now;
  const span = Math.max(1, end - start);
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-primary/80" role="img" aria-label={`Worked ${fmtDuration(r.workedMinutes)}, breaks ${fmtDuration(r.breakMinutes)}`}>
      {r.breaks.map((b) => {
        const bs = new Date(b.startAt).getTime();
        const be = b.endAt ? new Date(b.endAt).getTime() : now;
        return <span key={b.id} className={cn('absolute inset-y-0', b.kind === 'AWAY' ? 'bg-surface-2' : 'bg-amber-400')} style={{ left: `${((bs - start) / span) * 100}%`, width: `${Math.max(0.8, ((be - bs) / span) * 100)}%` }} />;
      })}
    </div>
  );
}

export function AttendancePanel({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const { time: clockTime } = useClock();
  const today = useAttendanceToday();
  const [location, setLocation] = useState<'WFO' | 'WFH' | 'ON_DUTY'>('WFO');
  const [remarks, setRemarks] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);
  const r = today.data?.record ?? null;
  const now = useNow(!!r && r.state !== 'checked_out');

  useEffect(() => {
    const allowed = today.data?.policy.allowedLocations;
    if (allowed?.length && !allowed.includes(location)) setLocation(allowed[0]!);
  }, [today.data, location]);

  // The UI only changes after the server confirms the transition.
  const act = useMutation({
    mutationFn: (v: { path: string; body?: unknown; ok: string }) => api<AttendanceToday>(`/attendance/${v.path}`, { method: 'POST', body: v.body ?? {} }),
    onSuccess: (data, v) => {
      qc.setQueryData(['attendance-today'], data);
      void qc.invalidateQueries({ queryKey: ['attendance-history'] });
      toast.success(v.ok);
      setRemarks('');
      setConfirmOut(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (today.isPending) return <Skeleton className={compact ? 'h-28' : 'h-56'} />;
  if (today.isError) return <p className="rounded-xl border border-rose-500/30 p-4 text-sm text-danger">Attendance is unavailable right now. {errorMessage(today.error)}</p>;
  const d = today.data!;
  const time = (t: string | Date) => clockTime(t, d.policy.timezone);
  const allowed = WORK_LOCATIONS.filter((l) => d.policy.allowedLocations.includes(l.key));
  const worked = r ? liveWorked(r, now) : 0;
  const LocIcon = r ? LOCATION_ICON[r.location] : null;
  // A night shift that started yesterday and has ended: show it, but the next shift is a fresh check-in.
  const prevShift = r?.state === 'checked_out' && r.date !== d.date;
  // Checking in again reopens the day: allowed for split shifts, or after the system checked you out.
  const canCheckInAgain = r?.state === 'checked_out' && !prevShift && (d.policy.multipleSessions || !!r.autoCheckOutReason);
  const hasAway = !!r?.breaks.some((b) => b.kind === 'AWAY');

  const headline = !r
    ? d.onLeave
      ? "You're on leave today"
      : d.isWorkingDay
        ? "You haven't checked in yet"
        : 'Not a working day'
    : r.state === 'working'
      ? `Working · ${fmtDuration(worked)}`
      : r.state === 'on_break'
        ? 'On a break'
        : `${prevShift ? 'Last shift done' : canCheckInAgain ? 'Checked out' : 'Done for today'} · ${fmtDuration(r.workedMinutes)}`;
  const sub = !r
    ? !d.isWorkingDay && !d.onLeave
      ? "Today is a day off. If you're working anyway, check in and it's recorded as day-off work."
      : `Working hours ${d.policy.workdayStart}–${d.policy.workdayEnd}. Choose where you're working, then check in.`
    : prevShift
      ? `Your shift from ${time(r.checkInAt)} ended at ${time(r.checkOutAt!)}. Check in when your next shift starts.`
      : r.state === 'checked_out'
        ? r.autoCheckOutReason
          ? `Checked out automatically at ${time(r.checkOutAt!)} because ${AUTO_CHECKOUT_LABEL[r.autoCheckOutReason]}. If you're still working, check in again.`
          : `Checked in ${time(r.checkInAt)}, checked out ${time(r.checkOutAt!)}. Breaks ${fmtDuration(r.breakMinutes)}.`
        : `Checked in at ${time(r.checkInAt)}${r.late ? ' (after the grace period)' : ''}. Breaks so far ${fmtDuration(r.breakMinutes)}.`;

  return (
    <div className={cn('rounded-xl border bg-surface', compact ? 'p-4' : 'p-5 sm:p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            Attendance · {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
            <InfoHint>Attendance records when your workday starts and ends. Your status (Available, In a meeting…) is separate and doesn&apos;t change it.</InfoHint>
          </p>
          <p className={cn('mt-1 font-semibold tracking-tight', compact ? 'text-base' : 'text-xl')} aria-live="polite">
            {headline}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">{sub}</p>
        </div>
        {r && LocIcon && (
          <span className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium">
            <LocIcon className="size-3.5 text-primary" /> {LOCATION_LABEL[r.location]}
          </span>
        )}
      </div>

      {r && (
        <div className="mt-4">
          <DayBar r={r} now={now} />
          <div className="mt-1.5 flex justify-between text-[11px] text-subtle tabular-nums">
            <span>{time(r.checkInAt)}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary/80" /> Work</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-400" /> Break</span>
              {hasAway && <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-surface-2 ring-1 ring-border-strong ring-inset" /> Away</span>}
            </span>
            <span>{r.checkOutAt ? time(r.checkOutAt) : 'now'}</span>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={r?.state ?? 'none'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="mt-4">
          {(!r || prevShift) && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Where are you working today?">
                {allowed.map((l) => {
                  const Icon = LOCATION_ICON[l.key];
                  return (
                    <button
                      key={l.key}
                      role="radio"
                      aria-checked={location === l.key}
                      onClick={() => setLocation(l.key)}
                      className={cn('flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-[13px] font-medium transition', location === l.key ? 'border-primary bg-primary-soft text-primary-ink' : 'text-muted hover:border-border-strong hover:text-foreground')}
                    >
                      <Icon className="size-5" />
                      {l.label}
                    </button>
                  );
                })}
              </div>
              {!compact && <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={200} placeholder="Note (optional), e.g. client name or reason" aria-label="Note for today" />}
              <Button size="lg" className="w-full" loading={act.isPending} onClick={() => act.mutate({ path: 'check-in', body: { location, remarks: remarks || null }, ok: `Checked in (${LOCATION_LABEL[location]})` })}>
                <LogIn /> Check in
              </Button>
            </div>
          )}
          {r && r.state !== 'checked_out' && (
            <div className="flex flex-wrap gap-2">
              {d.policy.breaksEnabled &&
                (r.state === 'on_break' ? (
                  <Button size="lg" className="flex-1" loading={act.isPending} onClick={() => act.mutate({ path: 'break/end', ok: 'Welcome back' })}>
                    <Play /> End break
                  </Button>
                ) : (
                  <Button size="lg" variant="outline" className="flex-1" loading={act.isPending} onClick={() => act.mutate({ path: 'break/start', ok: 'Break started' })}>
                    <Coffee /> Start break
                  </Button>
                ))}
              <Button size="lg" variant={r.state === 'on_break' ? 'outline' : 'primary'} className="flex-1" onClick={() => setConfirmOut(true)}>
                <LogOut /> Check out
              </Button>
            </div>
          )}
          {canCheckInAgain && (
            <Button size="lg" className="w-full" loading={act.isPending} onClick={() => act.mutate({ path: 'check-in', body: { location: r!.location, remarks: null }, ok: 'Checked in again' })}>
              <LogIn /> Check in again
            </Button>
          )}
          {r?.state === 'checked_out' && !canCheckInAgain && !prevShift && !compact && <p className="text-[13px] text-muted">See your history below. Talk to HR if something needs correcting.</p>}
          {compact && (
            <Link href="/app/attendance" className="mt-3 inline-block text-xs text-muted hover:text-foreground">
              View attendance history
            </Link>
          )}
        </motion.div>
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title="Check out for today?"
        description={`You've worked ${fmtDuration(worked)} today. ${d.policy.multipleSessions ? 'You can check in again later today.' : "You can't check in again until tomorrow."}`}
        confirmLabel="Check out"
        loading={act.isPending}
        onConfirm={() => act.mutate({ path: 'check-out', body: {}, ok: 'Checked out. Have a good evening.' })}
      />
    </div>
  );
}
