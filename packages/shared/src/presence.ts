/** Presence (availability) is intentionally separate from attendance records. */
export const PRESENCE_PRESETS = [
  { key: 'available', emoji: '🟢', label: 'Available', tone: 'green' },
  { key: 'busy', emoji: '🔴', label: 'Busy', tone: 'red' },
  { key: 'away', emoji: '🟡', label: 'Away', tone: 'amber' },
  { key: 'working', emoji: '💻', label: 'Working', tone: 'green' },
  { key: 'wfh', emoji: '🏠', label: 'Working From Home', tone: 'green' },
  { key: 'in_office', emoji: '🏢', label: 'In Office', tone: 'green' },
  { key: 'short_break', emoji: '☕', label: 'Short Break', tone: 'amber' },
  { key: 'lunch', emoji: '🍽️', label: 'Lunch Break', tone: 'amber' },
  { key: 'meeting', emoji: '📅', label: 'In a Meeting', tone: 'red' },
  { key: 'focus', emoji: '🎧', label: 'Focus Mode', tone: 'red' },
  { key: 'stepped_out', emoji: '🚶', label: 'Stepped Out', tone: 'amber' },
  { key: 'dnd', emoji: '⛔', label: 'Do Not Disturb', tone: 'red' },
  { key: 'offline', emoji: '⚪', label: 'Offline', tone: 'gray' },
] as const;

export type PresenceKey = (typeof PRESENCE_PRESETS)[number]['key'];
export type PresenceTone = (typeof PRESENCE_PRESETS)[number]['tone'];
export const PRESENCE_KEYS = PRESENCE_PRESETS.map((p) => p.key) as [PresenceKey, ...PresenceKey[]];

export function presenceMeta(key: string | null | undefined) {
  return PRESENCE_PRESETS.find((p) => p.key === key) ?? PRESENCE_PRESETS[0];
}

export const STATUS_EXPIRY_OPTIONS = [
  { value: 'never', label: "Don't clear" },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'today', label: 'Today' },
] as const;
export type StatusExpiry = (typeof STATUS_EXPIRY_OPTIONS)[number]['value'];
