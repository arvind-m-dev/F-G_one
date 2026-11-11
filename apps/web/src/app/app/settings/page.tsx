'use client';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { ACCENT_PALETTE } from '@fg/shared';
import { SecuritySettings } from '@/components/security/security-settings';
import { PageHeader } from '@/components/shell/page';
import { Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { useSession, useUpdatePreferences } from '@/lib/session';
import type { Me } from '@/lib/types';
import { cn } from '@/lib/utils';


function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition', value === o.value ? 'bg-canvas text-foreground shadow-sm' : 'text-muted hover:text-foreground')}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-[13px] font-semibold text-muted">{title}</h2>
      <div className="divide-y border-y">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const me = useSession();
  const { theme, setTheme } = useTheme();
  const save = useUpdatePreferences();
  const p = me.preferences as Me['preferences'];
  const set = (patch: Partial<Me['preferences']>) => void save(patch);
  const accent = p.accent ?? null;

  return (
    <div className="mx-auto max-w-[760px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader className="px-0 pt-0 sm:px-0" title="Settings" description="Personal preferences. They only affect your account." />

      <Section title="Appearance">
        <Row title="Theme" description="System follows your device.">
          <Segmented
            label="Theme"
            value={(theme as 'light' | 'dark' | 'system') ?? 'system'}
            onChange={(v) => {
              setTheme(v);
              set({ theme: v });
            }}
            options={[
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'system', label: 'System', icon: Monitor },
            ]}
          />
        </Row>
        <Row title="Accent colour" description="Highlights buttons, links and selection.">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                document.documentElement.style.setProperty('--brand', me.organization.primaryColor);
                set({ accent: null });
              }}
              className={cn('grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-canvas transition hover:scale-110', !accent && 'ring-2 ring-foreground/40')}
              style={{ background: `linear-gradient(135deg, ${me.organization.primaryColor}, ${me.organization.secondaryColor})` }}
              aria-label="Company default"
              title="Company default"
            >
              {!accent && <Check className="size-3.5 text-white" />}
            </button>
            {ACCENT_PALETTE.map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  document.documentElement.style.setProperty('--brand', c.value);
                  set({ accent: c.value });
                }}
                className={cn('grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-canvas transition hover:scale-110', accent?.toLowerCase() === c.value.toLowerCase() && 'ring-2 ring-foreground/40')}
                style={{ background: c.value }}
                aria-label={c.label}
                title={c.label}
              >
                {accent?.toLowerCase() === c.value.toLowerCase() && <Check className="size-3.5 text-white" />}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Text size">
          <Segmented
            label="Text size"
            value={p.fontSize ?? 'md'}
            onChange={(v) => {
              document.documentElement.dataset.fontSize = v;
              set({ fontSize: v });
            }}
            options={[
              { value: 'sm', label: 'Small' },
              { value: 'md', label: 'Default' },
              { value: 'lg', label: 'Large' },
            ]}
          />
        </Row>
        <Row title="Collapse the sidebar" description="Show icons only in the navigation on the left. Smaller screens always use the compact version.">
          <Switch checked={!!p.sidebarCollapsed} onCheckedChange={(v) => set({ sidebarCollapsed: v })} aria-label="Collapse the sidebar" />
        </Row>
      </Section>

      <Section title="Chat">
        <Row title="Message density" description="Compact fits more messages on screen.">
          <Segmented
            label="Message density"
            value={p.density ?? 'comfortable'}
            onChange={(v) => {
              document.documentElement.dataset.density = v;
              set({ density: v });
            }}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Row>
        <Row title="Send with Enter" description="When off, use Ctrl/Cmd + Enter to send and Enter for a new line.">
          <Switch checked={p.enterToSend !== false} onCheckedChange={(v) => set({ enterToSend: v })} aria-label="Send with Enter" />
        </Row>
      </Section>

      <section id="notifications" className="mb-10 scroll-mt-6">
        <h2 className="mb-1 text-[13px] font-semibold text-muted">Notifications</h2>
        <div className="divide-y border-y">
          {([
            ['dm', 'Direct messages', 'When someone messages you directly. Several messages in one chat are grouped.'],
            ['mentions', 'Mentions', 'When someone writes @your-name in a channel.'],
            ['threads', 'Replies to your messages', 'When someone replies to you in a thread.'],
            ['announcements', 'Announcements', 'When a new announcement is published for you.'],
            ['requests', 'Leave and attendance requests', 'Approvals, decisions and corrections that involve you.'],
          ] as const).map(([k, title, description]) => (
            <Row key={k} title={title} description={description}>
              <Switch
                checked={p.notifications?.[k] !== false}
                onCheckedChange={(v) => set({ notifications: { ...p.notifications, [k]: v } })}
                aria-label={title}
              />
            </Row>
          ))}
        </div>
      </section>

      <Section title="Date & time">
        <Row title="Time format">
          <Segmented
            label="Time format"
            value={p.timeFormat ?? '12h'}
            onChange={(v) => set({ timeFormat: v })}
            options={[
              { value: '12h', label: '1:30 PM' },
              { value: '24h', label: '13:30' },
            ]}
          />
        </Row>
        <Row title="Time zone" description="Attendance, leave and holidays always follow the organization's time zone.">
          <span className="text-sm text-muted">
            {me.user.timezone} ·{' '}
            <Link href="/app/profile" className="text-primary hover:underline">
              Change in profile
            </Link>
          </span>
        </Row>
      </Section>

      <SecuritySettings />

      <Section title="Account">
        <Row title="Profile, photo and password" description="Update how colleagues see you and manage your password.">
          <Link href="/app/profile" className="text-sm font-medium text-primary hover:underline">
            Open profile
          </Link>
        </Row>
      </Section>
      <Section title="Help">
        <Row title="Getting started checklist" description="Show the step-by-step checklist at the top of Home. It hides itself once every step is done.">
          <Switch checked={!p.onboardingDismissed} onCheckedChange={(v) => set({ onboardingDismissed: !v })} aria-label="Show the getting started checklist on Home" />
        </Row>
      </Section>
    </div>
  );
}
