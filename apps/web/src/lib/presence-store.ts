'use client';
import { useSyncExternalStore } from 'react';
import type { PresenceEvent } from '@fg/shared';
import type { Person } from './types';

/**
 * Live presence overlay. Server payloads give a snapshot; socket events patch it here
 * so every avatar on screen updates instantly without refetching.
 */
type Patch = Partial<Pick<Person, 'online' | 'presence' | 'statusEmoji' | 'statusText' | 'statusExpiresAt'>>;
const patches = new Map<string, Patch>();
let online = new Set<string>();
let snapshotReceived = false;
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export const presenceStore = {
  apply(evt: PresenceEvent) {
    const prev = patches.get(evt.userId) ?? {};
    const next: Patch = { ...prev };
    if (evt.online !== undefined) {
      next.online = evt.online;
      if (evt.online) online.add(evt.userId);
      else online.delete(evt.userId);
    }
    if (evt.presence !== undefined) {
      next.presence = evt.presence;
      next.statusEmoji = evt.statusEmoji ?? null;
      next.statusText = evt.statusText ?? null;
      next.statusExpiresAt = evt.statusExpiresAt ?? null;
    }
    patches.set(evt.userId, next);
    emit();
  },
  setOnline(ids: string[]) {
    online = new Set(ids);
    snapshotReceived = true;
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const getVersion = () => version;

export function useLivePerson<T extends Pick<Person, 'id' | 'online' | 'presence' | 'statusEmoji' | 'statusText' | 'statusExpiresAt'>>(p: T): T {
  useSyncExternalStore(presenceStore.subscribe, getVersion, getVersion);
  const patch = patches.get(p.id);
  const merged = { ...p, ...patch } as T;
  if (snapshotReceived) merged.online = online.has(p.id);
  if (merged.statusExpiresAt && new Date(merged.statusExpiresAt).getTime() < Date.now()) {
    return { ...merged, presence: 'available', statusEmoji: null, statusText: null, statusExpiresAt: null };
  }
  return merged;
}
