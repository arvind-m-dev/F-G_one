'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Copy, Crown, Info, Link2, Search, ShieldAlert, ShieldCheck, ShieldOff, UserMinus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SUPER_ADMIN_HARD_LIMIT, superAdminInviteSchema } from '@fg/shared';
import { Forbidden, LoadError, PageHeader } from '@/components/admin/page-header';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { api, errorMessage } from '@/lib/api';
import { useEmployeeList } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Person } from '@/lib/types';
import { useUrlState } from '@/lib/url-state';
import { cn, timeAgo } from '@/lib/utils';

interface SuperAdmin extends Person {
  email: string;
  status: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  authorityActive: boolean;
  isYou: boolean;
}
interface Nomination {
  id: string;
  person: Person & { email: string; mfaEnabled: boolean };
  invitedBy: Person | null;
  createdAt: string;
  expiresAt: string;
}
interface SuperAdminList {
  limit: number;
  hardLimit: number;
  used: number;
  activeCount: number;
  pendingCount: number;
  superAdmins: SuperAdmin[];
  pending: Nomination[];
}

const QK = ['super-admins'];
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: QK });
    void qc.invalidateQueries({ queryKey: ['admin-overview'] });
  };
}

/** Plain-language summary of what the authority means. Shown on the page and in the nomination dialog. */
function WhatItMeans({ compact }: { compact?: boolean }) {
  return (
    <ul className={cn('space-y-1.5 text-[13px] text-muted', compact && 'text-xs')}>
      <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" /> Full control of FG One: every admin page, every employee and every setting.</li>
      <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" /> Can change security settings and manage every administrator.</li>
      <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" /> Can nominate and remove other Super Admins and change how many are allowed.</li>
    </ul>
  );
}

function LastSignIn({ iso }: { iso: string | null }) {
  return <>{iso ? timeAgo(iso) : 'Never'}</>;
}

/* ───────── Nominate ───────── */

function NominateDialog({ open, onOpenChange, data, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; data: SuperAdminList; onDone: () => void }) {
  const me = useSession();
  const reauth = useReauth();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; expiresAt: string; name: string } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) {
      setQ('');
      setPicked(null);
      setPassword('');
      setError(null);
      setResult(null);
    }
  }, [open]);

  const people = useEmployeeList({ q: debounced || undefined, status: 'ACTIVE', pageSize: 8 }, open && !result);
  const blocked = new Set([...data.superAdmins.map((s) => s.id), me.user.id]);
  const pendingFor = new Set(data.pending.map((p) => p.person.id));
  const options = (people.data?.items ?? []).filter((p) => p.accountType === 'INTERNAL' && !blocked.has(p.id));

  const nominate = useMutation({
    mutationFn: (body: { userId: string; password: string }) => reauth.run(() => api<{ id: string; url: string; expiresAt: string }>('/super-admins/invitations', { body })),
    onSuccess: (r) => {
      setResult({ url: r.url, expiresAt: r.expiresAt, name: picked?.name ?? '' });
      setPassword('');
      onDone();
    },
    onError: (e) => {
      if (!isCancelled(e)) setError(errorMessage(e));
    },
  });

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = superAdminInviteSchema.safeParse({ userId: picked?.id ?? '', password });
    if (!picked) return setError('Choose who to nominate');
    if (!parsed.success) return setError('Enter your password to confirm');
    setError(null);
    nominate.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={result ? 'Nomination sent' : 'Nominate a Super Admin'} description={result ? undefined : 'They become a Super Admin only after they accept.'} className="max-w-lg">
      {reauth.dialog}
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-success/30 bg-success/8 p-4">
            <p className="text-sm font-semibold">Send this link to {result.name}</p>
            <p className="mt-1 text-[13px] text-muted">
              It works only for them, only while they are signed in, and until {fmtWhen(result.expiresAt)}. You will not see it again after you close this.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={result.url} aria-label="Nomination link" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.url);
                    toast.success('Link copied');
                  } catch {
                    toast.error('Copy did not work. Select the link and copy it yourself.');
                  }
                }}
              >
                <Copy /> Copy link
              </Button>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">What {result.name.split(' ')[0]} needs to do</p>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
              <li>Sign in to FG One with their own account.</li>
              <li>Turn on two-step verification in Settings, Security (Super Admins must use it).</li>
              <li>Open the link and confirm with their password.</li>
            </ol>
            <p className="mt-2 text-xs text-muted">If email is set up for your company, they also get the link by email.</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="rounded-xl bg-surface-2 p-3.5">
            <p className="mb-2 text-[13px] font-medium">A Super Admin has the highest level of access</p>
            <WhatItMeans compact />
          </div>
          <Field label="Who should become a Super Admin?" htmlFor="sa-search">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input id="sa-search" className="pl-9" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </div>
          </Field>
          <div role="listbox" aria-label="People" className="scrollbar-thin max-h-56 divide-y overflow-y-auto rounded-xl border">
            {people.isPending ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ) : people.isError ? (
              <p className="p-3 text-[13px] text-danger">{errorMessage(people.error)}</p>
            ) : options.length === 0 ? (
              <p className="p-3 text-[13px] text-muted">{debounced ? 'No active employee matches that search.' : 'No one else can be nominated right now.'}</p>
            ) : (
              options.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={picked?.id === p.id}
                  onClick={() => setPicked({ id: p.id, name: p.name })}
                  className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-surface-2', picked?.id === p.id && 'bg-primary-soft hover:bg-primary-soft')}
                >
                  <UserAvatar person={p} size="sm" showPresence={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {p.email}
                      {p.designation ? ` · ${p.designation}` : ''}
                    </span>
                  </span>
                  {pendingFor.has(p.id) && <Badge tone="warning">Already nominated</Badge>}
                  {picked?.id === p.id && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
          {picked && pendingFor.has(picked.id) && <p className="text-xs text-muted">Nominating {picked.name} again replaces their earlier link.</p>}
          <Field label="Your password" htmlFor="sa-password" hint="We ask again because this gives someone full control.">
            <Input id="sa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger/8 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={nominate.isPending} disabled={!picked}>
              <Crown /> {picked ? `Nominate ${picked.name.split(' ')[0]}` : 'Nominate'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/* ───────── Remove ───────── */

function RemoveDialog({ target, onOpenChange }: { target: SuperAdmin | null; onOpenChange: (o: boolean) => void }) {
  const reauth = useReauth();
  const invalidate = useInvalidate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) {
      setPassword('');
      setError(null);
    }
  }, [target]);
  const remove = useMutation({
    mutationFn: () => reauth.run(() => api(`/super-admins/${target!.id}/remove`, { body: { password } })),
    onSuccess: () => {
      toast.success(`${target?.name} is no longer a Super Admin`);
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => {
      if (!isCancelled(e)) setError(errorMessage(e));
    },
  });
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange} title={`Remove ${target?.name ?? ''}'s Super Admin authority?`} className="max-w-md">
      {reauth.dialog}
      <form
        className="space-y-4"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!password) return setError('Enter your password to confirm');
          setError(null);
          remove.mutate();
        }}
      >
        <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3.5 text-[13px]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <p>
            They lose full control straight away. They keep their account and their role, so they can still do whatever their role allows. To give the authority back, you would have to nominate them again.
          </p>
        </div>
        <Field label="Your password" htmlFor="sa-remove-password">
          <Input id="sa-remove-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/8 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={remove.isPending}>
            <UserMinus /> Remove authority
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ───────── Limit ───────── */

