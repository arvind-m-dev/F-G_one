/**
 * Case-insensitive "contains" filter that matches the text literally.
 * Prisma passes `contains` to SQL LIKE without escaping, so `%` or `_` in a search would match everything.
 */
export function likeContains(term: string) {
  return { contains: term.replace(/[\\%_]/g, (c) => `\\${c}`), mode: 'insensitive' as const };
}
