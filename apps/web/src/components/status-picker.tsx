'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PRESENCE_PRESETS, presenceMeta, STATUS_EXPIRY_OPTIONS, type PresenceKey, type StatusExpiry } from '@fg/shared';
import { api, errorMessage } from '@/lib/api';
import { presenceStore } from '@/lib/presence-store';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';

const EMOJI_CHOICES = ['🚀', '🎯', '🔥', '🤒', '✈️', '🧪', '📞', '🎉', '🌴', '📚', '🛠️', '🙌'];

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
  const [emoji, setEmoji] = useState<string | null>(current.statusEmoji);
  const [text, setText] = useState(current.statusText ?? '');
  const [expiry, setExpiry] = useState<StatusExpiry>('never');

  const save = useMutation({
    mutationFn: (body: { presence: PresenceKey; emoji: string | null; text: string | null; expiry: StatusExpiry }) => api<{ statusExpiresAt: string | null }>('/me/status', { method: 'PUT', body }),
    onSuccess: (res, body) => {
      presenceStore.apply({ userId, presence: body.presence, statusEmoji: body.emoji, statusText: body.text, statusExpiresAt: res.statusExpiresAt });
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(`Status set to ${body.emoji ?? presenceMeta(body.presence).emoji} ${body.text || presenceMeta(body.presence).label}`);
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const quick = (key: PresenceKey) => {
    const m = presenceMeta(key);
    // A preset replaces any custom message (type a message below to customise).
    setPresence(key);
    setEmoji(m.emoji);
    setText('');
    save.mutate({ presence: key, emoji: m.emoji, text: null, expiry });
  };

  return (
    <div className="w-[320px] space-y-3">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Quick status</p>
        <div className="grid grid-cols-2 gap-1" role="listbox" aria-label="Quick status">
          {PRESENCE_PRESETS.map((p) => (
            <button
              key={p.key}
              role="option"
              aria-selected={presence === p.key}
              onClick={() => quick(p.key)}
              className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-surface-2', presence === p.key && 'bg-primary-soft text-primary')}
            >
              <span aria-hidden>{p.emoji}</span>
              <span className="truncate">{p.label}</span>
              {presence === p.key && <Check className="ml-auto size-3.5" />}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Custom message</p>
        <div className="flex flex-wrap gap-1">
          {EMOJI_CHOICES.map((e) => (
            <button key={e} onClick={() => setEmoji(e)} className={cn('grid size-8 place-items-center rounded-lg text-base transition hover:bg-surface-2 hover:scale-110', emoji === e && 'bg-primary-soft ring-1 ring-primary')} aria-label={`Use ${e}`}>
              {e}
            </button>
          ))}
        </div>
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder="What's your status?" aria-label="Status message" />
        <div className="flex items-center gap-2">
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value as StatusExpiry)} aria-label="Clear after" className="h-9">
            {STATUS_EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Clear: {o.label}
              </option>
            ))}
          </Select>
          <Button size="md" loading={save.isPending} onClick={() => save.mutate({ presence, emoji, text: text.trim() || null, expiry })}>
            Save
          </Button>
        </div>
        {(current.statusText || current.statusEmoji) && (
          <button className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => { setText(''); setEmoji(null); save.mutate({ presence: 'available', emoji: null, text: null, expiry: 'never' }); }}>
            Clear status
          </button>
        )}
      </div>
    </div>
  );
}