function LimitControl({ data }: { data: SuperAdminList }) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const [value, setValue] = useState(String(data.limit));
  useEffect(() => setValue(String(data.limit)), [data.limit]);
  const save = useMutation({
    mutationFn: (limit: number) => api('/organization', { method: 'PATCH', body: { settings: { security: { superAdminLimit: limit } } } }),
    onSuccess: () => {
      toast.success('Limit saved');
      invalidate();
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['organization-settings'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const n = Number(value);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        save.mutate(n);
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="sa-limit" className="text-[13px] font-medium">
          Allowed Super Admins
        </label>
        <Select id="sa-limit" value={value} onChange={(e) => setValue(e.target.value)} className="w-28">
          {Array.from({ length: data.hardLimit || SUPER_ADMIN_HARD_LIMIT }, (_, i) => i + 1).map((i) => (
            <option key={i} value={i} disabled={i < data.activeCount}>
              {i}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="outline" loading={save.isPending} disabled={n === data.limit}>
        Save limit
      </Button>
      <p className="w-full text-xs text-muted">
        Between 1 and {data.hardLimit}. It cannot go below the {data.activeCount} Super Admin{data.activeCount === 1 ? '' : 's'} you have now.
        {n < data.used && n >= data.activeCount ? ' Waiting nominations beyond the limit will not be able to accept.' : ''}
      </p>
    </form>
  );
}

/* ───────── Page ───────── */

function Seats({ data }: { data: SuperAdminList }) {
  const free = Math.max(0, data.limit - data.used);
  const slots = [
    ...Array.from({ length: data.activeCount }, () => 'active' as const),
    ...Array.from({ length: data.pendingCount }, () => 'pending' as const),
    ...Array.from({ length: free }, () => 'free' as const),
  ];
  return (
    <div>
      <p className="text-sm text-muted">Places used</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
        {data.used} <span className="text-lg font-normal text-muted">of {data.limit}</span>
      </p>
      <div className="mt-3 flex gap-1.5" role="img" aria-label={`${data.activeCount} Super Admins, ${data.pendingCount} waiting to accept, ${free} free`}>
        {slots.map((s, i) => (
          <span
            key={i}
            className={cn('h-2 flex-1 rounded-full', s === 'active' && 'bg-primary', s === 'pending' && 'bg-warning', s === 'free' && 'border border-dashed border-border-strong bg-transparent')}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" /> Super Admins {data.activeCount}</li>
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning" /> Waiting to accept {data.pendingCount}</li>
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full border border-dashed border-border-strong" /> Free {free}</li>
      </ul>
    </div>
  );
}

function AuthorityBadge({ s }: { s: SuperAdmin }) {
  if (s.authorityActive) return <Badge tone="success"><ShieldCheck className="size-3" /> Active</Badge>;
  if (s.status !== 'ACTIVE') return <Badge tone="muted">Account {s.status.toLowerCase()}</Badge>;
  return <Badge tone="warning"><ShieldOff className="size-3" /> Paused</Badge>;
}

function SuperAdminRow({ s, onlyOne, onRemove }: { s: SuperAdmin; onlyOne: boolean; onRemove: () => void }) {
  const why = s.isYou
    ? onlyOne
      ? 'You are the only Super Admin. Nominate another so your company always has one.'
      : 'This is you. Only another Super Admin can change your authority.'
    : !s.authorityActive && s.status === 'ACTIVE'
      ? s.mfaEnabled
        ? 'Paused until they replace the temporary password an admin set.'
        : 'Paused until they turn on two-step verification.'
      : null;
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <UserAvatar person={s} size="md" showPresence={false} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{s.name}</span>
            {s.isYou && <Badge tone="brand">You</Badge>}
            <AuthorityBadge s={s} />
          </p>
          <p className="truncate text-xs text-muted">{s.email}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            <span className="flex items-center gap-1">
              {s.mfaEnabled ? <ShieldCheck className="size-3.5 text-success" /> : <ShieldOff className="size-3.5 text-warning" />}
              Two-step verification {s.mfaEnabled ? 'on' : 'off'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" /> Last sign-in <LastSignIn iso={s.lastLoginAt} />
            </span>
          </p>
          {why && <p className="mt-1 text-xs text-muted">{why}</p>}
        </div>
      </div>
      {!s.isYou && (
        <Button variant="outline" size="sm" onClick={onRemove} className="self-start sm:self-center" aria-label={`Remove ${s.name}'s Super Admin authority`}>
          <UserMinus /> Remove authority
        </Button>
      )}
    </li>
  );
}

function SuperAdminsInner() {
  const me = useSession();
  const invalidate = useInvalidate();
  const reauth = useReauth();
  const [get, set] = useUrlState({ nominate: '', remove: '' });
  const [withdrawing, setWithdrawing] = useState<Nomination | null>(null);
  const q = useQuery({ queryKey: QK, queryFn: () => api<SuperAdminList>('/super-admins'), enabled: me.isSuperAdmin });
  const withdraw = useMutation({
    mutationFn: (id: string) => reauth.run(() => api(`/super-admins/invitations/${id}/revoke`, { method: 'POST' })),
    onSuccess: () => {
      toast.success('Nomination withdrawn. The link no longer works.');
      setWithdrawing(null);
      invalidate();
    },
    onError: (e) => {
      if (!isCancelled(e)) toast.error(errorMessage(e));
    },
  });

  if (me.superAdminNeedsMfa) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
        <PageHeader title="Super Admins" description="People with full control of FG One." />
        <div role="status" className="flex max-w-2xl flex-col gap-4 rounded-2xl border border-warning/30 bg-warning/8 p-5 sm:flex-row">
          <ShieldAlert className="size-6 shrink-0 text-warning" />
          <div>
            <p className="font-semibold">Your Super Admin authority is paused</p>
            <p className="mt-1 text-sm text-muted">
              Super Admins must use two-step verification, so a stolen password is never enough to take over the company. Turn it on in your security settings, and this page and everything else a Super Admin can do will work straight away.
            </p>
            <Link href="/app/settings#security">
              <Button className="mt-4">
                <ShieldCheck /> Turn on two-step verification
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!me.isSuperAdmin) return <Forbidden title="Only Super Admins can open this page" description="Super Admins manage who has full control of FG One." />;

  const d = q.data;
  const full = d ? d.used >= d.limit : false;
  const removing = d?.superAdmins.find((s) => s.id === get('remove')) ?? null;

  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      {reauth.dialog}
      <PageHeader
        title="Super Admins"
        description="People with full control of FG One, including security settings and other administrators."
        actions={
          <Button onClick={() => set({ nominate: '1' })} disabled={!d || full} title={full ? 'All places are used. Remove a Super Admin, withdraw a nomination or raise the limit first.' : undefined}>
            <UserPlus /> Nominate a Super Admin
          </Button>
        }
      />
      {q.isError && !d ? (
        <LoadError what="the Super Admins" error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <Skeleton className="h-28" />
            <Skeleton className="h-48" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-10">
            <section className="flex flex-col gap-6 rounded-2xl border bg-surface p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="sm:w-1/2">
                <Seats data={d} />
              </div>
              <div className="sm:w-[46%] sm:border-l sm:pl-6">
                <LimitControl data={d} />
              </div>
            </section>
            {full && (
              <p className="-mt-6 flex items-start gap-2 text-[13px] text-muted">
                <Info className="mt-0.5 size-4 shrink-0" /> All places are used. To nominate someone, remove a Super Admin, withdraw a nomination or raise the limit.
              </p>
            )}

            <section>
              <SectionTitle icon={<Crown />}>Super Admins</SectionTitle>
              <ul className="divide-y rounded-xl border bg-surface" aria-label="Super Admins">
                {d.superAdmins.map((s) => (
                  <SuperAdminRow key={s.id} s={s} onlyOne={d.activeCount <= 1} onRemove={() => set({ remove: s.id })} />
                ))}
              </ul>
            </section>

            <section>
              <SectionTitle icon={<Link2 />}>Waiting to accept</SectionTitle>
              {d.pending.length === 0 ? (
                <div className="rounded-xl border border-dashed">
                  <EmptyState icon={<Link2 />} title="No nominations waiting" description="When you nominate someone, they show here until they accept, the link expires or you withdraw it." />
                </div>
              ) : (
                <ul className="divide-y rounded-xl border bg-surface" aria-label="Nominations waiting to be accepted">
                  {d.pending.map((n) => (
                    <li key={n.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <UserAvatar person={n.person} size="md" showPresence={false} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{n.person.name}</p>
                          <p className="truncate text-xs text-muted">{n.person.email}</p>
                          <p className="mt-1 text-xs text-muted">
                            Nominated by {n.invitedBy?.name ?? 'a former Super Admin'} {timeAgo(n.createdAt)} · Link works until {fmtWhen(n.expiresAt)}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                            {n.person.mfaEnabled ? (
                              <>
                                <ShieldCheck className="size-3.5 text-success" /> Two-step verification is on, so they can accept now.
                              </>
                            ) : (
                              <>
                                <ShieldOff className="size-3.5 text-warning" /> They need to turn on two-step verification before they can accept.
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="self-start sm:self-center" onClick={() => setWithdrawing(n)} aria-label={`Withdraw the nomination for ${n.person.name}`}>
                        Withdraw
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-8 lg:border-l lg:pl-10">
            <section>
              <SectionTitle icon={<Crown />}>What Super Admins can do</SectionTitle>
              <WhatItMeans />
              <p className="mt-3 text-[13px] text-muted">Being a Super Admin is separate from someone&apos;s role. Removing the authority leaves their role as it is.</p>
            </section>
            <section>
              <SectionTitle icon={<ShieldCheck />}>The rules</SectionTitle>
              <ul className="space-y-2.5 text-[13px] text-muted">
                <li>
                  <span className="font-medium text-foreground">A limit of {d.limit}.</span> People waiting to accept take up a place too. The most any company can have is {d.hardLimit}.
                </li>
                <li>
                  <span className="font-medium text-foreground">Two-step verification is required.</span> Without it the authority is paused, and nominees cannot accept.
                </li>
                <li>
                  <span className="font-medium text-foreground">Nobody changes their own authority.</span> Another Super Admin has to do it.
                </li>
                <li>
                  <span className="font-medium text-foreground">There is always at least one.</span> The last Super Admin cannot be removed.
                </li>
                <li>
                  <span className="font-medium text-foreground">Every change is recorded</span> in the audit log, and needs your password.
                </li>
              </ul>
            </section>
          </aside>
        </div>
      )}

      {d && <NominateDialog open={get('nominate') === '1'} onOpenChange={(o) => set({ nominate: o ? '1' : null })} data={d} onDone={invalidate} />}
      <RemoveDialog target={removing} onOpenChange={(o) => !o && set({ remove: null })} />
      <ConfirmDialog
        open={!!withdrawing}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title={`Withdraw ${withdrawing?.person.name ?? ''}'s nomination?`}
        description="The link stops working straight away and the place becomes free. You can nominate them again later."
        confirmLabel="Withdraw"
        danger
        loading={withdraw.isPending}
        onConfirm={() => withdrawing && withdraw.mutate(withdrawing.id)}
      />
    </div>
  );
}

export default function SuperAdminsPage() {
  return (
    <Suspense>
      <SuperAdminsInner />
    </Suspense>
  );
}
