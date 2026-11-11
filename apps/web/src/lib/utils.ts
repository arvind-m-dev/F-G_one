import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export function timeAgo(iso: string | Date | null | undefined) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const fmtTime = (iso: string | Date, h24?: boolean) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: h24 === undefined ? undefined : !h24 });

export function fmtDayLabel(iso: string | Date) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "12 Nov 2026": one date format for the whole app. A YYYY-MM-DD string is read as a calendar date. */
export function fmtDate(d: string | Date, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const date = typeof d === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? parseDateOnly(d) : new Date(d)) : d;
  return date.toLocaleDateString(undefined, opts);
}

/** "12 Nov 2026, 1:30 PM" (or 13:30 when `h24`). */
export function fmtDateTime(d: string | Date, h24?: boolean) {
  return `${fmtDate(d)}, ${fmtTime(d, h24)}`;
}

/** "1 member" / "3 members". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Tomorrow", "In 3 days", "Today": whole days from now to a date. */
export const relDays = (d: number) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`);

/** Parses a YYYY-MM-DD date as a local calendar date (no timezone shift). */
export function parseDateOnly(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Calendar date (YYYY-MM-DD) in an IANA time zone, optionally shifted by whole days. Attendance and leave use the organization's. */
export function dateInZone(tz: string | undefined, at: Date = new Date(), addDays = 0) {
  let s: string;
  try {
    s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    s = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  }
  if (!addDays) return s;
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10);
}

/** Minutes since midnight in an IANA time zone. */
export function minutesInZone(tz: string | undefined, at: Date = new Date()) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
}

/** Weekday (0 = Sunday) in an IANA time zone. */
export const weekdayInZone = (tz: string | undefined, at: Date = new Date()) => new Date(`${dateInZone(tz, at)}T12:00:00Z`).getUTCDay();

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
