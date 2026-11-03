import { cn } from '@/lib/utils';

/** Canvas page header: quiet, sticky, with title, optional eyebrow and actions. */
export function PageHeader({ title, eyebrow, description, actions, className, children }: { title: React.ReactNode; eyebrow?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn('px-6 pt-8 pb-6 sm:px-10', className)}>
      {eyebrow && <p className="mb-1.5 text-xs font-medium text-muted">{eyebrow}</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.6rem] leading-tight font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
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
