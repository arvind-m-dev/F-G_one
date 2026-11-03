'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, Laptop, LogOut, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { mfaCodeSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Badge, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { isCancelled, useReauth } from './reauth';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  required: boolean;
}
interface DeviceSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

/** "Chrome on macOS" from a user-agent string. Good enough to recognise your own devices. */
export function describeDevice(ua: string | null) {
  if (!ua) return { label: 'Unknown device', mobile: false };
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown system';
  return { label: `${browser} on ${os}`, mobile: /Mobile|iPhone|Android/.test(ua) };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const reportError = (e: unknown) => !isCancelled(e) && toast.error(errorMessage(e));

function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl border bg-surface-2 p-4 font-mono text-[13px]" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success('Copied'))}>
          <Copy /> Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([`FG One recovery codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' }));
            a.download = 'fg-one-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download /> Download
        </Button>
      </div>
    </div>
  );
}

function SetupDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const reauth = useReauth();
  const setup = useQuery({
    queryKey: ['mfa-setup', open],
    queryFn: () => reauth.run(() => api<{ secret: string; otpauthUrl: string; qrSvg: string }>('/auth/mfa/setup', { method: 'POST' })),
    enabled: open,
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
  });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const enable = useMutation({
    mutationFn: (c: string) => api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { body: { code: c } }),
    onSuccess: (r) => setCodes(r.recoveryCodes),
    onError: (e) => setError(errorMessage(e)),
  });
  const close = () => {
    if (codes) onDone();
    setCode('');
    setError(null);
    setCodes(null);
    onOpenChange(false);
  };
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = mfaCodeSchema.safeParse({ code });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Enter the code');
    setError(null);
    enable.mutate(parsed.data.code);
  };

  return (
    <>
      {reauth.dialog}
      <Dialog open={open} onOpenChange={(o) => !o && close()} title={codes ? 'Save your recovery codes' : 'Turn on two-step verification'} description={codes ? 'If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe, such as a password manager. They will not be shown again.' : 'Each sign-in will ask for a 6-digit code from an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password.'}>
        {codes ? (
          <div className="space-y-5">
            <RecoveryCodes codes={codes} />
            <div className="flex justify-end">
              <Button onClick={close}>I have saved them</Button>
            </div>
          </div>
        ) : setup.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : setup.isError ? (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-danger">{isCancelled(setup.error) ? 'You need to confirm it is you to continue.' : errorMessage(setup.error)}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>Close</Button>
              <Button onClick={() => setup.refetch()}>Try again</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            <ol className="space-y-4 text-sm">
              <li>
                <p className="font-medium">1. Scan this code with your authenticator app</p>
                {/* Rendered as an image so the SVG cannot run anything. QR codes need a light background to scan. */}
                <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.data.qrSvg)}`} alt="QR code for your authenticator app" className="mt-3 size-44 rounded-lg border bg-white p-2" />
                <p className="mt-3 text-[13px] text-muted">Cannot scan it? Enter this key in the app instead:</p>
                <code className="mt-1 block rounded-lg bg-surface-2 px-3 py-2 font-mono text-[13px] break-all select-all">{setup.data.secret.match(/.{1,4}/g)?.join(' ')}</code>
              </li>
              <li>
                <Field label="2. Enter the 6-digit code it shows" htmlFor="mfa-code" error={error ?? undefined}>
                  <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!error} className="max-w-40 font-mono tracking-widest" />
                </Field>
              </li>
            </ol>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
              <Button type="submit" loading={enable.isPending}>Turn on</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function SecuritySettings() {
  const me = useSession();
  const qc = useQueryClient();
  const reauth = useReauth();
  const status = useQuery({ queryKey: ['mfa'], queryFn: () => api<MfaStatus>('/auth/mfa') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<DeviceSession[]>('/auth/sessions') });
  const [setupOpen, setSetupOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['mfa'] }), qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['sessions'] })]);

  const disable = useMutation({
    mutationFn: () => reauth.run(() => api('/auth/mfa/disable', { method: 'POST' })),
    onSuccess: () => {
      setConfirmOff(false);
      toast.success('Two-step verification is off');
      void refresh();
    },
    onError: (e) => {
      setConfirmOff(false);
      reportError(e);
    },
  });
  const regenerate = useMutation({
    mutationFn: () => reauth.run(() => api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST' })),
    onSuccess: (r) => {
      setNewCodes(r.recoveryCodes);
      void refresh();
    },
    onError: reportError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Signed out of that device');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: reportError,
  });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ count: number }>('/auth/sessions/revoke-others', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.count ? `Signed out of ${r.count} other device${r.count === 1 ? '' : 's'}` : 'No other devices were signed in');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: reportError,
  });

  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  return (
    <section id="security" className="mb-10 scroll-mt-6">
      {reauth.dialog}
      <h2 className="mb-1 text-[13px] font-semibold text-muted">Security</h2>
      {me.superAdminNeedsMfa && (
        <div role="status" className="mt-2 mb-3 flex gap-3 rounded-xl border border-warning/30 bg-warning/8 p-3 text-[13px]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-medium">Your Super Admin authority is paused.</span> Super Admins must use two-step verification. Turn it on below to use it.
          </p>
        </div>
      )}
      <div className="divide-y border-y">
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <p className="flex items-center gap-2 text-sm font-medium">
              Two-step verification
              {status.data && (status.data.enabled ? <Badge tone="success">On</Badge> : <Badge tone="muted">Off</Badge>)}
            </p>
            <p className="text-[13px] text-muted">
              {status.data?.enabled
                ? `Sign-ins ask for a code from your authenticator app. Turned on ${status.data.enabledAt ? when(status.data.enabledAt) : ''}. ${status.data.recoveryCodesLeft} recovery code${status.data.recoveryCodesLeft === 1 ? '' : 's'} left.`
                : 'Adds a code from your phone to every sign-in, so a stolen password is not enough.'}
            </p>
            {status.data?.enabled && status.data.required && <p className="mt-1 text-[13px] text-muted">Required for Super Admins, so it cannot be turned off.</p>}
            {status.isError && <p className="text-[13px] text-danger">{errorMessage(status.error)}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {status.isPending ? (
              <Skeleton className="h-8 w-24" />
            ) : status.data?.enabled ? (
              <>
                <Button variant="outline" size="sm" loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
                  <KeyRound /> New recovery codes
                </Button>
                {!status.data.required && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>
                    Turn off
                  </Button>
                )}
              </>
            ) : (
              <Button size="sm" onClick={() => setSetupOpen(true)} disabled={status.isError}>
                <ShieldCheck /> Turn on
              </Button>
            )}
          </div>
        </div>

        <div className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-md">
              <p className="text-sm font-medium">Signed-in devices</p>
              <p className="text-[13px] text-muted">If you see a device you do not recognise, sign it out and change your password.</p>
            </div>
            {others > 0 && (
              <Button variant="outline" size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
                <LogOut /> Sign out all other devices
              </Button>
            )}
          </div>
          {sessions.isPending ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sessions.isError ? (
            <p className="mt-3 text-[13px] text-danger">{errorMessage(sessions.error)}</p>
          ) : (
            <ul className="mt-3 divide-y rounded-xl border" aria-label="Signed-in devices">
              {sessions.data.map((s) => {
                const d = describeDevice(s.userAgent);
                const Icon = d.mobile ? Smartphone : Laptop;
                return (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Icon className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm">
                        {d.label}
                        {s.current && <Badge tone="brand">This device</Badge>}
                      </p>
                      <p className="truncate text-[12px] text-muted">
                        Last active {when(s.lastSeenAt)}
                        {s.ip ? ` · ${s.ip}` : ''}
                      </p>
                    </div>
                    {!s.current && (
                      <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)} aria-label={`Sign out ${d.label}`}>
                        Sign out
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <SetupDialog open={setupOpen} onOpenChange={setSetupOpen} onDone={() => void refresh()} />
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Turn off two-step verification?"
        description="Sign-ins will only need your password. Your authenticator app and recovery codes will stop working for this account."
        confirmLabel="Turn off"
        danger
        loading={disable.isPending}
        onConfirm={() => disable.mutate()}
      />
      <Dialog open={!!newCodes} onOpenChange={(o) => !o && setNewCodes(null)} title="Your new recovery codes" description="Your old codes no longer work. Each new code lets you sign in once. They will not be shown again.">
        {newCodes && (
          <div className="space-y-5">
            <RecoveryCodes codes={newCodes} />
            <div className="flex justify-end">
              <Button onClick={() => setNewCodes(null)}>I have saved them</Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
