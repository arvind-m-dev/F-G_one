'use client';
import { Copy, Eye, EyeOff, Wand2 } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/misc';

const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** 14-character temporary password that meets the policy (upper, lower, number); avoids look-alike characters. */
export function generatePassword() {
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0]! % set.length]!;
  const all = LOWER + UPPER + DIGITS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), ...Array.from({ length: 11 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/** Password input with show/hide and a "generate" button. */
export const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { onGenerate: (pw: string) => void }>(
  ({ onGenerate, ...props }, ref) => {
    const [show, setShow] = useState(false);
    return (
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input ref={ref} type={show ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} className="pr-10 font-mono" {...props} />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted transition hover:text-foreground"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Tooltip side="top" content="Generate a strong password">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onGenerate(generatePassword());
              setShow(true);
            }}
          >
            <Wand2 /> Generate
          </Button>
        </Tooltip>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

/** Ready-to-send message with the sign-in details. The password is only shown here, once. */
export function HandoverMessage({ firstName, email, password, organization, reset }: { firstName: string; email: string; password: string; organization: string; reset?: boolean }) {
  const signIn = `${window.location.origin}/login`;
  const message = reset
    ? `Hi ${firstName}, your ${organization} FG One password has been reset.\n\nSign in: ${signIn}\nEmail: ${email}\nTemporary password: ${password}\n\nYou'll be asked to choose a new password when you sign in.`
    : `Hi ${firstName}, welcome to ${organization} on FG One!\n\nSign in: ${signIn}\nEmail: ${email}\nTemporary password: ${password}\n\nYou'll be asked to choose your own password when you first sign in.`;
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4">
      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Send these sign-in details to {firstName}</p>
      <p className="mt-1 text-xs text-muted">Share it privately (for example a direct message). The password is not shown again after you close this; you can always set a new one.</p>
      <Textarea readOnly value={message} rows={7} className="mt-3 font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Sign-in message" />
      <div className="mt-2 flex justify-end">
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(message);
            toast.success('Message copied');
          }}
        >
          <Copy /> Copy message
        </Button>
      </div>
    </div>
  );
}
