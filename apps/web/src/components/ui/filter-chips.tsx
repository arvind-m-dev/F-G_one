'use client';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional count shown after the label. */
  count?: number | null;
}

/**
 * One-of-many filter shown as a row of chips (scrolls sideways on phones).
 * Behaves like radio buttons: Tab reaches the selected chip, arrow keys move and select.
 * Keep `value` in the URL with `useUrlState`.
 */
export function FilterChips<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly FilterOption<T>[];
  /** Accessible name for the group, for example "Status". */
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : step ? (i + step + options.length) % options.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to]!.value);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  };
  const selected = options.some((o) => o.value === value);
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cn('scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (!selected && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition',
              on ? 'border-foreground/20 bg-foreground text-canvas' : 'text-muted hover:border-border-strong hover:text-foreground',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="tabular-nums opacity-60">{o.count ?? '–'}</span>}
          </button>
        );
      })}
    </div>
  );
}
