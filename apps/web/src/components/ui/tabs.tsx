'use client';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/**
 * Tabs with keyboard support (arrow keys, Home, End). Put a `TabPanel` per item inside.
 * Keep `value` in the URL with `useUrlState`. `segmented` is the compact switch used above page
 * content; `side` is a list beside the content on desktop that scrolls sideways on phones.
 */
export function Tabs<T extends string>({
  value,
  onValueChange,
  items,
  label,
  variant = 'segmented',
  className,
  listClassName,
  children,
}: {
  value: T;
  onValueChange: (v: T) => void;
  items: readonly TabItem<T>[];
  /** Accessible name for the tab list, for example "Employee sections". */
  label: string;
  variant?: 'segmented' | 'side';
  className?: string;
  listClassName?: string;
  children: React.ReactNode;
}) {
  const side = variant === 'side';
  // The side list is vertical on desktop and horizontal on phones, so both pairs of arrow keys move.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!side || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]?.focus();
  };
  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as T)} orientation={side ? 'vertical' : 'horizontal'} className={className}>
      <div className={cn(!side && 'scrollbar-thin mb-6 overflow-x-auto', side && 'min-w-0')}>
        <TabsPrimitive.List
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cn(side ? 'scrollbar-thin flex gap-1 overflow-x-auto lg:flex-col' : 'inline-flex rounded-lg bg-surface-2 p-0.5', listClassName)}
        >
          {items.map((t) => (
            <TabsPrimitive.Trigger
              key={t.value}
              value={t.value}
              className={cn(
                'shrink-0 font-medium transition',
                side
                  ? 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-2 hover:text-foreground data-[state=active]:bg-primary-soft data-[state=active]:text-primary-ink [&_svg]:size-4'
                  : 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-muted hover:text-foreground data-[state=active]:bg-canvas data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5',
              )}
            >
              {t.icon && <t.icon aria-hidden />}
              {t.label}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
      </div>
      {children}
    </TabsPrimitive.Root>
  );
}

/** The content for one tab. Only the selected panel is rendered. */
export function TabPanel({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className={cn('outline-none', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}
