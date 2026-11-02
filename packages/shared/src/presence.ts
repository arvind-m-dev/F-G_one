/**
 * Presence (availability) is intentionally separate from attendance records.
 * Each preset maps to a Lucide icon on the web (see components/presence.tsx); no emojis.
 * `tone` drives the avatar dot colour, `group` drives "team pulse" grouping.
 */
export const PRESENCE_PRESETS = [
  { key: 'available', label: 'Available', tone: 'green', group: 'available' },
  { key: 'busy', label: 'Busy', tone: 'red', group: 'busy' },
  { key: 'away', label: 'Away', tone: 'amber', group: 'away' },
  { key: 'working', label: 'Working', tone: 'green', group: 'available' },
  { key: 'wfh', label: 'Working from home', tone: 'green', group: 'available' },
  { key: 'in_office', label: 'In the office', tone: 'green', group: 'available' },
  { key: 'short_break', label: 'Short break', tone: 'amber', group: 'away' },
  { key: 'lunch', label: 'Lunch break', tone: 'amber', group: 'away' },
  { key: 'meeting', label: 'In a meeting', tone: 'red', group: 'busy' },
  { key: 'focus', label: 'Focus time', tone: 'red', group: 'busy' },
  { key: 'stepped_out', label: 'Stepped out', tone: 'amber', group: 'away' },
  { key: 'dnd', label: 'Do not disturb', tone: 'red', group: 'busy' },
  { key: 'offline', label: 'Appear offline', tone: 'gray', group: 'offline' },
] as const;

export type PresenceKey = (typeof PRESENCE_PRESETS)[number]['key'];
export type PresenceTone = (typeof PRESENCE_PRESETS)[number]['tone'];
export type PresenceGroup = (typeof PRESENCE_PRESETS)[number]['group'];
export const PRESENCE_KEYS = PRESENCE_PRESETS.map((p) => p.key) as [PresenceKey, ...PresenceKey[]];

export function presenceMeta(key: string | null | undefined) {
  return PRESENCE_PRESETS.find((p) => p.key === key) ?? PRESENCE_PRESETS[0];
}

export const STATUS_EXPIRY_OPTIONS = [
  { value: 'never', label: "Don't clear" },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'today', label: 'End of today' },
] as const;
export type StatusExpiry = (typeof STATUS_EXPIRY_OPTIONS)[number]['value'];

/** Message reactions are a fixed, icon-based set (stored by key). */
export const REACTIONS = [
  { key: 'thumbs-up', label: 'Agree' },
  { key: 'heart', label: 'Love' },
  { key: 'laugh', label: 'Funny' },
  { key: 'party', label: 'Celebrate' },
  { key: 'check', label: 'Done' },
  { key: 'eyes', label: 'Looking' },
  { key: 'flame', label: 'Great' },
  { key: 'rocket', label: 'Ship it' },
] as const;
export type ReactionKey = (typeof REACTIONS)[number]['key'];
export const REACTION_KEYS = REACTIONS.map((r) => r.key) as [ReactionKey, ...ReactionKey[]];

/** Approved accent palette (users pick from these; admins may set any brand colour). */
export const ACCENT_PALETTE = [
  { key: 'indigo', value: '#6366F1', label: 'Indigo' },
  { key: 'violet', value: '#8B5CF6', label: 'Violet' },
  { key: 'sky', value: '#0EA5E9', label: 'Sky' },
  { key: 'cyan', value: '#06B6D4', label: 'Cyan' },
  { key: 'emerald', value: '#10B981', label: 'Emerald' },
  { key: 'amber', value: '#F59E0B', label: 'Amber' },
  { key: 'rose', value: '#F43F5E', label: 'Rose' },
] as const;
