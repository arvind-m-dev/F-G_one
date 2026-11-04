import { dateInZone, initials, minutesInZone, parseDateOnly, timeAgo, weekdayInZone } from './utils';
import { api, ApiError } from './api';

describe('utils', () => {
  it('builds initials', () => {
    expect(initials('Ananya Iyer')).toBe('AI');
    expect(initials('  priya ')).toBe('P');
  });
  it('formats relative time', () => {
    expect(timeAgo(new Date())).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toBe('5m ago');
  });
  it('parses date-only strings without timezone drift', () => {
    const d = parseDateOnly('2026-12-25');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 25]);
  });
  it("uses the organization's calendar day, not the browser's", () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in Kolkata (UTC+5:30) and still 31 Dec in New York.
    const at = new Date('2026-12-31T20:00:00Z');
    expect(dateInZone('Asia/Kolkata', at)).toBe('2027-01-01');
    expect(dateInZone('America/New_York', at)).toBe('2026-12-31');
    expect(dateInZone('Asia/Kolkata', at, -1)).toBe('2026-12-31');
    expect(dateInZone('Asia/Kolkata', at, 60)).toBe('2027-03-02');
    expect(minutesInZone('Asia/Kolkata', at)).toBe(1 * 60 + 30);
    expect(weekdayInZone('Asia/Kolkata', at)).toBe(5); // Friday
    // An unknown zone falls back to the browser's instead of throwing.
    expect(dateInZone('Mars/Olympus', at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('api client', () => {
  it('surfaces API error messages', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Nope' }), { status: 403 })) as unknown as typeof fetch;
    await expect(api('/x')).rejects.toEqual(expect.objectContaining({ status: 403, message: 'Nope' }));
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
  });
});
