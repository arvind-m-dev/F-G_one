import type { ZodError } from 'zod';

/**
 * Turns a failed zod parse into one message per field, for showing under each input.
 * `friendly` replaces a field's built-in message with plain words.
 */
export function fieldErrors<K extends string>(error: ZodError, friendly: Partial<Record<K, string>> = {}): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '') as K;
    if (key && !out[key]) out[key] = friendly[key] ?? issue.message;
  }
  return out;
}
