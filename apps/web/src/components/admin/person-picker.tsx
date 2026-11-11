'use client';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/dropdown';
import { inputClass } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { UserAvatar } from '@/components/user-avatar';
import { errorMessage } from '@/lib/api';
import { useEmployeeList } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export interface PickedPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
  avatarColor?: string;
  designation?: string | null;
}

/**
 * Choose one active employee by searching their name or email. Unlike a plain list it works
 * for any company size. `selected` is the person `value` points at when the form opens.
 */
export function PersonPicker({
  id,
  value,
  selected,
  onChange,
  emptyLabel,
  excludeId,
  disabled,
}: {
  /** Matches the field label's `htmlFor`. */
  id: string;
  value: string | null;
  selected?: PickedPerson | null;
  onChange: (person: PickedPerson | null) => void;
  /** Shown for "nobody", for example "No manager". */
  emptyLabel: string;
  /** Someone who must not be offered (a person cannot report to themselves). */
  excludeId?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<PickedPerson | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const people = useEmployeeList({ q: debounced || undefined, status: 'ACTIVE', pageSize: 8 }, open);
  const results = (people.data?.items ?? []).filter((p) => p.id !== excludeId);
  // Row 0 is "nobody"; it is hidden while searching.
  const rows: (PickedPerson | null)[] = debounced ? results : [null, ...results];
  useEffect(() => setActive(0), [debounced, open]);

  const current = !value ? null : picked?.id === value ? picked : selected?.id === value ? selected : null;
  const choose = (p: PickedPerson | null) => {
    setPicked(p);
    onChange(p);
    setOpen(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active] !== undefined) choose(rows[active]!);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button id={id} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} className={cn(inputClass, 'items-center justify-between gap-2 text-left')}>
          <span className={cn('min-w-0 truncate', !value && 'text-muted')}>{value ? (current?.name ?? 'Selected person') : emptyLabel}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <div className="relative border-b">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={rows.length ? `${listId}-${active}` : undefined}
            aria-label="Search by name or email"
            placeholder="Search by name or email"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-10 w-full rounded-t-xl bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-subtle"
          />
        </div>
        <ul id={listId} role="listbox" className="scrollbar-thin max-h-60 overflow-y-auto p-1">
          {people.isPending ? (
            <li className="space-y-1.5 p-1.5" aria-hidden>
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </li>
          ) : people.isError ? (
            <li className="px-2.5 py-2 text-[13px] text-danger" role="alert">
              {errorMessage(people.error)}
            </li>
          ) : (
            <>
              {rows.map((p, i) => (
                <li
                  key={p?.id ?? 'none'}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={(p?.id ?? null) === (value || null)}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                  className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]', i === active && 'bg-surface-2')}
                >
                  {p ? (
                    <>
                      <UserAvatar person={{ id: p.id, name: p.name, avatarUrl: p.avatarUrl ?? null, avatarColor: p.avatarColor ?? 'var(--brand)' }} size="xs" showPresence={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        {p.designation && <span className="block truncate text-xs text-muted">{p.designation}</span>}
                      </span>
                    </>
                  ) : (
                    <span className="flex-1 text-muted">{emptyLabel}</span>
                  )}
                  {(p?.id ?? null) === (value || null) && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </li>
              ))}
              {results.length === 0 && <li className="px-2.5 py-2 text-[13px] text-muted">{debounced ? 'No active employee matches that search.' : 'No active employees yet.'}</li>}
              {!debounced && people.data && people.data.total > people.data.items.length && <li className="px-2.5 py-1.5 text-xs text-subtle">Type a name to find more people.</li>}
            </>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
