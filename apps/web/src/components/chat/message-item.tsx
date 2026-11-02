'use client';
import { useMutation } from '@tanstack/react-query';
import { MessageSquareReply, MoreHorizontal, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Textarea } from '@/components/ui/input';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import type { ChatMessage } from '@/lib/types';
import { cn, fmtTime } from '@/lib/utils';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥', '✅'];

/** Renders @mentions and URLs safely (no HTML injection — React escapes text). */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[A-Za-z][\w.-]*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            {p}
          </a>
        ) : p.startsWith('@') ? (
          <span key={i} className="rounded bg-primary-soft px-1 font-medium text-primary">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function MessageItem({
  m,
  compact,
  meId,
  canModerate,
  onReply,
  inThread,
}: {
  m: ChatMessage;
  compact: boolean;
  meId: string;
  canModerate: boolean;
  onReply?: (m: ChatMessage) => void;
  inThread?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const mine = m.author?.id === meId;

  const react = useMutation({
    mutationFn: (emoji: string) => api(`/messages/${m.id}/reactions`, { body: { emoji } }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const edit = useMutation({
    mutationFn: (body: string) => api(`/messages/${m.id}`, { method: 'PATCH', body: { body } }),
    onSuccess: () => setEditing(false),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/messages/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => toast.success('Message deleted'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const author = m.author ?? { id: 'x', name: 'Former employee', avatarUrl: null, avatarColor: '#94a3b8' };

  return (
    <motion.div
      initial={m.pending ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: m.pending ? 0.6 : 1, y: 0 }}
      className={cn('group relative flex gap-3 rounded-lg px-4 transition-colors hover:bg-surface-2/60', compact ? 'py-0.5' : 'mt-2 pt-1.5 pb-0.5')}
      data-testid="message"
    >
      <div className="w-9 shrink-0">
        {compact ? (
          <span className="invisible block pt-1 text-right text-[10px] text-muted group-hover:visible">{fmtTime(m.createdAt)}</span>
        ) : (
          <UserAvatar person={author} size="md" showPresence={false} className="mt-0.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{author.name}</span>
            <span className="text-[11px] text-muted">{fmtTime(m.createdAt)}</span>
          </div>
        )}
        {m.deleted ? (
          <p className="text-sm text-muted italic">This message was deleted.</p>
        ) : editing ? (
          <div className="my-1 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim()) edit.mutate(draft.trim());
                }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <p className="text-xs text-muted">
              Enter to save · Esc to cancel
            </p>
          </div>
        ) : (
          <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap">
            <RichText text={m.body} />
            {m.editedAt && <span className="ml-1 text-[11px] text-muted">(edited)</span>}
          </p>
        )}

        {m.reactions.length > 0 && !m.deleted && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => {
              const reacted = r.userIds.includes(meId);
              return (
                <motion.button
                  key={r.emoji}
                  layout
                  whileTap={{ scale: 0.9 }}
                  onClick={() => react.mutate(r.emoji)}
                  className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition', reacted ? 'border-primary/50 bg-primary-soft text-primary' : 'bg-surface hover:border-primary/40')}
                  aria-pressed={reacted}
                  aria-label={`${r.emoji} ${r.count}`}
                >
                  <span>{r.emoji}</span>
                  <span className="font-medium tabular-nums">{r.count}</span>
                </motion.button>
              );
            })}
          </div>
        )}

        {!inThread && m.replyCount > 0 && onReply && (
          <button onClick={() => onReply(m)} className="mt-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary-soft">
            <MessageSquareReply className="size-3.5" /> {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      {!m.deleted && !m.pending && !editing && (
        <div className={cn('absolute -top-3 right-4 flex items-center rounded-lg border bg-surface shadow-md transition-opacity', pickerOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
          {QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button key={e} onClick={() => react.mutate(e)} className="grid size-7 place-items-center rounded-md text-sm transition hover:scale-110 hover:bg-surface-2" aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="More reactions">
                <SmilePlus className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto gap-0.5 p-1.5">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    react.mutate(e);
                    setPickerOpen(false);
                  }}
                  className="grid size-8 place-items-center rounded-md text-base transition hover:scale-110 hover:bg-surface-2"
                >
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          {onReply && !inThread && (
            <button onClick={() => onReply(m)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Reply in thread">
              <MessageSquareReply className="size-4" />
            </button>
          )}
          {(mine || canModerate) && (
            <DropdownMenu>
              <DropdownTrigger asChild>
                <button className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Message actions">
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownTrigger>
              <DropdownContent className="min-w-36">
                {mine && (
                  <DropdownItem onSelect={() => { setDraft(m.body); setEditing(true); }}>
                    <Pencil /> Edit
                  </DropdownItem>
                )}
                <DropdownItem danger onSelect={() => del.mutate()}>
                  <Trash2 /> Delete
                </DropdownItem>
              </DropdownContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </motion.div>
  );
}
