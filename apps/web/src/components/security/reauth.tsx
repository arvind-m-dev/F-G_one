'use client';
import { ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { reauthSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Runs a sensitive action. If the server answers REAUTH_REQUIRED, asks for the password
 * (and an authenticator code when two-step verification is on), then retries once.
 */
export function useReauth() {
  const me = useSession();
  const [open, setOpen] = useState(false);
  const pending = useRef<{ fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'REAUTH_REQUIRED') throw e;
      return new Promise<T>((resolve, reject) => {
        pending.current = { fn, resolve: resolve as (v: unknown) => void, reject };
        setOpen(true);
      });
    }
  }

  const dialog = (
    <ReauthDialog
      open={open}
      needsCode={me.mfaEnabled}
      onCancel={() => {
        setOpen(false);
        pending.current?.reject(new Error('Cancelled'));
        pending.current = null;
      }}
      onConfirmed={async () => {
        setOpen(false);
        const p = pending.current;
        pending.current = null;
        if (!p) return;
        try {
          p.resolve(await p.fn());
        } catch (e) {
          p.reject(e);
        }
      }}
    />
  );
  return { run, dialog };
}

export const isCancelled = (e: unknown) => e instanceof Error && e.message === 'Cancelled';

function ReauthDialog({ open, needsCode, onCancel, onConfirmed }: { open: boolean; needsCode: boolean; onCancel: () => void; onConfirmed: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = reauthSchema.safeParse({ password, code: needsCode ? code : undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the fields');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reauth', { body: parsed.data });
      setPassword('');
      setCode('');
      onConfirmed();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()} title="Confirm it is you" description="This is a sensitive change, so we check again before continuing." className="max-w-md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Your password" htmlFor="reauth-password">
          <Input id="reauth-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {needsCode && (
          <Field label="Code from your authenticator app" htmlFor="reauth-code" hint="Or one of your recovery codes.">
            <Input id="reauth-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-rose-500/8 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            <ShieldCheck /> Confirm
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
