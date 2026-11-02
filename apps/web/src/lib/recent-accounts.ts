/**
 * Device-local list of recently used sign-in emails (never passwords).
 * Stored only in this browser's localStorage; nothing is sent to the server.
 */
export interface RecentAccount {
  email: string;
  name?: string;
  avatarColor?: string;
  lastUsed: number;
}
const KEY = 'fg.recentAccounts';
const MAX = 5;

export function readRecentAccounts(): RecentAccount[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentAccount[]) : [];
    return Array.isArray(list) ? list.filter((a) => typeof a?.email === 'string').sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberAccount(a: Omit<RecentAccount, 'lastUsed'>) {
  try {
    const list = readRecentAccounts().filter((x) => x.email !== a.email);
    window.localStorage.setItem(KEY, JSON.stringify([{ ...a, lastUsed: Date.now() }, ...list].slice(0, MAX)));
  } catch {
    /* storage unavailable — feature silently disabled */
  }
}

export function forgetAccount(email: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(readRecentAccounts().filter((x) => x.email !== email)));
  } catch {
    /* ignore */
  }
}
