'use client';
import { useSyncExternalStore } from 'react';

/**
 * Unsent chat messages, kept per conversation (and per thread) for this tab, so switching
 * conversations or refreshing never loses what was being written. Cleared on sign-out.
 */
const KEY = 'fg.drafts';
let drafts: Record<string, string> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  if (drafts) return drafts;
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}');
    drafts = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    drafts = {};
  }
  return drafts;
}

export const draftKey = (channelId: string, parentId?: string) => (parentId ? `${channelId}:${parentId}` : channelId);

export function getDraft(key: string) {
  return typeof window === 'undefined' ? '' : (load()[key] ?? '');
}

export function setDraft(key: string, text: string) {
  const all = { ...load() };
  if (text.trim()) all[key] = text;
  else delete all[key];
  drafts = all;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the draft still lives in memory for this page */
  }
  listeners.forEach((l) => l());
}

export function clearDrafts() {
  drafts = {};
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The saved draft for a conversation, live (the conversation list shows it as a preview). */
export function useDraft(key: string) {
  return useSyncExternalStore(
    subscribe,
    () => getDraft(key),
    () => '',
  );
}
