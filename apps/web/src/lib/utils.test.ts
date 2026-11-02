import { initials, parseDateOnly, timeAgo } from './utils';
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
});

describe('api client', () => {
  it('surfaces API error messages', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Nope' }), { status: 403 })) as unknown as typeof fetch;
    await expect(api('/x')).rejects.toEqual(expect.objectContaining({ status: 403, message: 'Nope' }));
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
  });
});
