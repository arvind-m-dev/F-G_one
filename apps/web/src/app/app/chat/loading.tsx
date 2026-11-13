import { Skeleton } from '@/components/ui/misc';

/** Shown in the conversation pane while a conversation's code loads: a header bar and a few message rows. */
export default function ChatLoading() {
  return (
    <div className="flex h-full w-full flex-col" role="status" aria-label="Loading conversation">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex-1 space-y-5 px-5 py-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
