'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { Suspense } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { AttendanceBoard } from '@/components/attendance/attendance-board';
import { AttendancePanel, DayBar, LOCATION_ICON, LOCATION_LABEL } from '@/components/attendance/attendance-panel';
import { PageHeader } from '@/components/shell/page';
import { SectionTitle } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { fmtDuration } from '@/lib/hooks';
import { useCan, useClock } from '@/lib/session';
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
  const [get, set] = useUrlState({ range: '30' });
  const range = get('range');
  const to = new Date();
  const from = new Date(Date.now() - (Number(range) - 1) * 86400_000);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hist = useQuery({
    queryKey: ['attendance-history', range],
    queryFn: () => api<AttendanceHistory>('/attendance/me', { query: { from: ymd(from), to: ymd(to) } }),
    placeholderData: (p) => p,
  });
  const s = hist.data?.summary;
  const time = (t: string | Date) => clockTime(t, hist.data?.timezone);
  return (
    <section className="mt-10">
      <SectionTitle
        icon={<CalendarClock />}
        action={
          <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Period">
            {RANGES.map(([v, label]) => (
              <button key={v} role="radio" aria-checked={range === v} onClick={() => set({ range: v })} className={cn('rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition', range === v ? 'bg-canvas shadow-sm' : 'text-muted')}>
                <span className="hidden sm:inline">Last </span>
                {label}
              </button>
            ))}
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
                <span className="hidden text-right text-sm font-medium tabular-nums sm:block">{fmtDuration(r.workedMinutes)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
