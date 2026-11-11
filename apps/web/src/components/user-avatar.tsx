'use client';
import { presenceMeta } from '@fg/shared';
import { PresenceIcon, TONE_BG } from '@/components/presence';
import { useLivePerson } from '@/lib/presence-store';
import type { Person } from '@/lib/types';
import { useEffect, useState } from 'react';
import { cn, initials } from '@/lib/utils';

type AvatarPerson = Pick<Person, 'id' | 'name' | 'avatarUrl' | 'avatarColor'> & Partial<Pick<Person, 'online' | 'presence' | 'statusEmoji' | 'statusText' | 'statusExpiresAt'>>;

const sizes = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-24 text-3xl' };
const dot = { xs: 'size-2', sm: 'size-2.5', md: 'size-3', lg: 'size-3.5', xl: 'size-5' };


/** Avatar with live online dot. Presence colour reflects the chosen status; grey when disconnected. */
export function UserAvatar({ person, size = 'md', showPresence = true, className }: { person: AvatarPerson; size?: keyof typeof sizes; showPresence?: boolean; className?: string }) {
  const live = useLivePerson({
    online: false,
    presence: 'available',
    statusEmoji: null,
    statusText: null,
    statusExpiresAt: null,
    ...person,
  });
  const meta = presenceMeta(live.presence);
  const color = live.online && live.presence !== 'offline' ? TONE_BG[meta.tone] : 'bg-subtle';
  // A photo link that no longer loads falls back to initials instead of a broken-image icon.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [person.avatarUrl]);
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {person.avatarUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={person.avatarUrl} alt="" onError={() => setBroken(true)} className={cn('rounded-full object-cover', sizes[size])} />
      ) : (
        <span className={cn('grid place-items-center rounded-full font-semibold ring-1 ring-inset ring-black/5 dark:ring-white/10', sizes[size])} style={{ background: `color-mix(in oklab, ${person.avatarColor} 16%, var(--surface))`, color: `color-mix(in oklab, ${person.avatarColor} 80%, var(--foreground))` }} aria-hidden>
          {initials(person.name)}
        </span>
      )}
      {showPresence && (
        <span
          className={cn('absolute right-0 bottom-0 rounded-full ring-2 ring-surface', dot[size], color, !live.online && 'opacity-90')}
          title={live.online ? meta.label : 'Offline'}
        />
      )}
    </span>
  );
}

/** Presence icon + status text used in lists. */
export function StatusLine({ person, className }: { person: Pick<Person, 'id' | 'online' | 'presence' | 'statusEmoji' | 'statusText' | 'statusExpiresAt'>; className?: string }) {
  const live = useLivePerson(person);
  const meta = presenceMeta(live.presence);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-muted', className)}>
      <PresenceIcon presence={live.presence} muted={!live.online} />
      <span className="truncate">{live.statusText || (live.online ? meta.label : 'Offline')}</span>
    </span>
  );
}
