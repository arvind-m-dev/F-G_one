'use client';
import { Check } from 'lucide-react';
import { useId } from 'react';
import { ACCENT_PALETTE } from '@fg/shared';
import { cn } from '@/lib/utils';

/**
 * Label colours people can pick for departments and leave types: the approved accent palette
 * plus a few extras so neighbouring items stay easy to tell apart. Stored as the hex value.
 */
export const LABEL_COLORS: readonly { value: string; label: string }[] = [
  ...ACCENT_PALETTE.map((c) => ({ value: c.value.toLowerCase(), label: c.label })),
  { value: '#14b8a6', label: 'Teal' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#94a3b8', label: 'Grey' },
];

/** Named colour swatches. A saved colour that is not in the palette stays selectable as "Current colour". */
export function ColorSwatches({ value, onChange, label = 'Colour' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const id = useId();
  const current = value.toLowerCase();
  const options = LABEL_COLORS.some((c) => c.value === current) ? LABEL_COLORS : [...LABEL_COLORS, { value: current, label: 'Current colour' }];
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium" id={id}>
        {label}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
        {options.map((c) => {
          const on = c.value === current;
          return (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={on}
              onClick={() => onChange(c.value)}
              className={cn('grid size-7 place-items-center rounded-full text-white transition hover:scale-110', on && 'ring-2 ring-primary ring-offset-2 ring-offset-elevated')}
              style={{ background: c.value }}
            >
              {on && <Check className="size-3.5" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
