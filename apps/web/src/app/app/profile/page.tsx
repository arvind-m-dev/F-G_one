'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema, updateProfileSchema, type UpdateProfileInput } from '@fg/shared';
import { PageHeader } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

// Stored on the profile as the colour value; the names are what people (and screen readers) see.
const COLORS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#0ea5e9', label: 'Sky blue' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#22c55e', label: 'Green' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#0f172a', label: 'Charcoal' },
];
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
      // What was just saved is the new starting point, so Save switches off until something changes again.
      form.reset(v);
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
                  <button
                    type="button"
                    key={c.value}
                    onClick={() => form.setValue('avatarColor', c.value, { shouldDirty: true })}
                    className={cn('size-7 rounded-full transition hover:scale-110', color === c.value && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')}
                    style={{ background: c.value }}
                    aria-label={c.label}
                    aria-pressed={color === c.value}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
            <Field label="Photo URL (optional)" htmlFor="avatarUrl" error={err.avatarUrl?.message} hint="Paste a link to a photo. It must start with https://">
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
          <Field label="Display name" htmlFor="displayName" hint="Optional. Shown instead of your full name.">
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
              Show my birthday (day and month only) to colleagues
            </label>
          </div>
        </div>
        <Field label="Bio" htmlFor="bio" hint={`${(form.watch('bio') ?? '').length} of 280 characters`}>
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

const pwSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema, confirm: z.string() })
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
        <Field label="New password" htmlFor="new" error={err.newPassword?.message} hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number.">
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

function PasswordByAdmin() {
  return (
    <Card>
      <CardHeader title="Password" icon={<KeyRound />} subtitle="Managed by your administrator" />
      <p className="px-5 pb-5 text-sm text-muted">Your administrator sets and changes passwords for everyone. If you need a new one, ask them.</p>
    </Card>
  );
}

export default function ProfilePage() {
  const me = useSession();
  const selfService = me.organization.settings.auth.selfServicePassword;
  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader className="px-0 pt-0 sm:px-0" title="My profile" description="How colleagues see you across FG One. Theme and display options live in Settings." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <ProfileForm />
        <div className="space-y-4">
          {selfService ? <Security /> : <PasswordByAdmin />}
        </div>
      </div>
    </div>
  );
}
