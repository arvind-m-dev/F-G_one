/** Used when the browser cannot list time zones. */
const FALLBACK = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

const city = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ');

/** The everyday name of a time zone, for example "India Standard Time" (null when the browser does not know it). */
function zoneName(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? null;
  } catch {
    return null;
  }
}

/** A time zone in plain words, for example "Kolkata (India Standard Time)". */
export function timeZoneLabel(tz: string): string {
  if (tz === 'UTC') return 'UTC (Coordinated Universal Time)';
  const name = zoneName(tz);
  return name && name !== city(tz) ? `${city(tz)} (${name})` : city(tz);
}

export interface TimeZoneGroup {
  region: string;
  zones: { value: string; label: string }[];
}

/** Every time zone the browser knows, grouped by region for a select. `current` is always included. */
export function timeZoneGroups(current: string): TimeZoneGroup[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  let all: string[];
  try {
    all = supported ? supported('timeZone') : FALLBACK;
  } catch {
    all = FALLBACK;
  }
  const groups = new Map<string, TimeZoneGroup>();
  for (const tz of [...new Set([current, 'UTC', ...all])].filter(Boolean)) {
    const region = tz.includes('/') ? tz.split('/')[0]! : 'Other';
    if (!groups.has(region)) groups.set(region, { region, zones: [] });
    groups.get(region)!.zones.push({ value: tz, label: timeZoneLabel(tz) });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, zones: g.zones.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => (a.region === 'Other' ? 1 : b.region === 'Other' ? -1 : a.region.localeCompare(b.region)));
}
