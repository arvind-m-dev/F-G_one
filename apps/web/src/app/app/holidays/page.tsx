'use client';
import { Suspense } from 'react';
import { HolidayList } from '@/components/leave/holiday-list';
import { PageHeader } from '@/components/shell/page';

export default function HolidaysPage() {
  return (
    <div className="mx-auto max-w-[900px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader className="px-0 pt-0 sm:px-0" title="Holidays" description="The company holiday calendar. Public and company holidays aren't counted when you take leave." />
      <Suspense>
        <HolidayList />
      </Suspense>
    </div>
  );
}
