'use client';
import { SendHorizonal, Smile } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RT } from '@fg/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { useRealtime } from '@/lib/realtime';
import { cn } from '@/lib/utils';

const EMOJIS = ['😀', '😂', '😊', '😍', '🤔', '😅', '🙌', '👍', '👏', '🙏', '🎉', '🔥', '✅', '🚀', '💯', '❤️', '👀', '☕', '🍕', '🎂'];

export function Composer({ channelId, placeholder, onSend, initial, disabled }: { channelId: string; placeholder: string; onSend: (body: string) => void; initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const { socket } = useRealtime();
  const typingRef = useRef<{ active: boolean; timer?: ReturnType<typeof setTimeout> }>({ active: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    ref.current?.focus();
  }, [channelId]);

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

  return (
    <div className="rounded-2xl border bg-surface shadow-sm transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary-soft">
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        maxLength={4000}
        placeholder={placeholder}
        aria-label="Message"
        className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14.5px] outline-none placeholder:text-muted"
      />
      <div className="flex items-center justify-between px-2 pb-2">
        <Popover>
          <PopoverTrigger asChild>
            <button className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-foreground" aria-label="Insert emoji">
              <Smile className="size-4.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="grid w-auto grid-cols-10 gap-0.5 p-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                className="grid size-8 place-items-center rounded-md text-lg transition hover:scale-110 hover:bg-surface-2"
                onClick={() => {
                  setValue((v) => v + e);
                  ref.current?.focus();
                }}
              >
                {e}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-muted sm:inline">
            <b>Enter</b> to send · <b>Shift+Enter</b> new line
          </span>
          <button
            onClick={send}
            disabled={!value.trim() || disabled}
            className={cn('grid size-8 place-items-center rounded-lg transition', value.trim() ? 'bg-primary text-white hover:brightness-110' : 'bg-surface-2 text-muted')}
            aria-label="Send message"
          >
            <SendHorizonal className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
