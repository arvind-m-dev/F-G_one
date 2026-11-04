'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pin } from 'lucide-react';
import { toast } from 'sonner';
import { ANNOUNCEMENT_CATEGORIES } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import type { Announcement } from '@/lib/types';

export const categoryLabel = (k: string) => ANNOUNCEMENT_CATEGORIES.find((c) => c.key === k)?.label ?? k;
export const priorityTone = { NORMAL: 'muted', IMPORTANT: 'warning', CRITICAL: 'danger' } as const;
export const priorityLabel = { NORMAL: 'Update', IMPORTANT: 'Important', CRITICAL: 'Urgent' } as const;

/** Full-text reader with "I've read this" acknowledgement. */
export function AnnouncementReader({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['announcements', 'one', id], queryFn: () => api<Announcement>(`/announcements/${id}`), enabled: !!id });
  const ack = useMutation({
    mutationFn: () => api(`/announcements/${id}/ack`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Thanks for confirming');
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const a = q.data;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()} title={q.isError ? 'Announcement' : (a?.title ?? 'Announcement')} side="right" className="max-w-xl">
      {q.isError ? (
        <div className="py-10 text-center" role="alert">
          <p className="text-base font-semibold">This announcement isn&apos;t available</p>
          <p className="mt-1 text-sm text-muted">It may have been removed, have expired, or be meant for another department.</p>
          <Button variant="outline" className="mt-5" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : !a ? (
        <Skeleton className="h-64" />
      ) : (
        <article>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{categoryLabel(a.category)}</Badge>
            {a.priority !== 'NORMAL' && <Badge tone={priorityTone[a.priority]}>{priorityLabel[a.priority]}</Badge>}
            {a.pinned && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Pin className="size-3" /> Pinned
              </span>
            )}
            <span className="text-xs text-muted">· {a.department?.name ?? 'Everyone'}</span>
          </div>
          {a.author && (
            <div className="mt-4 flex items-center gap-2.5">
              <UserAvatar person={{ ...a.author, name: `${a.author.firstName} ${a.author.lastName}` }} size="sm" showPresence={false} />
              <div className="text-[13px]">
                <p className="font-medium">
                  {a.author.firstName} {a.author.lastName}
                </p>
                <p className="text-xs text-muted">{new Date(a.publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
            </div>
          )}
          <div className="mt-5 text-[15px] leading-[1.7] break-words whitespace-pre-wrap text-foreground/90">{a.body}</div>
          {a.expiresAt && <p className="mt-6 text-xs text-subtle">Visible until {new Date(a.expiresAt).toLocaleDateString()}</p>}
          {a.requireAck && (
            <div className="mt-8 rounded-xl border bg-surface-2/60 p-4">
              {a.acknowledgedAt ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-4" /> You confirmed you read this on {new Date(a.acknowledgedAt).toLocaleDateString()}.
                </p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm">Please confirm you have read this announcement.</p>
                  <Button loading={ack.isPending} onClick={() => ack.mutate()}>
                    <CheckCircle2 /> I&apos;ve read this
                  </Button>
                </div>
              )}
            </div>
          )}
        </article>
      )}
    </Dialog>
  );
}
