'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Monitor, Moon, Palette, Sun, UserRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema, updateProfileSchema, type UpdateProfileInput } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useSession, useUpdatePreferences } from '@/lib/session';
import { cn } from '@/lib/utils';

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#0f172a'];
const ACCENTS = [null, '#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed'];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

function ProfileForm() {
  const me = useSession();
  const qc = useQueryClient();
  const u = me.user;
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: u.displayName ?? '',
      phone: u.phone ?? '',
      bio: u.bio ?? '',
      pronouns: u.pronouns ?? '',
      timezone: u.timezone,
      avatarUrl: u.avatarUrl,
      avatarColor: u.avatarColor,
      birthday: u.birthday,
      showBirthday: u.showBirthday ?? true,
    },
  });
  const color = form.watch('avatarColor');
  const avatarUrl = form.watch('avatarUrl');
  const first = form.watch('firstName');
  const last = form.watch('lastName');
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api('/me/profile', {
        method: 'PATCH',
        body: { ...v, displayName: v.displayName || null, phone: v.phone || null, bio: v.bio || null, pronouns: v.pronouns || null, avatarUrl: v.avatarUrl || null, birthday: v.birthday || null },
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Profile saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  const err = form.formState.errors;
  return (
    <Card>
      <CardHeader title="Profile" icon={<UserRound />} subtitle="How colleagues see you across FG One" />
      <form onSubmit={onSubmit} className="space-y-5 px-5 pb-5" noValidate>
        <div className="flex flex-wrap items-center gap-5 rounded-xl bg-surface-2/60 p-4">
          <UserAvatar person={{ ...u, name: `${first} ${last}`, avatarColor: color ?? u.avatarColor, avatarUrl: avatarUrl || null }} size="xl" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="mb-1.5 text-sm font-medium">Avatar colour</p>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button type="button" key={c} onClick={() => form.setValue('avatarColor', c, { shouldDirty: true })} className={cn('size-7 rounded-full transition hover:scale-110', color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')} style={{ background: c }} aria-label={`Avatar colour ${c}`} />
                ))}
              </div>
            </div>
            <Field label="Photo URL (optional)" htmlFor="avatarUrl" error={err.avatarUrl?.message} hint="Paste an https:// image link. Uploads arrive with document storage.">
              <Input id="avatarUrl" placeholder="https://…" {...form.register('avatarUrl', { setValueAs: (v) => v || null })} />
            </Field>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={err.firstName?.message}>
            <Input id="firstName" {...form.register('firstName')} />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={err.lastName?.message}>
            <Input id="lastName" {...form.register('lastName')} />
          </Field>
          <Field label="Display name" htmlFor="displayName" hint="Optional — shown instead of your full name">
            <Input id="displayName" {...form.register('displayName')} />
          </Field>
          <Field label="Pronouns" htmlFor="pronouns">
            <Input id="pronouns" placeholder="e.g. she/her" {...form.register('pronouns')} />
          </Field>
          <Field label="Work phone" htmlFor="phone">
            <Input id="phone" {...form.register('phone')} />
          </Field>
          <Field label="Time zone" htmlFor="timezone">
            <Select id="timezone" {...form.register('timezone')}>
              {[...new Set([u.timezone, ...TIMEZONES])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Birthday" htmlFor="birthday" error={err.birthday?.message}>
            <Input id="birthday" type="date" {...form.register('birthday', { setValueAs: (v) => v || null })} />
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={form.watch('showBirthday')} onCheckedChange={(v) => form.setValue('showBirthday', v, { shouldDirty: true })} />
              Show my birthday (month & day) to colleagues
            </label>
          </div>
        </div>
        <Field label="Bio" htmlFor="bio" hint="280 characters max">
          <Textarea id="bio" rows={3} maxLength={280} {...form.register('bio')} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Appearance() {
  const me = useSession();
  const { theme, setTheme } = useTheme();
  const save = useUpdatePreferences();
  const [accent, setAccent] = useState<string | null>(me.preferences.accent ?? null);
  return (
    <Card>
      <CardHeader title="Appearance" icon={<Palette />} subtitle="Personal theme — doesn't affect anyone else" />
      <div className="space-y-5 px-5 pb-5">
        <div className="grid grid-cols-3 gap-2">
          {([
            { v: 'light', icon: Sun, label: 'Light' },
            { v: 'dark', icon: Moon, label: 'Dark' },
            { v: 'system', icon: Monitor, label: 'System' },
          ] as const).map((o) => (
            <button
              key={o.v}
              onClick={() => {
                setTheme(o.v);
                void save({ theme: o.v });
              }}
              className={cn('flex flex-col items-center gap-2 rounded-xl border p-3 text-sm transition hover:border-primary/40', theme === o.v && 'border-primary bg-primary-soft text-primary')}
              aria-pressed={theme === o.v}
            >
              <o.icon className="size-5" /> {o.label}
            </button>
          ))}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Accent colour</p>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c ?? 'company'}
                onClick={() => {
                  setAccent(c);
                  document.documentElement.style.setProperty('--brand', c ?? me.organization.primaryColor);
                  void save({ accent: c });
                }}
                className={cn('grid size-8 place-items-center rounded-full border text-[9px] font-bold transition hover:scale-110', accent === c && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')}
                style={{ background: c ?? `linear-gradient(135deg, ${me.organization.primaryColor}, ${me.organization.secondaryColor})` }}
                aria-label={c ? `Accent ${c}` : 'Company default accent'}
                title={c ?? 'Company default'}
              >
                {!c && <span className="text-white">FG</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

const pwSchema = z
  .object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function Security() {
  const form = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });
  const err = form.formState.errors;
  return (
    <Card>
      <CardHeader title="Password" icon={<KeyRound />} subtitle="Changing it signs out your other sessions" />
      <form
        className="space-y-3 px-5 pb-5"
        noValidate
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await api('/auth/change-password', { body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
            toast.success('Password changed');
            form.reset({ currentPassword: '', newPassword: '', confirm: '' });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}
      >
        <Field label="Current password" htmlFor="cur" error={err.currentPassword?.message}>
          <Input id="cur" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field label="New password" htmlFor="new" error={err.newPassword?.message} hint="10+ characters with upper, lower case and a number">
          <Input id="new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" error={err.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" variant="outline" className="w-full" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </Card>
  );
}

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <h2 className="font-display text-xl font-bold">My profile</h2>
      <p className="mb-6 text-sm text-muted">Manage your profile, appearance and security.</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <ProfileForm />
        <div className="space-y-4">
          <Appearance />
          <Security />
        </div>
      </div>
    </div>
  );
}
