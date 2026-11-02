'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect } from 'react';
import { hasPermission, type ModuleKey, type Permission } from '@fg/shared';
import { useTheme } from 'next-themes';
import { api } from './api';
import type { Me } from './types';

const SessionContext = createContext<Me | null>(null);

export function useMeQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: 60_000 });
}

export function SessionProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  const { setTheme, theme } = useTheme();
  // Apply organization branding (or personal accent) as CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand', me.preferences.accent || me.organization.primaryColor);
    root.style.setProperty('--brand-2', me.organization.secondaryColor);
  }, [me.organization.primaryColor, me.organization.secondaryColor, me.preferences.accent]);
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
    qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, preferences: { ...old.preferences, ...patch } } : old));
    await api('/me/preferences', { method: 'PATCH', body: patch });
  };
}
