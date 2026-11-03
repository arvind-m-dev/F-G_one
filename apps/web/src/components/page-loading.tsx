import { Skeleton } from '@/components/ui/misc';

/** Placeholder shown while a portal page's code and data load. */
export function PageLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading page">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-col gap-2 rounded-xl border bg-surface p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="hidden h-6 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
