'use client';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export function Badge({ className, tone = 'default', ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'muted' }) {
  const tones = {
    default: 'bg-surface-2 text-foreground',
    brand: 'bg-primary-soft text-primary-ink',
    success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    warning: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
    danger: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    muted: 'bg-surface-2 text-muted',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', tones[tone], className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-2', className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-3 grid size-10 place-items-center rounded-xl border border-dashed border-border-strong text-subtle [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn('peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:opacity-50', className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = 'right' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={8} className="z-50 flex items-center gap-2 rounded-md bg-[#171a2b] px-2 py-1 text-xs font-medium text-white shadow-lg animate-in fade-in dark:bg-elevated dark:text-foreground">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid min-w-[18px] place-items-center rounded border border-border-strong bg-surface px-1 font-sans text-[10px] font-medium text-muted shadow-[0_1px_0_var(--border-strong)]">{children}</kbd>;
}
