import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '@/lib/types';

export type MessagePage = { items: ChatMessage[]; hasMore: boolean };
export type MessagePages = InfiniteData<MessagePage, string | undefined>;

/** Every cached list a message can appear in: its channel, its thread, and the thread it starts. */
const listKeys = (m: Pick<ChatMessage, 'channelId' | 'parentId'>) => [['messages', m.channelId], ...(m.parentId ? [['thread', m.parentId]] : [])];

/**
 * Applies a change to one message everywhere it is cached and returns an undo function.
 * Used so reactions, edits and deletes show at once instead of waiting for the server echo.
 */
export function patchMessage(qc: QueryClient, m: Pick<ChatMessage, 'id' | 'channelId' | 'parentId'>, change: (old: ChatMessage) => ChatMessage) {
  const undo: (() => void)[] = [];
  for (const key of listKeys(m)) {
    const before = qc.getQueryData<MessagePages>(key);
    if (!before) continue;
    undo.push(() => qc.setQueryData(key, before));
    qc.setQueryData<MessagePages>(key, { ...before, pages: before.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === m.id ? change(x) : x)) })) });
  }
  const single = qc.getQueryData<ChatMessage>(['message', m.id]);
  if (single) {
    undo.push(() => qc.setQueryData(['message', m.id], single));
    qc.setQueryData<ChatMessage>(['message', m.id], change(single));
  }
  return () => undo.forEach((u) => u());
}

/** Adds or removes one person's reaction, the same way the server toggles it. */
export function toggleReaction(m: ChatMessage, emoji: string, userId: string): ChatMessage {
  const existing = m.reactions.find((r) => r.emoji === emoji);
  if (!existing) return { ...m, reactions: [...m.reactions, { emoji, userIds: [userId], count: 1 }] };
  const mine = existing.userIds.includes(userId);
  const userIds = mine ? existing.userIds.filter((id) => id !== userId) : [...existing.userIds, userId];
  return { ...m, reactions: m.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds, count: userIds.length } : r)).filter((r) => r.count > 0) };
}

/** Mention handles the server recognises for a person: @first, @first.last and @displayname (no spaces). */
export function mentionHandles(p: { name: string; firstName: string; lastName: string }) {
  const valid = (h: string) => /^[A-Za-z][\w.-]*$/.test(h);
  const full = `${p.firstName}.${p.lastName}`;
  const display = p.name !== `${p.firstName} ${p.lastName}` ? p.name.replace(/\s+/g, '') : '';
  return [full, p.firstName, display].filter((h) => h && valid(h));
}

/** A mention token as the server compares it: lower case, without trailing dots or dashes. */
export const normalizeMention = (token: string) => token.replace(/^@/, '').toLowerCase().replace(/[.-]+$/, '');
