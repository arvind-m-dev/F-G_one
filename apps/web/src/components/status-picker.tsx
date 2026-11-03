'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PRESENCE_PRESETS, presenceMeta, STATUS_EXPIRY_OPTIONS, type PresenceKey, type StatusExpiry } from '@fg/shared';
import { api, errorMessage } from '@/lib/api';
import { presenceStore } from '@/lib/presence-store';
import { cn } from '@/lib/utils';
import { PresenceIcon } from './presence';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';

const SUGGESTIONS = ['Working on QA', 'In a meeting', 'Focus time', 'On a break', 'Out of office'];

/** Presence picker. Only changes availability — attendance is never modified here. */
export function StatusPicker({
  current,
  userId,
  onDone,
}: {
  current: { presence: string; statusEmoji: string | null; statusText: string | null };
  userId: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [presence, setPresence] = useState<PresenceKey>((current.presence as PresenceKey) ?? 'available');
  const [text, setText] = useState(current.statusText ?? '');
  const [expiry, setExpiry] = useState<StatusExpiry>('never');

  const save = useMutation({
    mutationFn: (body: { presence: PresenceKey; emoji: null; text: string | null; expiry: StatusExpiry }) => api<{ statusExpiresAt: string | null }>('/me/status', { method: 'PUT', body }),
    onSuccess: (res, body) => {
      presenceStore.apply({ userId, presence: body.presence, statusEmoji: null, statusText: body.text, statusExpiresAt: res.statusExpiresAt });
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(`Status: ${body.text || presenceMeta(body.presence).label}`);
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // A preset replaces any custom message (type a message below to customise).
  const quick = (key: PresenceKey) => {
    setPresence(key);
    setText('');
    save.mutate({ presence: key, emoji: null, text: null, expiry });
  };

  return (
    <div className="w-[340px]">
      <div className="mb-3">
        <div className="relative">
          <PresenceIcon presence={presence} className="absolute top-1/2 left-3 -translate-y-1/2" />
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder="What are you working on?" aria-label="Status message" className="pr-8 pl-9" />
          {text && (
            <button onClick={() => setText('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-foreground" aria-label="Clear message">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => setText(s)} className="rounded-md border px-2 py-0.5 text-[11px] text-muted transition hover:border-border-strong hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-1 px-1 text-[11px] font-medium tracking-wide text-subtle uppercase">Availability</p>
      <div className="grid grid-cols-2 gap-0.5" role="listbox" aria-label="Quick status">
        {PRESENCE_PRESETS.map((p) => (
          <button
            key={p.key}
            role="option"
            aria-selected={presence === p.key}
            onClick={() => quick(p.key)}
            className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition hover:bg-surface-2', presence === p.key && 'bg-primary-soft text-primary-ink')}
          >
            <PresenceIcon presence={p.key} />
            <span className="truncate">{p.label}</span>
            {presence === p.key && <Check className="ml-auto size-3.5" />}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        <Select value={expiry} onChange={(e) => setExpiry(e.target.value as StatusExpiry)} aria-label="Clear after" className="h-8 text-[13px]">
          {STATUS_EXPIRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Clear: {o.label}
            </option>
          ))}
        </Select>
        <Button loading={save.isPending} onClick={() => save.mutate({ presence, emoji: null, text: text.trim() || null, expiry })}>
          Save
        </Button>
      </div>
      {current.statusText && (
        <button
          className="mt-2 text-xs text-muted underline-offset-2 hover:underline"
          onClick={() => {
            setText('');
            save.mutate({ presence: 'available', emoji: null, text: null, expiry: 'never' });
          }}
        >
          Clear status
        </button>
      )}
    </div>
  );
}
