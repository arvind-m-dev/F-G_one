'use client';
import {
  BellOff,
  Building2,
  CalendarClock,
  Check,
  Circle,
  CircleDashed,
  CircleMinus,
  Coffee,
  Eye,
  Flame,
  Footprints,
  Headphones,
  Heart,
  House,
  Laptop,
  Laugh,
  Moon,
  PartyPopper,
  Rocket,
  ThumbsUp,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { presenceMeta, REACTIONS, type PresenceTone } from '@fg/shared';
import { cn } from '@/lib/utils';

export const PRESENCE_ICONS: Record<string, LucideIcon> = {
  available: Circle,
  busy: CircleMinus,
  away: Moon,
  working: Laptop,
  wfh: House,
  in_office: Building2,
  short_break: Coffee,
  lunch: UtensilsCrossed,
  meeting: CalendarClock,
  focus: Headphones,
  stepped_out: Footprints,
  dnd: BellOff,
  offline: CircleDashed,
};

export const TONE_TEXT: Record<PresenceTone, string> = {
  green: 'text-emerald-500',
  red: 'text-rose-500',
  amber: 'text-amber-500',
  gray: 'text-subtle',
};
export const TONE_BG: Record<PresenceTone, string> = {
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
  amber: 'bg-amber-400',
  gray: 'bg-slate-400',
};

export function PresenceIcon({ presence, className, muted }: { presence: string; className?: string; muted?: boolean }) {
  const meta = presenceMeta(presence);
  const Icon = PRESENCE_ICONS[meta.key] ?? Circle;
  return <Icon className={cn('size-3.5 shrink-0', muted ? 'text-subtle' : TONE_TEXT[meta.tone], meta.key === 'available' && 'fill-current', className)} aria-hidden />;
}

export const REACTION_ICONS: Record<string, LucideIcon> = {
  'thumbs-up': ThumbsUp,
  heart: Heart,
  laugh: Laugh,
  party: PartyPopper,
  check: Check,
  eyes: Eye,
  flame: Flame,
  rocket: Rocket,
};
export const REACTION_COLORS: Record<string, string> = {
  'thumbs-up': 'text-sky-500',
  heart: 'text-rose-500',
  laugh: 'text-amber-500',
  party: 'text-violet-500',
  check: 'text-emerald-500',
  eyes: 'text-cyan-500',
  flame: 'text-orange-500',
  rocket: 'text-indigo-500',
};
export const reactionLabel = (key: string) => REACTIONS.find((r) => r.key === key)?.label ?? key;

export function ReactionIcon({ reaction, className }: { reaction: string; className?: string }) {
  const Icon = REACTION_ICONS[reaction];
  if (!Icon) return <span className={className}>{reaction}</span>;
  return <Icon className={cn('size-3.5', REACTION_COLORS[reaction], className)} aria-hidden />;
}
