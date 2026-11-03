'use client';
import { useMutation } from '@tanstack/react-query';
import { Copy, Link2, MessageSquareReply, MoreHorizontal, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { REACTIONS } from '@fg/shared';
import { reactionLabel, ReactionIcon } from '@/components/presence';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Textarea } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useClock } from '@/lib/session';
import type { ChatMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

const QUICK = ['thumbs-up', 'check', 'eyes'] as const;

/** Renders @mentions and URLs safely (React escapes text; no HTML injection). */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[A-Za-z][\w.-]*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
            {p}
          </a>
        ) : p.startsWith('@') ? (
          <span key={i} className="rounded bg-primary-soft px-1 font-medium text-primary-ink">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label} side="top">
      <button onClick={onClick} className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground" aria-label={label}>
        {children}
      </button>
    </Tooltip>
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
  const { time } = useClock();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const mine = m.author?.id === meId;

  const react = useMutation({ mutationFn: (emoji: string) => api(`/messages/${m.id}/reactions`, { body: { emoji } }), onError: (e) => toast.error(errorMessage(e)) });
  const edit = useMutation({
    mutationFn: (body: string) => api(`/messages/${m.id}`, { method: 'PATCH', body: { body } }),
    onSuccess: () => setEditing(false),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({ mutationFn: () => api(`/messages/${m.id}`, { method: 'DELETE' }), onSuccess: () => toast.success('Message deleted'), onError: (e) => toast.error(errorMessage(e)) });

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Clipboard unavailable');
    }
  };
  const author = m.author ?? { id: 'x', name: 'Former employee', avatarUrl: null, avatarColor: '#94a3b8' };

  return (
    <motion.div
      initial={m.pending ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: m.pending ? 0.55 : 1, y: 0 }}
      id={`m-${m.id}`}
      className={cn(
        'group relative flex gap-3 px-5 transition-colors hover:bg-surface-2/50 [[data-density=compact]_&]:gap-2.5',
        compact ? 'py-0.5' : 'mt-3 pt-1 pb-0.5 [[data-density=compact]_&]:mt-1.5',
        (pickerOpen || menuOpen) && 'bg-surface-2/50',
      )}
      data-testid="message"
    >
      <div className="w-9 shrink-0 [[data-density=compact]_&]:w-7">
        {compact ? (
          <span className="invisible block pt-[3px] text-right text-[10px] text-subtle tabular-nums group-hover:visible">{time(m.createdAt)}</span>
        ) : (
          <UserAvatar person={author} size="md" showPresence={false} className="mt-0.5 [[data-density=compact]_&]:scale-[0.8]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-semibold">{author.name}</span>
            <span className="text-[11px] text-subtle tabular-nums" title={new Date(m.createdAt).toLocaleString()}>
              {time(m.createdAt)}
            </span>
          </div>
        )}
        {m.deleted ? (
          <p className="text-sm text-subtle italic">This message was deleted.</p>
        ) : editing ? (
          <div className="my-1 space-y-1.5">
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
            <p className="text-[11px] text-muted">Enter to save · Esc to cancel</p>
          </div>
        ) : (
          <p className="text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/90">
            <RichText text={m.body} />
            {m.editedAt && <span className="ml-1 text-[11px] text-subtle">(edited)</span>}
          </p>
        )}

        {m.reactions.length > 0 && !m.deleted && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.reactions.map((r) => {
              const reacted = r.userIds.includes(meId);
              return (
                <motion.button
                  key={r.emoji}
                  layout
                  whileTap={{ scale: 0.92 }}
                  onClick={() => react.mutate(r.emoji)}
                  className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition', reacted ? 'border-primary/40 bg-primary-soft text-primary-ink' : 'bg-surface hover:border-border-strong')}
                  aria-pressed={reacted}
                  aria-label={`${reactionLabel(r.emoji)} ${r.count}`}
                  title={reactionLabel(r.emoji)}
                >
                  <ReactionIcon reaction={r.emoji} />
                  <span className="font-medium tabular-nums">{r.count}</span>
                </motion.button>
              );
            })}
          </div>
        )}

        {!inThread && m.replyCount > 0 && onReply && (
          <button onClick={() => onReply(m)} className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-xs font-medium text-primary-ink transition hover:border-primary/40">
            <MessageSquareReply className="size-3.5" /> {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      {!m.deleted && !m.pending && !editing && (
        <div className={cn('absolute -top-3.5 right-5 flex items-center gap-px rounded-lg border bg-elevated p-0.5 shadow-md transition-opacity', pickerOpen || menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
          {QUICK.map((r) => (
            <ActionButton key={r} label={reactionLabel(r)} onClick={() => react.mutate(r)}>
              <ReactionIcon reaction={r} className="size-4" />
            </ActionButton>
          ))}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Add reaction">
                <SmilePlus className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto gap-0.5 p-1" side="top">
              {REACTIONS.map((r) => (
                <Tooltip key={r.key} content={r.label} side="top">
                  <button
                    onClick={() => {
                      react.mutate(r.key);
                      setPickerOpen(false);
                    }}
                    className="grid size-8 place-items-center rounded-md transition hover:scale-110 hover:bg-surface-2"
                    aria-label={r.label}
                  >
                    <ReactionIcon reaction={r.key} className="size-[18px]" />
                  </button>
                </Tooltip>
              ))}
            </PopoverContent>
          </Popover>
          {onReply && !inThread && (
            <ActionButton label="Reply in thread" onClick={() => onReply(m)}>
              <MessageSquareReply className="size-4" />
            </ActionButton>
          )}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownTrigger asChild>
              <button className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Message actions">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownTrigger>
            <DropdownContent className="min-w-44">
              <DropdownItem onSelect={() => copy(m.body, 'Text')}>
                <Copy /> Copy text
              </DropdownItem>
              <DropdownItem onSelect={() => copy(`${window.location.origin}/app/chat/${m.channelId}#m-${m.id}`, 'Link')}>
                <Link2 /> Copy link
              </DropdownItem>
              {(mine || canModerate) && <DropdownSeparator />}
              {mine && (
                <DropdownItem onSelect={() => { setDraft(m.body); setEditing(true); }}>
                  <Pencil /> Edit message
                </DropdownItem>
              )}
              {(mine || canModerate) && (
                <DropdownItem danger onSelect={() => del.mutate()}>
                  <Trash2 /> Delete message
                </DropdownItem>
              )}
            </DropdownContent>
          </DropdownMenu>
        </div>
      )}
    </motion.div>
  );
}
