'use client';
import { Suspense } from 'react';
import { PERMISSIONS } from '@fg/shared';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { AttendanceBoard } from '@/components/attendance/attendance-board';
import { useCan } from '@/lib/session';

export default function AdminAttendancePage() {
  const can = useCan();
  if (!can(PERMISSIONS.ATTENDANCE_VIEW_ALL)) return <Forbidden />;
  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader title="Attendance" description="Who is in today, where they're working, and who hasn't checked in. Updates live." />
      <Suspense>
        <AttendanceBoard canExport />
      </Suspense>
    </div>
  );
}
