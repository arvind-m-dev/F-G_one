'use client';
import { AlertTriangle, Ban, Check, ChevronDown, CircleSlash, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { PERMISSION_CATALOG, PERMISSION_MODULES, SCOPE_LABELS, scopeCovers, widestScope, type CatalogEntry, type Scope } from '@fg/shared';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { isLiveCatalogPermission } from '@/lib/live-modules';
import { useSession } from '@/lib/session';
import type { AccessOverride, AccessValue, Role } from '@/lib/types';
import { cn } from '@/lib/utils';
import { accessPreview, accessProblem, actorFromMe, allowBlock, roleBlock } from './access-model';

/**
 * Edits one person's main role, extra roles and exceptions, with a live preview of what they will be able to do.
 * Choices the signed-in admin can't give are disabled with the reason (same rules as the API).
 */
export function AccessEditor({
  roles,
  value,
  onChange,
  baseline = null,
  readOnly = false,
  superAdmin = false,
}: {
  roles: Role[];
  value: AccessValue;
  onChange: (v: AccessValue) => void;
  /** What the person has now (null for a new account). Unchanged items are always kept. */
  baseline?: AccessValue | null;
  readOnly?: boolean;
  /** The person is a Super Admin: they can do everything whatever is set here. */
  superAdmin?: boolean;
}) {
  const me = useSession();
  const actor = actorFromMe(me);
  const ids = useId();
  const usable = roles.filter((r) => !r.archivedAt || r.id === value.roleId || value.extraRoleIds.includes(r.id));
  const main = roles.find((r) => r.id === value.roleId);
  const mainBlock = main ? roleBlock(actor, main, baseline) : null;
  const problem = readOnly ? null : accessProblem(actor, roles, baseline, value);
  const [showExceptions, setShowExceptions] = useState(value.overrides.length > 0);

  const setOverride = (permission: string, next: AccessOverride | null) => {
    const rest = value.overrides.filter((o) => o.permission !== permission);
    onChange({ ...value, overrides: next ? [...rest, next] : rest });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="space-y-6">
        <section aria-labelledby={`${ids}-main`}>
          <h3 id={`${ids}-main`} className="text-[13px] font-semibold">
            Main role
          </h3>
          <p className="mt-0.5 mb-2 text-xs text-muted">Sets what they can do day to day. Roles you can&apos;t give are greyed out.</p>
          <Select
            aria-label="Main role"
            value={value.roleId}
            disabled={readOnly}
            onChange={(e) => onChange({ ...value, roleId: e.target.value, extraRoleIds: value.extraRoleIds.filter((id) => id !== e.target.value) })}
          >
            {usable.map((r) => {
              const why = roleBlock(actor, r, baseline);
              return (
                <option key={r.id} value={r.id} disabled={!!why} title={why ?? undefined}>
                  {r.name}
                  {why ? ' (you can’t give this)' : ''}
                </option>
              );
            })}
          </Select>
          {main?.description && <p className="mt-1.5 text-xs text-muted">{main.description}</p>}
          {mainBlock && <p className="mt-1.5 text-xs text-danger">{mainBlock}</p>}
        </section>

        <section aria-labelledby={`${ids}-extra`}>
          <h3 id={`${ids}-extra`} className="text-[13px] font-semibold">
            Extra roles <span className="font-normal text-muted">(optional)</span>
          </h3>
          <p className="mt-0.5 mb-2 text-xs text-muted">Add another role on top, for example Manager for someone who also leads a team.</p>
          <ul className="divide-y rounded-xl border bg-surface">
            {usable
              .filter((r) => r.id !== value.roleId)
              .map((r) => {
                const checked = value.extraRoleIds.includes(r.id);
                const why = checked ? null : roleBlock(actor, r, baseline);
                const id = `${ids}-role-${r.id}`;
                return (
                  <li key={r.id} className={cn('flex items-start gap-3 px-3 py-2.5', why && 'opacity-60')}>
                    <input
                      id={id}
                      type="checkbox"
                      className="mt-0.5 size-4 accent-primary"
                      checked={checked}
                      disabled={readOnly || !!why}
                      onChange={(e) => onChange({ ...value, extraRoleIds: e.target.checked ? [...value.extraRoleIds, r.id] : value.extraRoleIds.filter((x) => x !== r.id) })}
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{r.name}</span>
                      {r.archivedAt && <span className="text-muted"> (archived)</span>}
                      {r.description && <span className="block text-xs text-muted">{r.description}</span>}
                      {why && <span className="block text-xs text-muted">{why}</span>}
                    </label>
                  </li>
                );
              })}
          </ul>
        </section>

        <section aria-labelledby={`${ids}-exc`}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={showExceptions}
            aria-controls={`${ids}-exc-list`}
            onClick={() => setShowExceptions((s) => !s)}
          >
            <span>
              <span id={`${ids}-exc`} className="block text-[13px] font-semibold">
                Exceptions for this person {value.overrides.length > 0 && <Badge tone="brand">{value.overrides.length}</Badge>}
              </span>
              <span className="mt-0.5 block text-xs text-muted">Allow one extra thing, or block something their roles would normally allow.</span>
            </span>
            <ChevronDown className={cn('size-4 shrink-0 text-muted transition', showExceptions && 'rotate-180')} aria-hidden />
          </button>
          {showExceptions && (
            <div id={`${ids}-exc-list`} className="mt-3 space-y-4">
              {Object.entries(PERMISSION_MODULES).map(([mod, label]) => {
                // Only features that exist today, plus any exception this person already has.
                const entries = PERMISSION_CATALOG.filter((e) => e.module === mod && (isLiveCatalogPermission(e.key) || value.overrides.some((o) => o.permission === e.key)));
                if (!entries.length) return null;
                return (
                  <div key={mod}>
                    <p className="mb-1 text-xs font-medium text-muted">{label}</p>
                    <ul className="divide-y rounded-xl border bg-surface">
                      {entries.map((e) => (
                        <ExceptionRow key={e.key} entry={e} override={value.overrides.find((o) => o.permission === e.key) ?? null} actor={actor} baseline={baseline} readOnly={readOnly} onChange={(o) => setOverride(e.key, o)} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <AccessPreview roles={roles} value={value} problem={problem} superAdmin={superAdmin} />
    </div>
  );
}

function ExceptionRow({
  entry,
  override,
  actor,
  baseline,
  readOnly,
  onChange,
}: {
  entry: CatalogEntry;
  override: AccessOverride | null;
  actor: ReturnType<typeof actorFromMe>;
  baseline: AccessValue | null;
  readOnly: boolean;
  onChange: (o: AccessOverride | null) => void;
}) {
  const id = useId();
  const mode = override?.effect ?? 'NONE';
  // Default to the widest reach the admin can give themselves.
  const defaultScope = (): Scope => {
    if (actor.isSuperAdmin) return widestScope(entry.key);
    const held = actor.grants[entry.key] as Scope | undefined;
    const ok = [...entry.scopes].reverse().find((s) => held && scopeCovers(held, s));
    return ok ?? widestScope(entry.key);
  };
  const allowScope = (override?.effect === 'ALLOW' ? override.scope : null) as Scope | null;
  const allowWhy = allowBlock(actor, entry.key, allowScope ?? defaultScope(), baseline);
  const options = [
    { v: 'NONE', label: 'As their roles', icon: Check },
    { v: 'ALLOW', label: 'Allow', icon: ShieldCheck },
    { v: 'DENY', label: 'Block', icon: Ban },
  ] as const;
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p id={`${id}-label`} className="text-sm font-medium">
            {entry.label}
            {entry.sensitive && <Badge className="ml-1.5" tone="warning">Super Admin only</Badge>}
          </p>
          <p className="text-xs text-muted">{entry.help}</p>
        </div>
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="inline-flex shrink-0 self-start rounded-lg bg-surface-2 p-0.5">
          {options.map((o) => {
            const disabled = readOnly || (o.v === 'ALLOW' && mode !== 'ALLOW' && !!allowWhy);
            return (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={mode === o.v}
                aria-label={`${o.label}: ${entry.label}`}
                title={o.v === 'ALLOW' && disabled && allowWhy ? allowWhy : undefined}
                disabled={disabled}
                onClick={() => onChange(o.v === 'NONE' ? null : o.v === 'DENY' ? { permission: entry.key, effect: 'DENY', scope: null } : { permission: entry.key, effect: 'ALLOW', scope: defaultScope() })}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5',
                  mode === o.v ? (o.v === 'DENY' ? 'bg-surface text-danger shadow-sm' : o.v === 'ALLOW' ? 'bg-surface text-success shadow-sm' : 'bg-surface shadow-sm') : 'text-muted hover:text-foreground',
                )}
              >
                <o.icon aria-hidden /> {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {mode === 'ALLOW' && entry.scopes.length > 1 && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <label htmlFor={`${id}-scope`} className="text-muted">
            For
          </label>
          <Select
            id={`${id}-scope`}
            className="h-8 w-auto text-xs"
            disabled={readOnly}
            value={allowScope ?? defaultScope()}
            onChange={(e) => onChange({ permission: entry.key, effect: 'ALLOW', scope: e.target.value })}
          >
            {entry.scopes.map((s) => {
              const why = allowBlock(actor, entry.key, s, baseline);
              return (
                <option key={s} value={s} disabled={!!why}>
                  {SCOPE_LABELS[s]}
                  {why ? ' (you can’t give this)' : ''}
                </option>
              );
            })}
          </Select>
        </div>
      )}
      {mode !== 'ALLOW' && allowWhy && !readOnly && <p className="mt-1.5 text-xs text-subtle">Allow is unavailable: {allowWhy.charAt(0).toLowerCase() + allowWhy.slice(1)}.</p>}
    </li>
  );
}

/** Live summary of what the person will be able to do. */
export function AccessPreview({ roles, value, problem, superAdmin }: { roles: Role[]; value: AccessValue; problem?: string | null; superAdmin?: boolean }) {
  const p = accessPreview(roles, value);
  return (
    <aside aria-label="What they can do" className="space-y-4 lg:sticky lg:top-4 lg:self-start">
      <div className="rounded-xl border bg-surface-2/40 p-4">
        <h3 className="text-[13px] font-semibold">What they can do</h3>
        <p className="mt-0.5 text-xs text-muted">
          {superAdmin ? 'Super Admins can do everything, whatever their roles say.' : `Everyone can use their own profile, attendance, leave and chat. On top of that, ${p.count ? `${p.count} permission${p.count === 1 ? '' : 's'}:` : 'nothing else.'}`}
        </p>
        {problem && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-danger/8 px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {problem}
          </p>
        )}
        <div className="mt-3 space-y-4">
          {p.modules.map((m) => (
            <div key={m.key}>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{m.label}</p>
              <ul className="space-y-1.5">
                {m.items.map((i) => (
                  <li key={i.entry.key} className="text-[13px] leading-snug">
                    <span className="font-medium">{i.entry.label}</span>
                    <span className="block text-xs text-muted">
                      {SCOPE_LABELS[i.scope]} · from {i.sources.join(' and ') || 'their roles'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {p.blocked.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Blocked for them</p>
            <ul className="space-y-1">
              {p.blocked.map((e) => (
                <li key={e.key} className="flex items-center gap-1.5 text-[13px] text-danger">
                  <CircleSlash className="size-3.5" aria-hidden /> {e.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
