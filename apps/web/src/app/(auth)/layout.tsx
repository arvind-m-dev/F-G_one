'use client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { MessagesSquare, ShieldCheck, Sparkles, Users } from 'lucide-react';
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

const FEATURES = [
  { icon: MessagesSquare, title: 'Real-time chat', text: 'Channels, groups and DMs with your whole company.' },
  { icon: Users, title: 'People & presence', text: 'See who is around, in focus, or out for lunch.' },
  { icon: Sparkles, title: 'One dashboard', text: 'Announcements, holidays and celebrations at a glance.' },
  { icon: ShieldCheck, title: 'Secure by design', text: 'Role-based access with company-only sign-in.' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ['branding'], queryFn: () => api<Branding>('/public/branding') });
  useEffect(() => {
    if (!data) return;
    document.documentElement.style.setProperty('--brand', data.primaryColor);
    document.documentElement.style.setProperty('--brand-2', data.secondaryColor);
  }, [data]);
  const name = data?.name ?? 'Futurist Global';

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="bg-brand-gradient relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 size-[480px] rounded-full bg-black/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-white/15 font-display text-lg font-bold backdrop-blur">FG</span>
          <div>
            <p className="font-display text-lg font-bold leading-tight">FG One</p>
            <p className="text-sm text-white/75">{name}</p>
          </div>
        </div>
        <div className="relative mt-auto mb-auto max-w-lg">
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="font-display text-4xl leading-tight font-bold xl:text-5xl">
            Your whole workday,
            <br />
            one workspace.
          </motion.h1>
          <p className="mt-4 text-lg text-white/80">{data?.tagline ?? 'One workspace for everything Futurist Global'}</p>
          <div className="mt-10 grid grid-cols-2 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.08 }}
                className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"
              >
                <f.icon className="mb-2 size-5" />
                <p className="font-semibold">{f.title}</p>
                <p className="mt-0.5 text-sm text-white/75">{f.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
        <p className="relative text-sm text-white/60">© {new Date().getFullYear()} {name}. Internal use only.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark name={name} logoUrl={data?.logoUrl} />
            <div>
              <p className="font-display font-bold">FG One</p>
              <p className="text-sm text-muted">{name}</p>
            </div>
          </div>
          {children}
        </motion.div>
      </main>
    </div>
  );
}
