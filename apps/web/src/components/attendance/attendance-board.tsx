'use client';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { fmtDuration } from '@/lib/hooks';
import { useClock, useOrgToday } from '@/lib/session';
import type { AttendanceBoard as Board, AttendanceRecord } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { LOCATION_ICON, LOCATION_LABEL } from './attendance-panel';

const FILTERS = [
  ['all', 'Everyone'],
  ['in', 'Checked in'],
  ['WFO', 'Office'],
  ['WFH', 'Home'],
  ['ON_DUTY', 'Client site'],
  ['break', 'On a break'],
  ['out', 'Checked out'],
  ['missing', 'Not checked in'],
  ['leave', 'On leave'],
  ['late', 'Late'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const shiftDay = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function StateBadge({ r, leave }: { r: AttendanceRecord | null; leave?: { type: string; halfDay: boolean } | null }) {
  if (!r && leave) return <Badge tone="brand">{leave.halfDay ? 'Half day off' : 'On leave'}</Badge>;
  if (!r) return <Badge tone="muted">Not checked in</Badge>;
  if (r.state === 'on_break') return <Badge tone="warning">On a break</Badge>;
  if (r.state === 'checked_out') return <Badge>Checked out</Badge>;
  return <Badge tone="success">Working</Badge>;
}

/** Live attendance board for a day. Used by managers (their team) and HR/Admin (everyone). */
export function AttendanceBoard({ canExport }: { canExport?: boolean }) {
  const { time: clockTime } = useClock();
  const [get, set] = useUrlState({ date: '', show: 'all', q: '' });
  const orgToday = useOrgToday().today();
  // A date that isn't YYYY-MM-DD (an edited link) shows today instead of an error.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(get('date')) ? get('date') : '';
  const show = (FILTERS.some(([k]) => k === get('show')) ? get('show') : 'all') as Filter;
  const [q, setQ] = useState(get('q'));
  const board = useQuery({ queryKey: ['attendance-board', date], queryFn: () => api<Board>('/attendance/board', { query: { date: date || undefined } }), placeholderData: (p) => p, refetchInterval: 60_000 });
  const [exporting, setExporting] = useState(false);
  const d = board.data;
  const time = (t: string | Date) => clockTime(t, d?.timezone);

  const counts: Record<Filter, number> = d
    ? { all: d.totals.employees, in: d.totals.checkedIn, WFO: d.totals.office, WFH: d.totals.home, ON_DUTY: d.totals.clientSite, break: d.totals.onBreak, out: d.totals.checkedOut, missing: d.totals.notCheckedIn, leave: d.totals.onLeave, late: d.totals.late }
    : ({} as Record<Filter, number>);
  const rows = (d?.rows ?? []).filter(({ person, record: r, leave }) => {
    if (q && !person.name.toLowerCase().includes(q.toLowerCase())) return false;
    switch (show) {
      case 'in': return !!r;
      case 'WFO': case 'WFH': case 'ON_DUTY': return r?.location === show;
      case 'break': return r?.state === 'on_break';
      case 'out': return r?.state === 'checked_out';
      case 'missing': return !r && !leave;
      case 'leave': return !!leave;
      case 'late': return !!r?.late;
      default: return true;
    }
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const day = d?.date;
      const res = await fetch(`/api/attendance/export?from=${shiftDay(day!, -29)}&to=${day}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'attendance.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Export downloaded (last 30 days)');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-border-strong bg-surface shadow-sm">
          <button className="grid size-9 place-items-center text-muted hover:text-foreground" aria-label="Previous day" onClick={() => d && set({ date: shiftDay(d.date, -1) })}>
            <ChevronLeft className="size-4" />
          </button>
          <input
            type="date"
            value={d?.date ?? date}
            max={orgToday}
            onChange={(e) => set({ date: e.target.value && e.target.value <= orgToday ? e.target.value : null })}
            className="h-9 bg-transparent px-1 text-sm outline-none"
            aria-label="Date"
          />
          <button className="grid size-9 place-items-center text-muted hover:text-foreground disabled:opacity-30" aria-label="Next day" disabled={!d || d.date >= orgToday} onClick={() => d && set({ date: shiftDay(d.date, 1) === orgToday ? null : shiftDay(d.date, 1) })}>
            <ChevronRight className="size-4" />
          </button>
        </div>
        {date && (
          <Button size="sm" variant="ghost" onClick={() => set({ date: null })}>
            Today
          </Button>
        )}
        <Input value={q} onChange={(e) => { setQ(e.target.value); set({ q: e.target.value }); }} placeholder="Find a person" className="h-9 w-full sm:w-52" aria-label="Find a person" />
        {canExport && (
          <Button variant="outline" className="sm:ml-auto" loading={exporting} onClick={exportCsv} disabled={!d}>
            <Download /> Export CSV
          </Button>
        )}
      </div>

      <div className="scrollbar-thin -mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Show">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            role="radio"
            aria-checked={show === k}
            onClick={() => set({ show: k })}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition', show === k ? 'border-foreground/20 bg-foreground text-canvas' : 'text-muted hover:border-border-strong hover:text-foreground')}
          >
            {label} <span className="tabular-nums opacity-60">{d ? counts[k] : '–'}</span>
          </button>
        ))}
      </div>

      {board.isPending ? (
        <Skeleton className="h-72" />
      ) : board.isError ? (
        <p className="text-sm text-danger">{errorMessage(board.error)}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users />} title="No one matches" description="Try another filter or date." />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="hidden grid-cols-[minmax(0,2fr)_120px_120px_90px_90px_90px] gap-4 border-b bg-surface-2/50 px-4 py-2 text-[11px] font-medium text-muted md:grid">
            <span>Person</span>
            <span>Status</span>
            <span>Where</span>
            <span>In</span>
            <span>Out</span>
            <span className="text-right">Worked</span>
          </div>
          <ul className="divide-y">
            {rows.map(({ person, record: r, leave }) => {
              const Loc = r ? LOCATION_ICON[r.location] : null;
              return (
                <li key={person.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_120px_120px_90px_90px_90px]">
                  <span className="flex min-w-0 items-center gap-3">
                    <UserAvatar person={person} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{person.name}</span>
                      <span className="block truncate text-xs text-muted">{person.designation ?? person.department?.name ?? ''}</span>
                    </span>
                  </span>
                  <span className="justify-self-end md:justify-self-start">
                    <StateBadge r={r} leave={leave} />
                  </span>
                  <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-11 text-xs text-muted md:contents md:pl-0 md:text-[13px]">
                    <span className="flex items-center gap-1.5 md:text-foreground">
                      {Loc && <Loc className="size-3.5 text-primary" />}
                      {r ? LOCATION_LABEL[r.location] : <span className="hidden md:inline">—</span>}
                      {r?.late && <Badge tone="warning" className="ml-1">Late</Badge>}
                      {r?.dayOff && <Badge tone="success" className="ml-1">Day-off work</Badge>}
                      {r?.autoCheckedIn && <Badge className="ml-1">Auto check-in</Badge>}
                      {r?.autoCheckOutReason && <Badge tone="warning" className="ml-1">Auto check-out</Badge>}
                    </span>
                    <span className="tabular-nums md:text-foreground">{r ? <><span className="md:hidden">In </span>{time(r.checkInAt)}</> : <span className="hidden md:inline">—</span>}</span>
                    <span className="tabular-nums md:text-foreground">{r?.checkOutAt ? <><span className="md:hidden">Out </span>{time(r.checkOutAt)}</> : <span className="hidden md:inline">—</span>}</span>
                    <span className="tabular-nums md:text-right md:text-foreground">{r ? fmtDuration(r.workedMinutes) : ''}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
