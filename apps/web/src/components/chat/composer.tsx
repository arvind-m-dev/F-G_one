'use client';
import { AtSign, CornerDownLeft, SendHorizonal } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { RT } from '@fg/shared';
import { Tooltip } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { draftKey, getDraft, setDraft } from '@/lib/drafts';
import { useModKey } from '@/lib/platform';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import type { ChannelDetails } from '@/lib/types';
import { cn } from '@/lib/utils';
import { mentionHandles } from './cache';

type Member = ChannelDetails['members'][number];

/** The "@que" being typed just before the caret, if any. */
function mentionAt(text: string, caret: number) {
  const m = /(^|[\s(])@([\w.-]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase() } : null;
}

export function Composer({
  channelId,
  parentId,
  placeholder,
  onSend,
  initial,
  members = [],
  onEditLast,
  disabled,
}: {
  channelId: string;
  /** Set when replying in a thread: the draft is kept per thread and typing isn't announced to the channel. */
  parentId?: string;
  placeholder: string;
  onSend: (body: string) => void;
  initial?: string;
  /** People who can be mentioned here (the conversation's members). */
  members?: Member[];
  /** Up arrow in an empty box edits your last message. */
  onEditLast?: () => void;
  disabled?: boolean;
}) {
  const me = useSession();
  const mod = useModKey();
  const enterToSend = me.preferences.enterToSend !== false;
  const key = draftKey(channelId, parentId);
  const [value, setValue] = useState(() => initial ?? getDraft(key));
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const { socket } = useRealtime();
  const typingRef = useRef<{ active: boolean; timer?: ReturnType<typeof setTimeout> }>({ active: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);
  // Focus the box on open where there is a keyboard; on touch screens that would cover the messages with the on-screen keyboard.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, [channelId]);

  const people = useMemo(
    () =>
      members
        .filter((m) => m.id !== me.user.id)
        .map((m) => ({ member: m, handle: mentionHandles(m)[0] }))
        .filter((x): x is { member: Member; handle: string } => !!x.handle),
    [members, me.user.id],
  );
  const matches = mention
    ? people
        .filter(({ member, handle }) => {
          const q = mention.query;
          return !q || handle.toLowerCase().startsWith(q) || member.name.toLowerCase().includes(q) || member.lastName.toLowerCase().startsWith(q);
        })
        .slice(0, 6)
    : [];
  const open = !!mention;
  const current = Math.min(active, Math.max(0, matches.length - 1));

  const stopTyping = () => {
    if (typingRef.current.active) socket?.emit(RT.TYPING, { channelId, typing: false });
    typingRef.current.active = false;
    clearTimeout(typingRef.current.timer);
  };
  const update = (v: string, caret: number) => {
    setValue(v);
    setDraft(key, v);
    setMention(mentionAt(v, caret));
    setActive(0);
  };
  const onType = (v: string, caret: number) => {
    update(v, caret);
    // A thread is a side conversation: don't show "typing…" to the whole channel.
    if (!socket || parentId) return;
    if (!typingRef.current.active && v.trim()) {
      socket.emit(RT.TYPING, { channelId, typing: true });
      typingRef.current.active = true;
    }
    clearTimeout(typingRef.current.timer);
    typingRef.current.timer = setTimeout(stopTyping, 2500);
  };
  const send = () => {
    const body = value.trim();
    if (!body || disabled) return;
    onSend(body);
    update('', 0);
    stopTyping();
  };
  /** Replaces text[from, to) and puts the caret after the inserted text. */
  const replaceRange = (from: number, to: number, text: string) => {
    const next = value.slice(0, from) + text + value.slice(to);
    const caret = from + text.length;
    update(next, caret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };
  const pick = (handle: string) => {
    if (!mention) return;
    replaceRange(mention.start, ref.current?.selectionStart ?? value.length, `@${handle} `);
  };
  const startMention = () => {
    const caret = ref.current?.selectionStart ?? value.length;
    const needsSpace = caret > 0 && !/\s/.test(value[caret - 1]!);
    replaceRange(caret, ref.current?.selectionEnd ?? caret, `${needsSpace ? ' ' : ''}@`);
  };

  return (
    <div className="relative rounded-xl border border-border-strong bg-surface shadow-sm transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_var(--primary-soft)]">
      {open && (
        <ul id={listId} role="listbox" aria-label="People you can mention" className="absolute bottom-full left-0 z-20 mb-2 w-72 max-w-full overflow-hidden rounded-xl border bg-elevated p-1 shadow-lg">
          {matches.length === 0 ? (
            <li className="px-2.5 py-2 text-[13px] text-muted">{people.length ? 'No one in this conversation matches.' : 'There is no one else here to mention.'}</li>
          ) : (
            matches.map(({ member, handle }, i) => (
              <li key={member.id} id={`${listId}-${i}`} role="option" aria-selected={i === current}>
                <button
                  type="button"
                  // Keep focus in the text box so typing continues after a click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(handle)}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', i === current && 'bg-surface-2')}
                >
                  <UserAvatar person={member} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{member.name}</span>
                  <span className="shrink-0 truncate font-mono text-[11px] text-muted">@{handle.toLowerCase()}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => onType(e.target.value, e.target.selectionStart)}
        onSelect={(e) => {
          const next = mentionAt(value, e.currentTarget.selectionStart);
          if (next?.start !== mention?.start || next?.query !== mention?.query) setMention(next);
        }}
        onBlur={() => setMention(null)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open) {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setMention(null);
              return;
            }
            if (matches.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((current + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(matches[current]!.handle);
                return;
              }
            }
          }
          if (e.key === 'ArrowUp' && !value && onEditLast) {
            e.preventDefault();
            onEditLast();
            return;
          }
          if (e.key !== 'Enter') return;
          const sendKey = enterToSend ? !e.shiftKey : e.metaKey || e.ctrlKey;
          if (sendKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        maxLength={4000}
        placeholder={placeholder}
        aria-label="Message"
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && matches.length ? `${listId}-${current}` : undefined}
        className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] outline-none placeholder:text-subtle"
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <Tooltip content="Mention someone" side="top">
          <button type="button" onClick={startMention} className="grid size-8 place-items-center rounded-md text-subtle transition hover:bg-surface-2 hover:text-foreground" aria-label="Mention someone">
            <AtSign className="size-4" />
          </button>
        </Tooltip>
        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-1 text-[11px] text-subtle sm:flex">
            <CornerDownLeft className="size-3" /> {enterToSend ? 'to send · Shift+Enter for a new line' : `${mod}+Enter to send`}
          </span>
          <button
            type="button"
            onClick={send}
            disabled={!value.trim() || disabled}
            className={cn('grid size-8 place-items-center rounded-lg transition', value.trim() ? 'bg-primary text-primary-foreground shadow-sm hover:brightness-110' : 'bg-surface-2 text-subtle')}
            aria-label="Send message"
          >
            <SendHorizonal className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
