'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Copy, Link2, MessageSquareReply, MoreHorizontal, Pencil, RotateCw, SmilePlus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { REACTIONS } from '@fg/shared';
import { reactionLabel, ReactionIcon } from '@/components/presence';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { Textarea } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useModKey } from '@/lib/platform';
import { useClock, useSession } from '@/lib/session';
import type { ChatMessage } from '@/lib/types';
import { cn, fmtDateTime } from '@/lib/utils';
import { normalizeMention, patchMessage, toggleReaction } from './cache';

const QUICK = ['thumbs-up', 'check', 'eyes'] as const;

/** Splits punctuation that ends a sentence (not the link) off a matched URL: "see https://x.com." links only "https://x.com". */
export function splitUrl(raw: string): [string, string] {
  let url = raw;
  let tail = '';
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  while (url.length > 8) {
    const ch = url[url.length - 1]!;
    if ('.,;:!?\'"'.includes(ch) || (closers[ch] && !url.includes(closers[ch]))) {
      tail = ch + tail;
      url = url.slice(0, -1);
    } else break;
  }
  return [url, tail];
}

/**
 * Renders links and @mentions safely (React escapes text; no HTML injection).
 * Only a mention of someone in this conversation is highlighted, so an email address or a stray "@" stays plain text.
 */
