'use client';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePageTitle } from '@/lib/use-title';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn('mb-2', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-subtle" aria-hidden />}
            {c.href && i < items.length - 1 ? (
              <Link href={c.href} className="rounded px-0.5 hover:text-foreground hover:underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className={i === items.length - 1 ? 'text-foreground/80' : ''}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Canvas page header: breadcrumbs (or eyebrow), title, description and actions.
 * Also sets the browser tab title unless `documentTitle={false}`.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  children,
  breadcrumbs,
  documentTitle,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  breadcrumbs?: Crumb[];
  documentTitle?: string | false;
}) {
  usePageTitle(documentTitle === false ? null : (documentTitle ?? (typeof title === 'string' ? title : undefined)));
  return (
    <header className={cn('px-6 pt-8 pb-6 sm:px-10', className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : eyebrow && <p className="mb-1.5 text-xs font-medium text-muted">{eyebrow}</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.45rem] leading-tight font-semibold tracking-tight sm:text-[1.6rem]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-6 pb-12 sm:px-10', className)}>{children}</div>;
}
