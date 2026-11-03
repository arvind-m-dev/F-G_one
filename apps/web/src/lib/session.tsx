'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect } from 'react';
import { hasPermission, parseOrganizationSettings, type ModuleKey, type Permission } from '@fg/shared';
import { useTheme } from 'next-themes';
import { api } from './api';
import type { Me } from './types';

const SessionContext = createContext<Me | null>(null);

/**
 * Fill in defaults for settings the response doesn't have yet: a session restored from cache,
 * or an API deployed after the web app, may predate newly added settings.
 */
const withSettingDefaults = (me: Me): Me => ({ ...me, organization: { ...me.organization, settings: parseOrganizationSettings(me.organization.settings) } });

export function useMeQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: 60_000, select: withSettingDefaults });
}

export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  const { setTheme, theme } = useTheme();
  // Apply organization branding (or personal accent) as CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand', me.preferences.accent || me.organization.primaryColor);
    root.style.setProperty('--brand-2', me.organization.secondaryColor);
  }, [me.organization.primaryColor, me.organization.secondaryColor, me.preferences.accent]);
  // Personal font size & density.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fontSize = me.preferences.fontSize ?? 'md';
    root.dataset.density = me.preferences.density ?? 'comfortable';
  }, [me.preferences.fontSize, me.preferences.density]);
  // Personal theme preference, falling back to the company default.
  useEffect(() => {
    const wanted = me.preferences.theme ?? me.organization.settings.branding.defaultTheme;
    if (wanted && wanted !== theme) setTheme(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.preferences.theme, me.organization.settings.branding.defaultTheme]);
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession must be used inside SessionProvider');
  return me;
}

export function useCan() {
  const me = useSession();
  return (p: Permission | Permission[]) => hasPermission(me.permissions, p);
}

export function useModule() {
  const me = useSession();
  return (m: ModuleKey) => me.organization.settings.modules[m] !== false;
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return async (patch: Partial<Me['preferences']>) => {
    // Stop any in-flight profile reload so it can't overwrite this change with older data.
    await qc.cancelQueries({ queryKey: ['me'] });
    qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, preferences: { ...old.preferences, ...patch } } : old));
    const saved = await api<Me['preferences']>('/me/preferences', { method: 'PATCH', body: patch });
    qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, preferences: saved } : old));
  };
}

/** Formats times following the user's 12h/24h preference. */
export function useClock() {
  const me = useSession();
  const h24 = me.preferences.timeFormat === '24h';
  /** `tz` pins the display to a time zone (attendance uses the organization's). */
  return {
    h24,
    time: (d: string | Date, tz?: string) => new Date(d).toLocaleTimeString(undefined, { hour: h24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !h24, timeZone: tz }),
  };
}
