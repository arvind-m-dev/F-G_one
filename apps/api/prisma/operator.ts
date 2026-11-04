/**
 * Shared helpers for the operator command-line tools (bootstrap, recovery, reset).
 * These run from a shell with direct database access, never over HTTP.
 */
import { randomInt } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { passwordSchema } from '@fg/shared';

export type Env = Record<string, string | undefined>;
export type Log = (line: string) => void;

/** Same Argon2id parameters as the API (apps/api/src/auth/password.ts). */
export const hashPassword = (plain: string) => hash(plain, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

// No 0/O, 1/l/I: the password is read off a terminal and typed by hand.
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const ALL = LOWER + UPPER + DIGIT;

/**
 * A random temporary password from the OS CSPRNG: 20 characters in four groups (about 115 bits),
 * always with a lowercase letter, an uppercase letter and a digit so it passes passwordSchema.
 */
export function generatePassword() {
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), ...Array.from({ length: 17 }, () => pick(ALL))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('').replace(/(.{5})(?=.)/g, '$1-');
}

/** A password supplied by the operator, or a generated one. Throws if the supplied one is too weak. */
export function choosePassword(supplied: string | undefined) {
  if (!supplied) return { password: generatePassword(), generated: true };
  const ok = passwordSchema.safeParse(supplied);
  if (!ok.success) throw new Error(`The password you supplied is too weak: ${ok.error.issues.map((i) => i.message).join('; ')}`);
  return { password: supplied, generated: false };
}

/** `--email someone@x` or `--email=someone@x` from the command line. */
export function argValue(argv: string[], name: string) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = argv[i]!;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[i + 1];
}

/** Database host only (no user or password), so the operator can see which database they are about to change. */
export const dbHost = (url: string | undefined) => (url ?? '').replace(/^[^@]*@/, '').split(/[/?]/)[0] || '(DATABASE_URL not set)';

/** Who ran the command, for the audit entry. */
export const operatorName = (env: Env) => env.OPERATOR || env.USER || env.USERNAME || 'unknown';

export class RefusedError extends Error {}
