'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, Wrench } from 'lucide-react';
import { Suspense, useState } from 'react';
import { CorrectionDialog, type CorrectionPrefill } from '@/components/attendance/correction-dialog';
import { Button } from '@/components/ui/button';
import { PERMISSIONS } from '@fg/shared';
import { AttendanceBoard } from '@/components/attendance/attendance-board';
import { AttendancePanel, DayBar, LOCATION_ICON, LOCATION_LABEL } from '@/components/attendance/attendance-panel';
import { PageHeader } from '@/components/shell/page';
import { SectionTitle } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { fmtDuration, useCorrections } from '@/lib/hooks';
import { useCan, useClock, useOrgToday } from '@/lib/session';
import type { AttendanceHistory } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, parseDateOnly } from '@/lib/utils';

const RANGES = [
  ['7', '7 days'],
  ['30', '30 days'],
  ['90', '90 days'],
] as const;

function History() {
  const { time: clockTime } = useClock();
  const org = useOrgToday();
  const [get, set] = useUrlState({ range: '30' });
  // Unknown values in the URL fall back to 30 days.
  const range = RANGES.some(([v]) => v === get('range')) ? get('range') : '30';
  const hist = useQuery({
    queryKey: ['attendance-history', range],
    // Days are the organization's calendar days, not the browser's.
    queryFn: () => api<AttendanceHistory>('/attendance/me', { query: { from: org.today(-(Number(range) - 1)), to: org.today() } }),
    placeholderData: (p) => p,
  });
  const s = hist.data?.summary;
  const [fix, setFix] = useState<CorrectionPrefill | null>(null);
  const tz = hist.data?.timezone;
  const hm = (t: string | null) => (t ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)) : null);
  const yesterday = org.today(-1);
  const time = (t: string | Date) => clockTime(t, hist.data?.timezone);
  return (
    <section className="mt-10">
      <SectionTitle
        icon={<CalendarClock />}
        action={
          <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setFix({ date: yesterday })}>
            <Wrench /> Fix a day
          </Button>
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Period">
            {RANGES.map(([v, label]) => (
              <button key={v} role="radio" aria-checked={range === v} onClick={() => set({ range: v })} className={cn('rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition', range === v ? 'bg-canvas shadow-sm' : 'text-muted')}>
                <span className="hidden sm:inline">Last </span>
                {label}
              </button>
            ))}
          </div>
          </div>
        }
      >
        My history
      </SectionTitle>
      {s && (
        <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5">
          {[
            ['Days present', s.daysPresent],
            ['Office', s.office],
            ['Home', s.home],
            ['Client site', s.clientSite],
            ['Total worked', fmtDuration(s.workedMinutes)],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-surface px-4 py-3 last:col-span-2 sm:last:col-span-1">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="text-lg font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {hist.isPending ? (
        <Skeleton className="h-64" />
      ) : hist.isError ? (
        <EmptyState icon={<CalendarClock />} title="Your history couldn't be loaded" description={errorMessage(hist.error)} action={<Button variant="outline" onClick={() => void hist.refetch()}>Try again</Button>} />
      ) : !hist.data?.items.length ? (
        <EmptyState icon={<CalendarClock />} title="No attendance yet" description="Your days appear here after you check in." />
      ) : (
        <ul className="divide-y rounded-xl border">
          {hist.data.items.map((r) => {
            const Loc = LOCATION_ICON[r.location];
            const d = parseDateOnly(r.date);
            return (
              <li key={r.id} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-4 px-4 py-3 sm:grid-cols-[56px_minmax(0,1fr)_minmax(0,1.3fr)_90px]">
                <span className="text-center">
                  <span className="block text-[10px] font-medium text-subtle uppercase">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <span className="block text-base leading-tight font-semibold tabular-nums">{d.getDate()}</span>
                  <span className="block text-[10px] text-subtle">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">
                    <Loc className="size-3.5 text-primary" /> {LOCATION_LABEL[r.location]}
                    {r.late && <Badge tone="warning">Late</Badge>}
                    {r.dayOff && <Badge tone="success">Day-off work</Badge>}
                    {r.autoCheckedIn && <Badge>Auto check-in</Badge>}
                    {r.autoCheckOutReason && <Badge tone="warning">Auto check-out</Badge>}
                    {r.state !== 'checked_out' && <Badge tone="success">Today</Badge>}
                  </span>
                  <span className="block text-xs text-muted tabular-nums">
                    {time(r.checkInAt)} – {r.checkOutAt ? time(r.checkOutAt) : 'now'} · breaks {fmtDuration(r.breakMinutes)}
                  </span>
                  {(r.remarks || r.checkOutRemarks) && <span className="block truncate text-xs text-subtle">{[r.remarks, r.checkOutRemarks].filter(Boolean).join(' · ')}</span>}
                </span>
                <span className="col-span-2 sm:col-span-1">
                  <DayBar r={r} now={Date.now()} />
                </span>
                <span className="hidden text-right text-sm font-medium tabular-nums sm:block">
                  {fmtDuration(r.workedMinutes)}
                  {r.state === 'checked_out' && (
                    <button onClick={() => setFix({ date: r.date, checkIn: hm(r.checkInAt) ?? undefined, checkOut: hm(r.checkOutAt), location: r.location })} className="block w-full text-right text-[11px] font-normal text-muted hover:text-primary">
                      Request correction
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <MyCorrections />
      <CorrectionDialog prefill={fix} onClose={() => setFix(null)} />
    </section>
  );
}

function MyCorrections() {
  const q = useCorrections('mine');
  if (!q.data?.length) return null;
  const tone = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;
  const label = { PENDING: 'Waiting for review', APPROVED: 'Applied', REJECTED: 'Declined' } as const;
  return (
    <div className="mt-8">
      <SectionTitle icon={<ClipboardCheck />}>My correction requests</SectionTitle>
      <ul className="divide-y rounded-xl border">
        {q.data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
            <span className="font-medium">{new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <span className="text-muted tabular-nums">
              {c.checkIn} – {c.checkOut ?? '…'}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted">{c.reason}</span>
            <Badge tone={tone[c.status]}>{label[c.status]}</Badge>
            {c.reviewNote && <span className="w-full text-xs text-subtle">“{c.reviewNote}”{c.reviewer ? ` — ${c.reviewer.firstName}` : ''}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttendancePage() {
  const can = useCan();
  const team = can(PERMISSIONS.ATTENDANCE_VIEW_TEAM) || can(PERMISSIONS.ATTENDANCE_VIEW_ALL);
  const [get, set] = useUrlState({ tab: 'me' });
  const tab = team ? get('tab') : 'me';
  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        className="px-0 pt-0 sm:px-0"
        title="Attendance"
        description="Check in when you start, take breaks, and check out when you finish. Managers can see their team here."
        actions={
          team && (
            <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Attendance view">
              {([
                ['me', 'My attendance'],
                ['team', can(PERMISSIONS.ATTENDANCE_VIEW_ALL) ? 'Everyone' : 'My team'],
              ] as const).map(([v, label]) => (
                <button key={v} role="tab" aria-selected={tab === v} onClick={() => set({ tab: v }, { push: true })} className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium transition', tab === v ? 'bg-canvas shadow-sm' : 'text-muted')}>
                  {label}
                </button>
              ))}
            </div>
          )
        }
      />
      {tab === 'team' ? (
        <AttendanceBoard canExport={can(PERMISSIONS.ATTENDANCE_VIEW_ALL)} />
      ) : (
        <>
          <div className="max-w-xl">
            <AttendancePanel />
          </div>
          <History />
        </>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AttendancePage />
    </Suspense>
  );
}
