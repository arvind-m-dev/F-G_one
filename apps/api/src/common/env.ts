import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  DEFAULT_ORG_SLUG: z.string().default('futurist-global'),
  SESSION_COOKIE_NAME: z.string().default('fg_session'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /**
   * Number of reverse-proxy hops in front of the API whose X-Forwarded-For entries are trusted.
   * Local dev (browser → Next → API): 1. Render (browser → edge → Next → edge → API): 2.
   * Too high lets clients spoof their IP; too low makes everyone share one rate-limit bucket.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  SMTP_URL: z.string().optional().default(''),
  /**
   * 32-byte key (base64 or 64 hex characters) that encrypts two-step verification secrets.
   * Required in production for MFA; development and tests fall back to a fixed local key.
   * Changing it makes every enrolled authenticator invalid.
   */
  MFA_ENCRYPTION_KEY: z.string().optional().default(''),
  /**
   * Local development only: skip the two-step verification code at sign-in and re-auth.
   * The API refuses to start if this is set while NODE_ENV=production.
   */
  MFA_BYPASS_LOCAL: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /**
   * Demo only, remove before go-live: a fixed two-step code (for example 123456) accepted for the
   * accounts listed in DEMO_MFA_EMAILS, in place of the authenticator code. Both must be set.
   */
  DEMO_MFA_CODE: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || /^\d{6}$/.test(v), 'DEMO_MFA_CODE must be 6 digits'),
  DEMO_MFA_EMAILS: z
    .string()
    .optional()
    .default('')
    .transform((v) => v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  /**
   * Demo only, remove before go-live: shows a "Sign in without a password" link on the login
   * screen that signs in one of the DEMO_MFA_EMAILS accounts with no password and no two-step code.
   * Only ever works outside production: the API refuses to start if this is set while
   * NODE_ENV=production (same guard as MFA_BYPASS_LOCAL), so it cannot ship to a live deploy.
   * It does nothing unless DEMO_MFA_EMAILS also lists the accounts it may sign in.
   */
  DEMO_PASSWORDLESS_LOGIN: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  MAIL_FROM: z.string().default('FG One <no-reply@futuristglobal.com>'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      // Fail fast with a readable message rather than at first use.
      throw new Error('Invalid environment configuration:\n' + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    }
    if (parsed.data.MFA_BYPASS_LOCAL && parsed.data.NODE_ENV === 'production') {
      throw new Error('MFA_BYPASS_LOCAL must not be set in production.');
    }
    if (parsed.data.DEMO_PASSWORDLESS_LOGIN && parsed.data.NODE_ENV === 'production') {
      throw new Error('DEMO_PASSWORDLESS_LOGIN must not be set in production.');
    }
    cached = parsed.data;
  }
  return cached;
}
