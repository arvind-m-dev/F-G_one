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
    cached = parsed.data;
  }
  return cached;
}