function RichText({ text, mentionables }: { text: string; mentionables?: Set<string> }) {
  const parts = text.split(/(https?:\/\/[^\s]+|(?<![\w@.])@[A-Za-z][\w.-]*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p)) {
          const [url, tail] = splitUrl(p);
          return (
            <span key={i}>
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
                {url}
              </a>
              {tail}
            </span>
          );
        }
        if (p.startsWith('@') && mentionables?.has(normalizeMention(p))) {
          const handle = p.replace(/[.-]+$/, '');
          return (
            <span key={i}>
              <span className="rounded bg-primary-soft px-1 font-medium text-primary-ink">{handle}</span>
              {p.slice(handle.length)}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
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

/** "Asha, Ravi and you": who added a reaction. */
function reactors(userIds: string[], meId: string, nameOf?: (id: string) => string | undefined) {
  const others = userIds.filter((id) => id !== meId).map((id) => nameOf?.(id)).filter((n): n is string => !!n);
  const shown = others.slice(0, 3);
  const mine = userIds.includes(meId);
  const rest = userIds.length - shown.length - (mine ? 1 : 0);
  const parts = [...shown, ...(mine ? ['you'] : []), ...(rest > 0 ? [`${rest} more`] : [])];
  if (!parts.length) return '';
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return text[0]!.toUpperCase() + text.slice(1);
}

export function MessageItem({
  m,
  compact,
  meId,
  canModerate,
  onReply,
  inThread,
  editing,
  onEditingChange,
  onRetry,
  onDiscard,
  nameOf,
  mentionables,
}: {
  m: ChatMessage;
  compact: boolean;
  meId: string;
  canModerate: boolean;
  onReply?: (m: ChatMessage) => void;
  inThread?: boolean;
  /** Controlled edit mode (the list opens it for "Up arrow edits your last message"). Uncontrolled when omitted. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** For a message that failed to send. */
  onRetry?: (m: ChatMessage) => void;
  onDiscard?: (m: ChatMessage) => void;
  /** Member name for a user id, to say who reacted. */
  nameOf?: (id: string) => string | undefined;
  /** Mention handles (lower case) of the people in this conversation. */
  mentionables?: Set<string>;
}) {
  const qc = useQueryClient();
  const me = useSession();
  const mod = useModKey();
  const { time, h24 } = useClock();
  const enterToSave = me.preferences.enterToSend !== false;
  const [localEditing, setLocalEditing] = useState(false);
  const isEditing = editing ?? localEditing;
  const setEditing = (v: boolean) => (onEditingChange ? onEditingChange(v) : setLocalEditing(v));
  const [draft, setDraft] = useState(m.body);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // null until first asked, so the dialog isn't mounted for every message.
  const [askDelete, setAskDelete] = useState<boolean | null>(null);
  const mine = m.author?.id === meId;

  // Opening the editor always starts from the saved text.
  useEffect(() => {
    if (isEditing) setDraft(m.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // Changes show at once and are undone if the server refuses them; the server's copy replaces ours when it answers.
  const settle = (saved: ChatMessage | null) => {
    if (saved?.id) patchMessage(qc, m, (old) => ({ ...old, ...saved }));
  };
  const react = useMutation({
    mutationFn: (emoji: string) => api<ChatMessage>(`/messages/${m.id}/reactions`, { body: { emoji } }),
    onMutate: (emoji) => ({ undo: patchMessage(qc, m, (old) => toggleReaction(old, emoji, meId)) }),
    onSuccess: settle,
    onError: (e, _v, ctx) => {
      ctx?.undo();
      toast.error(errorMessage(e));
    },
  });
  const edit = useMutation({
    mutationFn: (body: string) => api<ChatMessage>(`/messages/${m.id}`, { method: 'PATCH', body: { body } }),
    onMutate: (body) => {
      setEditing(false);
      return { undo: patchMessage(qc, m, (old) => ({ ...old, body, editedAt: new Date().toISOString() })) };
    },
    onSuccess: settle,
    onError: (e, body, ctx) => {
      ctx?.undo();
      setEditing(true);
      // After the editor reopens with the saved text, put back what was being written.
      setTimeout(() => setDraft(body), 0);
      toast.error(errorMessage(e));
    },
  });
  const del = useMutation({
    mutationFn: () => api<ChatMessage>(`/messages/${m.id}`, { method: 'DELETE' }),
    onMutate: () => {
      setAskDelete(false);
      return { undo: patchMessage(qc, m, (old) => ({ ...old, deleted: true })) };
    },
    onSuccess: (saved) => {
      settle(saved);
      toast.success('Message deleted');
    },
    onError: (e, _v, ctx) => {
      ctx?.undo();
      toast.error(errorMessage(e));
    },
  });

  const saveEdit = () => {
    const body = draft.trim();
    if (!body) return;
    if (body === m.body) setEditing(false);
    else edit.mutate(body);
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy. Your browser blocked access to the clipboard.");
    }
  };
  const author = m.author ?? { id: 'x', name: 'Former employee', avatarUrl: null, avatarColor: 'var(--subtle)' };

  return (
    <motion.div
      initial={m.pending ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: m.pending ? 0.55 : 1, y: 0 }}
      id={`m-${m.id}`}
      // Focusable so a tap on a touch screen (no hover) reveals the message actions.
      tabIndex={-1}
      className={cn(
        'group relative flex gap-3 px-5 outline-none transition-colors hover:bg-surface-2/50 focus-within:bg-surface-2/50 data-[highlight=true]:bg-primary-soft [[data-density=compact]_&]:gap-2.5',
        compact ? 'py-0.5' : 'mt-3 pt-1 pb-0.5 [[data-density=compact]_&]:mt-1.5',
        (pickerOpen || menuOpen) && 'bg-surface-2/50',
      )}
      data-testid="message"
    >
      <div className="w-9 shrink-0 [[data-density=compact]_&]:w-7">
        {compact ? (
          <span className="invisible block pt-[3px] text-right text-[10px] text-subtle tabular-nums group-focus-within:visible group-hover:visible">{time(m.createdAt)}</span>
        ) : (
          <UserAvatar person={author} size="md" showPresence={false} className="mt-0.5 [[data-density=compact]_&]:scale-[0.8]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-semibold">{author.name}</span>
            <span className="text-[11px] text-subtle tabular-nums" title={fmtDateTime(m.createdAt, h24)}>
              {time(m.createdAt)}
            </span>
          </div>
        )}
        {m.deleted ? (
          <p className="text-sm text-subtle italic">This message was deleted.</p>
        ) : isEditing ? (
          <div className="my-1 space-y-1.5">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              rows={2}
              maxLength={4000}
              aria-label="Edited text"
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                }
                if (e.key === 'Enter' && (enterToSave ? !e.shiftKey : e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveEdit();
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={saveEdit} disabled={!draft.trim()}>
                Save changes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <span className="hidden text-[11px] text-muted sm:inline">{enterToSave ? 'Enter to save' : `${mod}+Enter to save`} · Esc to cancel</span>
            </div>
          </div>
        ) : (
          <p className="text-[14.5px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/90">
            <RichText text={m.body} mentionables={mentionables} />
            {m.editedAt && <span className="ml-1 text-[11px] text-subtle">(edited)</span>}
          </p>
        )}

        {m.failed && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-danger" role="alert">
            <span className="flex items-center gap-1">
              <CircleAlert className="size-3.5" /> Not sent
            </span>
            <button type="button" onClick={() => onRetry?.(m)} className="flex items-center gap-1 font-medium text-primary hover:underline">
              <RotateCw className="size-3" /> Try again
            </button>
            <button type="button" onClick={() => onDiscard?.(m)} className="font-medium text-muted hover:text-foreground hover:underline">
              Delete
            </button>
          </p>
        )}

        {m.reactions.length > 0 && !m.deleted && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.reactions.map((r) => {
              const reacted = r.userIds.includes(meId);
              const who = reactors(r.userIds, meId, nameOf);
              return (
                <Tooltip key={r.emoji} side="top" content={who ? `${who} · ${reactionLabel(r.emoji)}` : reactionLabel(r.emoji)}>
                  <motion.button
                    layout
                    whileTap={{ scale: 0.92 }}
                    onClick={() => react.mutate(r.emoji)}
                    className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition', reacted ? 'border-primary/40 bg-primary-soft text-primary-ink' : 'bg-surface hover:border-border-strong')}
                    aria-pressed={reacted}
                    aria-label={`${reactionLabel(r.emoji)} ${r.count}`}
                  >
                    <ReactionIcon reaction={r.emoji} />
                    <span className="font-medium tabular-nums">{r.count}</span>
                  </motion.button>
                </Tooltip>
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

      {!m.deleted && !m.pending && !m.failed && !isEditing && (
        <div className={cn('absolute -top-3.5 right-5 flex items-center gap-px rounded-lg border bg-elevated p-0.5 shadow-md transition-opacity', pickerOpen || menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100')}>
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
              <DropdownItem onSelect={() => copy(`${window.location.origin}/app/chat/${m.channelId}${m.parentId ? `?thread=${m.parentId}` : ''}#m-${m.id}`, 'Link')}>
                <Link2 /> Copy link
              </DropdownItem>
              {(mine || canModerate) && <DropdownSeparator />}
              {mine && (
                <DropdownItem onSelect={() => setEditing(true)}>
                  <Pencil /> Edit message
                </DropdownItem>
              )}
              {(mine || canModerate) && (
                <DropdownItem danger onSelect={() => setAskDelete(true)}>
                  <Trash2 /> Delete message
                </DropdownItem>
              )}
            </DropdownContent>
          </DropdownMenu>
        </div>
      )}

      {askDelete !== null && (
        <ConfirmDialog
          open={askDelete}
          onOpenChange={setAskDelete}
          title="Delete this message?"
          description={`${mine ? 'It' : `${author.name}'s message`} will be removed for everyone in this conversation. This can't be undone.`}
          confirmLabel="Delete"
          danger
          loading={del.isPending}
          onConfirm={() => del.mutate()}
        />
      )}
    </motion.div>
  );
}
