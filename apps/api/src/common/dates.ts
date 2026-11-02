/** Date-only helpers. Date columns are stored as UTC midnight. */
export const toDateOnly = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : s === null ? null : undefined);
export const fmtDateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
