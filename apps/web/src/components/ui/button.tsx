'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium transition-[background-color,box-shadow,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-[color-mix(in_oklab,var(--primary)_90%,black)]',
        // Same as `primary`; kept because pages outside the admin portal still pass it. Use `primary` in new code.
        gradient: 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-[color-mix(in_oklab,var(--primary)_90%,black)]',
        secondary: 'bg-surface-2 text-foreground hover:bg-[color-mix(in_oklab,var(--surface-2)_80%,var(--foreground)_6%)]',
        outline: 'border border-border-strong bg-surface text-foreground shadow-sm hover:bg-surface-2',
        ghost: 'text-muted hover:bg-surface-2 hover:text-foreground',
        danger: 'bg-danger text-white hover:bg-[color-mix(in_oklab,var(--danger)_88%,black)]',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3',
        lg: 'h-10 px-4 text-sm',
        icon: 'size-8',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
    {loading && <Loader2 className="animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';
