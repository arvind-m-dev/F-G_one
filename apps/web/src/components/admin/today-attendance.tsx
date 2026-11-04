'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { PERMISSIONS } from '@fg/shared';
import { LoadError } from '@/components/admin/page-header';
import { SectionTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import type { AttendanceBoard } from '@/lib/types';
import { cn } from '@/lib/utils';

type Bucket = 'working' | 'break' | 'out' | 'leave' | 'missing';

const BUCKETS: { key: Bucket; label: string; dot: string; show: string }[] = [
  { key: 'working', label: 'Working', dot: 'bg-success', show: 'in' },
  { key: 'break', label: 'On a break', dot: 'bg-warning', show: 'break' },
  { key: 'out', label: 'Checked out', dot: 'bg-muted', show: 'out' },
  { key: 'leave', label: 'On leave', dot: 'bg-brand', show: 'leave' },
  { key: 'missing', label: 'Not checked in', dot: 'bg-border-strong', show: 'missing' },
];

function bucketOf(row: AttendanceBoard['rows'][number]): Bucket {
  const r = row.record;
  if (!r) return row.leave ? 'leave' : 'missing';
  if (r.state === 'on_break') return 'break';
  if (r.state === 'checked_out') return 'out';
  return 'working';
}

/** Today's attendance for everyone: who is working, on a break, on leave or not in yet. */
export function TodayAttendance() {
  const can = useCan();
  const canOpenPerson = can(PERMISSIONS.EMPLOYEES_MANAGE);
  // Same key as the attendance board for today, so both share one cache entry.
  const board = useQuery({
    queryKey: ['attendance-board', ''],
    queryFn: () => api<AttendanceBoard>('/attendance/board'),
    refetchInterval: 60_000,
  });

  const title = (
    <SectionTitle icon={<CalendarCheck />} action={<Link href="/admin/attendance" className="text-xs text-muted hover:text-foreground">Open attendance</Link>}>
      Attendance today
    </SectionTitle>
  );

  if (board.isPending) {
    return (
      <section>
        {title}
        <Skeleton className="h-36" />
      </section>
    );
  }
  if (board.isError) {
    return (
      <section>
        {title}
        <LoadError what="today's attendance" error={board.error} onRetry={() => board.refetch()} />
      </section>
    );
  }

  const d = board.data;
  const groups: Record<Bucket, AttendanceBoard['rows']> = { working: [], break: [], out: [], leave: [], missing: [] };
  for (const row of d.rows) groups[bucketOf(row)].push(row);
  const total = d.rows.length;
  // On a day off nobody is expected in, so "not checked in" is not a problem worth flagging.
  const buckets = d.isWorkingDay ? BUCKETS : BUCKETS.filter((b) => b.key !== 'missing');
  const missing = d.isWorkingDay ? groups.missing : [];

  return (
    <section>
      {title}
      <div className="rounded-xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{d.totals.checkedIn}</span>
            <span className="text-muted"> of {total} checked in</span>
          </p>
          {!d.isWorkingDay ? (
            <span className="text-xs text-muted">Today is a day off</span>
          ) : d.totals.late > 0 ? (
            <Link href="/admin/attendance?show=late" className="text-xs text-warning hover:underline">
              {d.totals.late} arrived late
            </Link>
          ) : null}
        </div>

        {total > 0 && (
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={buckets.map((b) => `${b.label}: ${groups[b.key].length}`).join(', ')}>
            {buckets.map((b) => groups[b.key].length > 0 && <span key={b.key} className={cn('h-full', b.dot)} style={{ width: `${(groups[b.key].length / total) * 100}%` }} />)}
          </div>
        )}

        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {buckets.map((b) => (
            <li key={b.key}>
              <Link href={`/admin/attendance?show=${b.show}`} className="block rounded-lg border px-3 py-2 transition hover:bg-surface-2">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span className={cn('size-2 rounded-full', b.dot)} /> {b.label}
                </span>
                <span className="mt-0.5 block text-lg font-semibold tabular-nums">{groups[b.key].length}</span>
              </Link>
            </li>
          ))}
        </ul>

        {missing.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted">Not checked in yet</p>
            <ul className="flex flex-wrap gap-1.5">
              {missing.slice(0, 12).map(({ person }) => {
                const chip = (
                  <>
                    <UserAvatar person={person} size="xs" showPresence={false} />
                    <span className="truncate">{person.name}</span>
                  </>
                );
                const cls = 'flex max-w-[12rem] items-center gap-1.5 rounded-full border bg-surface py-0.5 pr-2.5 pl-0.5 text-xs';
                return (
                  <li key={person.id}>
                    {canOpenPerson ? (
                      <Link href={`/admin/employees/${person.id}`} className={cn(cls, 'transition hover:bg-surface-2')}>
                        {chip}
                      </Link>
                    ) : (
                      <span className={cls}>{chip}</span>
                    )}
                  </li>
                );
              })}
              {missing.length > 12 && (
                <li>
                  <Link href="/admin/attendance?show=missing" className="flex items-center rounded-full border px-2.5 py-0.5 text-xs text-muted hover:bg-surface-2">
                    +{missing.length - 12} more
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
