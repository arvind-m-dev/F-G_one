'use client';
import * as Tabs from '@radix-ui/react-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { Blocks, CalendarCheck2, Clock, LayoutDashboard, Palette, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MODULE_KEYS, MODULE_LABELS, PERMISSIONS, WIDGET_KEYS, WIDGET_LABELS, type OrganizationSettings } from '@fg/shared';
import { Forbidden, PageHeader } from '@/components/admin/page-header';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, Switch } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Modules that ship in the current milestone; the rest can be pre-configured now. */
const LIVE_MODULES = new Set(['chat', 'holidays', 'announcements', 'recognition', 'attendance']);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const me = useSession();
  const can = useCan();
  const qc = useQueryClient();
  const org = me.organization;
  const [name, setName] = useState(org.name);
  const [logoUrl, setLogoUrl] = useState(org.logoUrl ?? '');
  const [primary, setPrimary] = useState(org.primaryColor);
  const [secondary, setSecondary] = useState(org.secondaryColor);
  const [s, setS] = useState<OrganizationSettings>(org.settings);
  const [domainDraft, setDomainDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (!can(PERMISSIONS.SETTINGS_MANAGE)) return <Forbidden />;

  const patch = <K extends keyof OrganizationSettings>(k: K, v: Partial<OrganizationSettings[K]>) => setS((prev) => ({ ...prev, [k]: { ...prev[k], ...v } }));
  const preview = (p: string, sec: string) => {
    document.documentElement.style.setProperty('--brand', me.preferences.accent || p);
    document.documentElement.style.setProperty('--brand-2', sec);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api('/organization', { method: 'PATCH', body: { name, logoUrl: logoUrl || null, primaryColor: primary, secondaryColor: secondary, settings: s } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Company settings saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { v: 'branding', label: 'Branding', icon: Palette },
    { v: 'modules', label: 'Modules', icon: Blocks },
    { v: 'dashboard', label: 'Dashboard & navigation', icon: LayoutDashboard },
    { v: 'attendance', label: 'Attendance policy', icon: Clock },
    { v: 'leave', label: 'Leave policy', icon: CalendarCheck2 },
    { v: 'auth', label: 'Sign-in & security', icon: ShieldCheck },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader
        title="Company settings"
        description="Branding, modules and policies for your whole workspace."
        actions={
          <Button variant="gradient" loading={saving} onClick={save}>
            Save changes
          </Button>
        }
      />
      <Tabs.Root defaultValue="branding" className="grid gap-4 lg:grid-cols-[240px_1fr]" orientation="vertical">
        <Tabs.List className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
          {tabs.map((t) => (
            <Tabs.Trigger
              key={t.v}
              value={t.v}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-foreground data-[state=active]:bg-primary-soft data-[state=active]:text-primary"
            >
              <t.icon className="size-4" /> {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Card className="p-6">
          <Tabs.Content value="branding" className="space-y-6 outline-none">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" htmlFor="org-name">
                <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Logo URL" htmlFor="logo" hint="Square PNG/SVG over https. Leave empty to use the FG monogram.">
                <Input id="logo" value={logoUrl} placeholder="https://…" onChange={(e) => setLogoUrl(e.target.value)} />
              </Field>
              <Field label="Tagline (login screen)" htmlFor="tagline">
                <Input id="tagline" value={s.branding.tagline} maxLength={120} onChange={(e) => patch('branding', { tagline: e.target.value })} />
              </Field>
              <Field label="Default theme for new users" htmlFor="theme">
                <Select id="theme" value={s.branding.defaultTheme} onChange={(e) => patch('branding', { defaultTheme: e.target.value as 'light' | 'dark' | 'system' })}>
                  <option value="system">Follow device</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Field>
              {([
                ['Primary colour', primary, (v: string) => { setPrimary(v); preview(v, secondary); }],
                ['Secondary colour', secondary, (v: string) => { setSecondary(v); preview(primary, v); }],
              ] as const).map(([label, value, set]) => (
                <Field key={label} label={label} htmlFor={label}>
                  <div className="flex gap-2">
                    <input type="color" value={value} onChange={(e) => set(e.target.value)} className="h-10 w-12 cursor-pointer rounded-lg border bg-surface p-1" aria-label={`${label} picker`} />
                    <Input id={label} value={value} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set(e.target.value)} className="font-mono" />
                  </div>
                </Field>
              ))}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Live preview</p>
              <div className="overflow-hidden rounded-2xl border">
                <div className="bg-brand-gradient flex items-center gap-3 p-5 text-white">
                  <BrandMark name={name} logoUrl={logoUrl || null} size={40} />
                  <div>
                    <p className="text-lg font-bold">{name || 'Company'}</p>
                    <p className="text-sm text-white/80">{s.branding.tagline}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 bg-surface p-4">
                  <Button>Primary action</Button>
                  <Button variant="outline">Secondary</Button>
                  <Badge tone="brand">Badge</Badge>
                  <span className="text-brand-gradient font-bold">Gradient text</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">Colours apply to everyone after saving. Users can still pick a personal accent.</p>
            </div>
          </Tabs.Content>

          <Tabs.Content value="modules" className="divide-y outline-none">
            <p className="pb-3 text-sm text-muted">Turn features on or off for the whole company. Disabled modules disappear from navigation and their APIs stay protected.</p>
            {MODULE_KEYS.map((k) => (
              <Row key={k} title={MODULE_LABELS[k]} description={LIVE_MODULES.has(k) ? undefined : 'Arrives in an upcoming milestone — you can pre-configure it now.'}>
                <div className="flex items-center gap-3">
                  {!LIVE_MODULES.has(k) && <Badge tone="muted">upcoming</Badge>}
                  <Switch checked={s.modules[k]} onCheckedChange={(v) => patch('modules', { [k]: v } as Partial<OrganizationSettings['modules']>)} aria-label={MODULE_LABELS[k]} />
                </div>
              </Row>
            ))}
          </Tabs.Content>

          <Tabs.Content value="dashboard" className="outline-none">
            <p className="text-sm font-medium">Widgets available on the home dashboard</p>
            <p className="mb-3 text-xs text-muted">Order here is the default layout for new users.</p>
            <div className="flex flex-wrap gap-2">
              {WIDGET_KEYS.map((w) => {
                const on = s.dashboard.defaultWidgets.includes(w);
                return (
                  <button
                    key={w}
                    onClick={() => patch('dashboard', { defaultWidgets: on ? s.dashboard.defaultWidgets.filter((x) => x !== w) : [...s.dashboard.defaultWidgets, w] })}
                    className={cn('rounded-full border px-3 py-1.5 text-sm transition', on ? 'border-primary bg-primary-soft text-primary' : 'text-muted hover:border-primary/40')}
                    aria-pressed={on}
                  >
                    {WIDGET_LABELS[w]}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 divide-y border-t">
              <Row title="Let employees personalise their dashboard" description="Drag-and-drop layout saved per user.">
                <Switch checked={s.dashboard.allowPersonalLayout} onCheckedChange={(v) => patch('dashboard', { allowPersonalLayout: v })} />
              </Row>
              <Row title="Collapse sidebar by default" description="Users can still expand it; their choice is remembered.">
                <Switch checked={s.navigation.sidebarCollapsedByDefault} onCheckedChange={(v) => patch('navigation', { sidebarCollapsedByDefault: v })} />
              </Row>
            </div>
          </Tabs.Content>

          <Tabs.Content value="attendance" className="space-y-5 outline-none">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Workday starts" htmlFor="ws">
                <Input id="ws" type="time" value={s.attendance.workdayStart} onChange={(e) => patch('attendance', { workdayStart: e.target.value })} />
              </Field>
              <Field label="Workday ends" htmlFor="we">
                <Input id="we" type="time" value={s.attendance.workdayEnd} onChange={(e) => patch('attendance', { workdayEnd: e.target.value })} />
              </Field>
              <Field label="Grace period (minutes)" htmlFor="grace">
                <Input id="grace" type="number" min={0} max={180} value={s.attendance.graceMinutes} onChange={(e) => patch('attendance', { graceMinutes: Number(e.target.value) })} />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Working days</p>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = s.attendance.workingDays.includes(i);
                  return (
                    <button key={d} onClick={() => patch('attendance', { workingDays: on ? s.attendance.workingDays.filter((x) => x !== i) : [...s.attendance.workingDays, i].sort() })} className={cn('h-9 w-12 rounded-lg border text-sm font-medium transition', on ? 'border-primary bg-primary text-white' : 'text-muted')} aria-pressed={on}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Allowed work locations</p>
              <div className="flex flex-wrap gap-2">
                {([['WFO', '🏢 Work from office'], ['WFH', '🏠 Work from home'], ['ON_DUTY', '🚗 On duty / client site']] as const).map(([k, label]) => {
                  const on = s.attendance.allowedLocations.includes(k);
                  return (
                    <button key={k} onClick={() => patch('attendance', { allowedLocations: on ? s.attendance.allowedLocations.filter((x) => x !== k) : [...s.attendance.allowedLocations, k] })} className={cn('rounded-full border px-3 py-1.5 text-sm transition', on ? 'border-primary bg-primary-soft text-primary' : 'text-muted')} aria-pressed={on}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Time zone for attendance" htmlFor="att-tz" hint="Defines the attendance day and when someone counts as late.">
                <Select id="att-tz" value={s.attendance.timezone} onChange={(e) => patch('attendance', { timezone: e.target.value })}>
                  {[...new Set([s.attendance.timezone, 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'])].map((tz) => (
                    <option key={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm sm:mt-6">
                <span>
                  <span className="block font-medium">Track breaks</span>
                  <span className="text-xs text-muted">Show Start/End break buttons.</span>
                </span>
                <Switch checked={s.attendance.breaksEnabled} onCheckedChange={(v) => patch('attendance', { breaksEnabled: v })} />
              </label>
            </div>
            <div className="space-y-4 border-t pt-5">
              <div>
                <p className="text-sm font-medium">Checking in</p>
                <p className="text-xs text-muted">What happens when someone opens FG One on a working day without having checked in.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="When someone opens FG One" htmlFor="att-mode" hint={s.attendance.checkInMode === 'auto' ? 'Checks in from 2 hours before the workday starts until it ends. Not on days off or full-day leave.' : undefined}>
                  <Select id="att-mode" value={s.attendance.checkInMode} onChange={(e) => patch('attendance', { checkInMode: e.target.value as OrganizationSettings['attendance']['checkInMode'] })}>
                    <option value="manual">Do nothing (people check in themselves)</option>
                    <option value="prompt">Show a reminder to check in</option>
                    <option value="auto">Check them in automatically</option>
                  </Select>
                </Field>
                {s.attendance.checkInMode === 'auto' && (
                  <Field label="Location for automatic check-in" htmlFor="att-auto-loc">
                    <Select id="att-auto-loc" value={s.attendance.autoCheckInLocation} onChange={(e) => patch('attendance', { autoCheckInLocation: e.target.value as OrganizationSettings['attendance']['autoCheckInLocation'] })}>
                      {([['WFO', 'Office'], ['WFH', 'Home'], ['ON_DUTY', 'Client site']] as const)
                        .filter(([k]) => s.attendance.allowedLocations.includes(k))
                        .map(([k, label]) => (
                          <option key={k} value={k}>{label}</option>
                        ))}
                    </Select>
                  </Field>
                )}
              </div>
              <label className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm">
                <span>
                  <span className="block font-medium">Allow checking in more than once a day</span>
                  <span className="text-xs text-muted">For split shifts. Time between checking out and checking in again isn&apos;t counted as work.</span>
                </span>
                <Switch checked={s.attendance.multipleSessions} onCheckedChange={(v) => patch('attendance', { multipleSessions: v })} />
              </label>
            </div>
            <div className="space-y-4 border-t pt-5">
              <div>
                <p className="text-sm font-medium">Automatic check-out</p>
                <p className="text-xs text-muted">Closes shifts people forget to end. Set a rule to 0 to turn it off. If several rules are on, the first one reached applies. People are notified and can check in again or request a correction.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Hours after the workday ends" htmlFor="att-ao-end" hint="Not used for shifts that start after the workday ends.">
                  <Input id="att-ao-end" type="number" min={0} max={12} value={s.attendance.autoCheckOut.afterWorkdayEndHours} onChange={(e) => patch('attendance', { autoCheckOut: { ...s.attendance.autoCheckOut, afterWorkdayEndHours: Number(e.target.value) } })} />
                </Field>
                <Field label="Longest shift (hours)" htmlFor="att-ao-max" hint="Works for night shifts too.">
                  <Input id="att-ao-max" type="number" min={0} max={24} value={s.attendance.autoCheckOut.maxShiftHours} onChange={(e) => patch('attendance', { autoCheckOut: { ...s.attendance.autoCheckOut, maxShiftHours: Number(e.target.value) } })} />
                </Field>
                <Field label="Minutes with no activity" htmlFor="att-ao-idle" hint="Only if people work inside FG One all day. Breaks don't count.">
                  <Input id="att-ao-idle" type="number" min={0} max={480} value={s.attendance.autoCheckOut.idleMinutes} onChange={(e) => patch('attendance', { autoCheckOut: { ...s.attendance.autoCheckOut, idleMinutes: Number(e.target.value) } })} />
                </Field>
              </div>
            </div>
            <p className="text-xs text-muted">Employees check in from Home or Attendance. Someone checking in after the start time plus the grace period is marked late. Night shifts can check out after midnight; the shift counts for the day it started.</p>
          </Tabs.Content>

          <Tabs.Content value="leave" className="divide-y outline-none">
            <Row title="Leave year starts in">
              <Select value={s.leave.yearStartMonth} onChange={(e) => patch('leave', { yearStartMonth: Number(e.target.value) })} className="w-44">
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </Select>
            </Row>
            <Row title="Allow half-day leave">
              <Switch checked={s.leave.allowHalfDay} onCheckedChange={(v) => patch('leave', { allowHalfDay: v })} />
            </Row>
            <Row title="Require manager approval" description="When off, requests route straight to HR.">
              <Switch checked={s.leave.requireManagerApproval} onCheckedChange={(v) => patch('leave', { requireManagerApproval: v })} />
            </Row>
            <Row title="Count weekends and holidays inside a leave" description="Also called the sandwich rule. Friday to Monday then uses 4 days instead of 2. Days off at the very start or end are never counted.">
              <Switch checked={s.leave.countDaysOffInside} onCheckedChange={(v) => patch('leave', { countDaysOffInside: v })} />
            </Row>
          </Tabs.Content>

          <Tabs.Content value="auth" className="space-y-5 outline-none">
            <div>
              <p className="text-sm font-medium">Allowed email domains</p>
              <p className="mb-2 text-xs text-muted">Only these domains can be invited.</p>
              <div className="flex flex-wrap gap-2">
                {s.auth.allowedEmailDomains.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1.5 pl-3 text-sm text-primary">
                    @{d}
                    {s.auth.allowedEmailDomains.length > 1 && (
                      <button onClick={() => patch('auth', { allowedEmailDomains: s.auth.allowedEmailDomains.filter((x) => x !== d) })} aria-label={`Remove ${d}`} className="rounded-full p-0.5 hover:bg-primary/15">
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <form
                className="mt-2 flex max-w-sm gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = domainDraft.trim().toLowerCase().replace(/^@/, '');
                  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !s.auth.allowedEmailDomains.includes(d)) {
                    patch('auth', { allowedEmailDomains: [...s.auth.allowedEmailDomains, d] });
                    setDomainDraft('');
                  } else toast.error('Enter a valid domain like example.com');
                }}
              >
                <Input value={domainDraft} onChange={(e) => setDomainDraft(e.target.value)} placeholder="example.com" aria-label="New domain" />
                <Button type="submit" variant="outline">Add</Button>
              </form>
            </div>
            <div className="divide-y border-t">
              <Row title="Session length" description="How long a sign-in stays valid.">
                <Select value={s.auth.sessionTtlHours} onChange={(e) => patch('auth', { sessionTtlHours: Number(e.target.value) })} className="w-44">
                  {[8, 24, 72, 168, 336, 720].map((h) => (
                    <option key={h} value={h}>{h < 24 ? `${h} hours` : `${h / 24} days`}</option>
                  ))}
                </Select>
              </Row>
              <Row title="Public self-registration" description="Kept off: employees join by admin invitation only.">
                <div className="flex items-center gap-2">
                  <Badge tone="muted">invite-only</Badge>
                  <Switch checked={false} disabled aria-label="Self-registration (disabled)" />
                </div>
              </Row>
            </div>
          </Tabs.Content>
        </Card>
      </Tabs.Root>
    </div>
  );
}
