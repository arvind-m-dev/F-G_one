/** Time-zone helpers for organization-local calendar days (attendance, "late"). */
export function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
export function localMinutes(tz: string, at = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}
export function localWeekday(tz: string, at = new Date()): number {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d);
}
export const toDbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
export function addDays(ymd: string, n: number) {
  const d = toDbDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** UTC instant for a local wall-clock time ("YYYY-MM-DD", "HH:MM") in an IANA time zone. */
export function localToUtc(ymd: string, hhmm: string, tz: string): Date {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  const offset = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - d.getTime();
  };
  const first = new Date(guess.getTime() - offset(guess));
  return new Date(guess.getTime() - offset(first)); // second pass handles DST edges
}
