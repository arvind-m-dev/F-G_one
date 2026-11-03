'use client';
import { AtSign, CornerDownLeft, SendHorizonal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RT } from '@fg/shared';
import { Tooltip } from '@/components/ui/misc';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export function Composer({ channelId, placeholder, onSend, initial, disabled }: { channelId: string; placeholder: string; onSend: (body: string) => void; initial?: string; disabled?: boolean }) {
  const me = useSession();
  const enterToSend = me.preferences.enterToSend !== false;
  const [value, setValue] = useState(initial ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const { socket } = useRealtime();
  const typingRef = useRef<{ active: boolean; timer?: ReturnType<typeof setTimeout> }>({ active: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);
  useEffect(() => ref.current?.focus(), [channelId]);

  const stopTyping = () => {
    if (typingRef.current.active) socket?.emit(RT.TYPING, { channelId, typing: false });
    typingRef.current.active = false;
    clearTimeout(typingRef.current.timer);
  };
  const onType = (v: string) => {
    setValue(v);
    if (!socket) return;
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
    setValue('');
    stopTyping();
  };
  const insert = (text: string) => {
    setValue((v) => (v && !v.endsWith(' ') ? `${v} ${text}` : v + text));
    ref.current?.focus();
  };

  return (
    <div className="rounded-xl border border-border-strong bg-surface shadow-sm transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_var(--primary-soft)]">
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
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
        className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] outline-none placeholder:text-subtle"
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <Tooltip content="Mention someone" side="top">
          <button onClick={() => insert('@')} className="grid size-7 place-items-center rounded-md text-subtle transition hover:bg-surface-2 hover:text-foreground" aria-label="Mention">
            <AtSign className="size-4" />
          </button>
        </Tooltip>
        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-1 text-[11px] text-subtle sm:flex">
            <CornerDownLeft className="size-3" /> {enterToSend ? 'to send · Shift+Enter for a new line' : '⌘/Ctrl+Enter to send'}
          </span>
          <button
            onClick={send}
            disabled={!value.trim() || disabled}
            className={cn('grid size-8 place-items-center rounded-lg transition', value.trim() ? 'bg-primary text-white shadow-sm hover:brightness-110' : 'bg-surface-2 text-subtle')}
            aria-label="Send message"
          >
            <SendHorizonal className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
