import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

const origin = 'https://one.example.com';

describe('safeNext', () => {
  it('keeps paths on this site, with their query and hash', () => {
    expect(safeNext('/admin/audit?q=auth#top', origin)).toBe('/admin/audit?q=auth#top');
    expect(safeNext('/app/home', origin)).toBe('/app/home');
  });

  it('falls back for anything that leaves the site', () => {
    for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example', '/.//evil.example', '/./\\evil.example', 'javascript:alert(1)', 'app/home']) {
      expect(safeNext(bad, origin)).toBe('/app/home');
    }
  });
});
