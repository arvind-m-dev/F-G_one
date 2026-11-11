'use client';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { AttendanceBoard } from '@/components/attendance/attendance-board';
import { useApprovalsCount } from '@/lib/hooks';
import { useCan } from '@/lib/session';

/** Attendance corrections are decided on the Approvals page; this points there when some are waiting. */
function CorrectionsWaiting() {
  const approvals = useApprovalsCount();
  const n = approvals.data?.canApprove ? approvals.data.corrections : 0;
  if (!n) return null;
  return (
    <Link href="/app/approvals" className="group mb-5 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm transition hover:bg-warning/15">
      <ClipboardCheck className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {n} attendance {n === 1 ? 'correction is' : 'corrections are'} waiting for a decision
        </span>
        <span className="block text-xs text-muted">Someone asked to fix their check-in or check-out time. Review {n === 1 ? 'it' : 'them'} in Approvals.</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-foreground">
        Review <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

export default function AdminAttendancePage() {
  const can = useCan();
  if (!can(PERMISSIONS.ATTENDANCE_VIEW_ALL)) return <Forbidden />;
  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader title="Attendance" description="Who is in today, where they're working, and who hasn't checked in. Updates live." />
      <CorrectionsWaiting />
      <Suspense>
        <AttendanceBoard canExport personHref={can(PERMISSIONS.EMPLOYEES_MANAGE) ? (id) => `/admin/employees/${id}?tab=attendance` : undefined} />
      </Suspense>
    </div>
  );
}
