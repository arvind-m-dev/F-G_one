import { ArrowLeft, KeyRound } from 'lucide-react';
import Link from 'next/link';

/** Passwords are reset by an administrator (there is no email reset). */
export default function ForgotPasswordPage() {
  return (
    <>
      <Link href="/login" className="mb-6 inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
          <KeyRound className="size-6" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Forgot your password?</h2>
        <p className="mt-2 text-sm text-muted">
          Ask your HR team or administrator to set a new one for you. They&apos;ll send you a temporary password, and you&apos;ll choose your own the next time you sign in.
        </p>
      </div>
    </>
  );
}
