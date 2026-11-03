import { base32Decode, base32Encode, currentStep, decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, totpAt, verifyTotp } from './mfa';

describe('two-step verification primitives', () => {
  // RFC 6238 appendix B (SHA-1): secret "12345678901234567890"; the 8-digit values end in these 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at T=%i', (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30))).toBe(code);
  });

  it('base32 round-trips', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 255, 7]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });

  it('accepts one step of clock drift and never the same step twice', () => {
    const now = Date.now();
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull(); // replay
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('encrypts secrets with authentication (tampering is detected)', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc)).toBe('JBSWY3DPEHPK3PXP');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered!!').toString('base64');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('recovery codes are unique and hashed independent of formatting', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(hashRecoveryCode(codes[0]!.toUpperCase().replace(/-/g, ' '))).toBe(hashRecoveryCode(codes[0]!));
  });
});
