'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { api } from '@/lib/api';

interface Branding {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  tagline: string;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ['branding'], queryFn: () => api<Branding>('/public/branding') });
  useEffect(() => {
    if (!data) return;
    document.documentElement.style.setProperty('--brand', data.primaryColor);
    document.documentElement.style.setProperty('--brand-2', data.secondaryColor);
  }, [data]);
  const name = data?.name ?? 'Futurist Global';

  return (
    <div className="relative flex min-h-dvh flex-col bg-chrome">
      <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]" />
      <div className="bg-aurora pointer-events-none absolute inset-0" />
      <header className="relative flex items-center gap-2.5 px-6 py-5">
        <BrandMark name={name} logoUrl={data?.logoUrl} size={28} />
        <span className="text-sm font-semibold">FG One</span>
        <span className="text-sm text-subtle">/ {name}</span>
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[400px] rounded-2xl border bg-canvas p-8 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
          {children}
        </div>
      </main>
      <footer className="relative px-6 py-5 text-center text-xs text-subtle">{data?.tagline ?? 'One workspace for everything Futurist Global'} · Internal use only</footer>
    </div>
  );
}
