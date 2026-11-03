import { Hash, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

// Same palette as people's avatar colours, so channels sit in the same visual family.
const CHANNEL_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#22c55e'];

/** Stable colour per channel: same channel, same colour, for everyone. */
export function channelColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CHANNEL_COLORS[h % CHANNEL_COLORS.length]!;
}

const sizes = { sm: 'size-8 rounded-lg [&_svg]:size-3.5', md: 'size-9 rounded-lg [&_svg]:size-4', lg: 'size-12 rounded-xl [&_svg]:size-6' } as const;

/** Tinted channel badge: # for public, lock for private. */
export function ChannelIcon({ channel, size = 'sm', className }: { channel: { id: string; type: string }; size?: keyof typeof sizes; className?: string }) {
  const color = channelColor(channel.id);
  return (
    <span
      className={cn('grid shrink-0 place-items-center ring-1 ring-black/5 ring-inset dark:ring-white/10', sizes[size], className)}
      style={{ background: `color-mix(in oklab, ${color} 16%, var(--surface))`, color: `color-mix(in oklab, ${color} 80%, var(--foreground))` }}
      aria-hidden
    >
      {channel.type === 'PRIVATE' ? <Lock strokeWidth={2.2} /> : <Hash strokeWidth={2.2} />}
    </span>
  );
}
