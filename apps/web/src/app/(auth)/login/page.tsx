'use client';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Plus, ShieldCheck, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { emailSchema } from '@fg/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { forgetAccount, readRecentAccounts, rememberAccount, type RecentAccount } from '@/lib/recent-accounts';
import { safeNext } from '@/lib/safe-next';
import type { Me } from '@/lib/types';
import { cn, initials } from '@/lib/utils';

type Step = 'choose' | 'email' | 'password' | 'code' | 'demo';
type DemoAccount = { email: string; name: string; role: string | null; avatarColor: string | null };

function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const [recent, setRecent] = useState<RecentAccount[]>([]);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  // Demo only (removed at go-live): populated when DEMO_PASSWORDLESS_LOGIN is on server-side.
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[] | null>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = readRecentAccounts();
    setRecent(list);
    if (list.length) setStep('choose');
  }, []);
  useEffect(() => {
    void api<{ enabled: boolean; accounts: DemoAccount[] }>('/auth/demo-accounts')
      .then((r) => setDemoAccounts(r.enabled ? r.accounts : null))
      .catch(() => setDemoAccounts(null));
  }, []);
  useEffect(() => {
    if (step === 'password') setTimeout(() => pwRef.current?.focus(), 50);
  }, [step]);

  const pick = (e: string) => {
    setEmail(e);
    setError(null);
    setStep('password');
  };
  const continueWithEmail = (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Enter a valid email');
    pick(parsed.data);
  };
  const signIn = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!password) return setError('Enter your password');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ mfaRequired?: boolean; demoMfaCode?: string }>('/auth/login', { body: { email, password } });
      if (res.mfaRequired) {
        setDemoCode(res.demoMfaCode ?? null);
        setPassword('');
        setBusy(false);
        setStep('code');
        return;
      }
      await finish();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const verifyCode = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (code.trim().length < 6) return setError(useRecovery ? 'Enter a recovery code' : 'Enter the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/mfa/verify', { body: { code: code.trim() } });
      await finish();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setCode('');
      setBusy(false);
      if (status === 401) {
        // Too many wrong codes or the step timed out: start again from the password.
        setError(errorMessage(e));
        setStep('password');
        return;
      }
      setError(errorMessage(e));
    }
  };
  const finish = async () => {
    try {
        const me = await api<Me>('/auth/me');
        rememberAccount({ email: me.user.email, name: me.user.name, avatarColor: me.user.avatarColor });
      } catch {
        rememberAccount({ email });
      }
      router.replace(safeNext(params.get('next')));
  };
  // Demo only (removed at go-live): sign in a listed demo account with no password or code.
  const demoLogin = async (demoEmail: string) => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/demo-login', { body: { email: demoEmail } });
      setEmail(demoEmail);
      await finish();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const current = recent.find((r) => r.email === email);

  return (
    <>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
        {step === 'choose' && (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Choose an account</h1>
            <p className="mt-1 text-sm text-muted">Accounts recently used on this device.</p>
            <ul className="mt-6 space-y-1.5" aria-label="Recent accounts">
              {recent.map((a) => (
                <li key={a.email} className="group relative">
                  <button onClick={() => pick(a.email)} className="flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 pr-10 text-left transition hover:border-border-strong hover:shadow-sm">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: `color-mix(in oklab, ${a.avatarColor ?? '#6366f1'} 16%, var(--surface))`, color: `color-mix(in oklab, ${a.avatarColor ?? '#6366f1'} 80%, var(--foreground))` }}>
                      {initials(a.name ?? a.email)}
                    </span>
                    <span className="min-w-0">
                      {a.name && <span className="block truncate text-sm font-medium">{a.name}</span>}
                      <span className="block truncate text-[13px] text-muted">{a.email}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      forgetAccount(a.email);
                      const left = readRecentAccounts();
                      setRecent(left);
                      if (!left.length) setStep('email');
                    }}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-subtle opacity-0 transition group-hover:opacity-100 hover:bg-surface-2 hover:text-foreground focus:opacity-100"
                    aria-label={`Remove ${a.email} from this device`}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => { setEmail(''); setStep('email'); }} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted transition hover:bg-surface-2 hover:text-foreground">
              <span className="grid size-9 place-items-center rounded-full border border-dashed border-border-strong">
                <Plus className="size-4" />
              </span>
              Use another email
            </button>
          </>
        )}

        {step === 'email' && (
          <form onSubmit={continueWithEmail} noValidate>
            <h1 className="text-xl font-semibold tracking-tight">Sign in to FG One</h1>
            <p className="mt-1 text-sm text-muted">Use your Futurist Global work email.</p>
            <div className="mt-6 space-y-4">
              <Field label="Work email" htmlFor="email" error={error ?? undefined}>
                <Input id="email" type="email" autoComplete="username" autoFocus placeholder="you@futuristglobal.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} aria-invalid={!!error} />
              </Field>
              <Button type="submit" size="lg" className="w-full">
                Continue <ArrowRight />
              </Button>
            </div>
            {recent.length > 0 && (
              <button type="button" onClick={() => setStep('choose')} className="mt-4 text-[13px] text-muted hover:text-foreground">
                Back to saved accounts
              </button>
            )}
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={signIn} noValidate>
            <button type="button" onClick={() => { setPassword(''); setError(null); setStep(recent.length ? 'choose' : 'email'); }} className="mb-5 inline-flex items-center gap-1.5 rounded-full border bg-surface py-1 pr-3 pl-1 text-[13px] transition hover:border-border-strong">
              <span className="grid size-6 place-items-center rounded-full bg-surface-2">
                <ArrowLeft className="size-3.5" />
              </span>
              <span className="max-w-[260px] truncate">{current?.name ? `${current.name} · ` : ''}{email}</span>
            </button>
            <h1 className="text-xl font-semibold tracking-tight">{current?.name ? `Welcome back, ${current.name.split(' ')[0]}` : 'Enter your password'}</h1>
            {/* Hidden username field lets password managers pair the credential. */}
            <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
            <div className="mt-6 space-y-4">
              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input ref={pwRef} id="password" type={show ? 'text' : 'password'} autoComplete="current-password" className="pr-10" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-subtle hover:text-foreground" aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              {error && (
                <p role="alert" className="rounded-lg bg-rose-500/8 px-3 py-2 text-[13px] text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Sign in
              </Button>
              <div className="text-center">
                <Link href="/forgot-password" className="text-[13px] text-muted hover:text-foreground">
                  Forgot your password?
                </Link>
              </div>
            </div>
          </form>
        )}
        {step === 'code' && (
          <form onSubmit={verifyCode} noValidate>
            <span className="mb-5 grid size-10 place-items-center rounded-xl bg-surface-2">
              <ShieldCheck className="size-5 text-primary" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight">Two-step verification</h1>
            <p className="mt-1 text-sm text-muted">{useRecovery ? 'Enter one of the recovery codes you saved. Each code works once.' : 'Open your authenticator app and enter the 6-digit code for FG One.'}</p>
            {demoCode && !useRecovery && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px]">
                Demo account: enter <span className="font-mono font-semibold tabular-nums">{demoCode}</span> as the code.
              </p>
            )}
            <div className="mt-6 space-y-4">
              <Field label={useRecovery ? 'Recovery code' : 'Code'} htmlFor="code">
                <Input
                  id="code"
                  autoFocus
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  placeholder={useRecovery ? 'xxxx-xxxx-xxxx' : '123456'}
                  className="font-mono tracking-widest"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={!!error}
                />
              </Field>
              {error && (
                <p role="alert" className="rounded-lg bg-rose-500/8 px-3 py-2 text-[13px] text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                Verify and sign in
              </Button>
              <div className="flex justify-between text-[13px]">
                <button type="button" className="text-muted hover:text-foreground" onClick={() => { setUseRecovery((r) => !r); setCode(''); setError(null); }}>
                  {useRecovery ? 'Use the authenticator app' : 'Use a recovery code'}
                </button>
                <button
                  type="button"
                  className="text-muted hover:text-foreground"
                  onClick={() => {
                    void api('/auth/logout', { method: 'POST' }).catch(() => undefined);
                    setCode('');
                    setError(null);
                    setStep('password');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {step === 'demo' && (
          <>
            <button type="button" onClick={() => { setError(null); setStep(recent.length ? 'choose' : 'email'); }} className="mb-5 inline-flex items-center gap-1.5 rounded-full border bg-surface py-1 pr-3 pl-1 text-[13px] transition hover:border-border-strong">
              <span className="grid size-6 place-items-center rounded-full bg-surface-2">
                <ArrowLeft className="size-3.5" />
              </span>
              Back to sign in
            </button>
            <h1 className="text-xl font-semibold tracking-tight">Sign in without a password</h1>
            <p className="mt-1 text-sm text-muted">Demo workspace. Pick an account to sign in straight away — no password or code.</p>
            <ul className="mt-6 space-y-1.5" aria-label="Demo accounts">
              {demoAccounts?.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => demoLogin(a.email)}
                    className="flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left transition hover:border-border-strong hover:shadow-sm disabled:opacity-60"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: `color-mix(in oklab, ${a.avatarColor ?? '#6366f1'} 16%, var(--surface))`, color: `color-mix(in oklab, ${a.avatarColor ?? '#6366f1'} 80%, var(--foreground))` }}>
                      {initials(a.name || a.email)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.name || a.email}</span>
                      <span className="block truncate text-[13px] text-muted">{a.role ? `${a.role} · ${a.email}` : a.email}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-rose-500/8 px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            )}
          </>
        )}
      </motion.div>
    </AnimatePresence>
    {demoAccounts && demoAccounts.length > 0 && (step === 'email' || step === 'choose' || step === 'password') && (
      <div className="mt-6 border-t pt-4 text-center">
        <button type="button" onClick={() => { setError(null); setStep('demo'); }} className="text-[13px] text-muted underline underline-offset-4 transition hover:text-foreground">
          Sign in without a password
        </button>
      </div>
    )}
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginFlow />
      <p className={cn('mt-8 border-t pt-5 text-center text-xs text-subtle')}>No account yet? Your administrator creates one for you.</p>
    </Suspense>
  );
}
