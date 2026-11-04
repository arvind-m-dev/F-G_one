import { CircleAlert, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { PageHeader as CanvasHeader, type Crumb } from '@/components/shell/page';

/**
 * Admin pages share the canvas header with "Admin portal" breadcrumbs.
 * Nested pages pass `parents` (e.g. Employees) so the trail reads Admin portal / Employees / Name.
 */
export function PageHeader({
  title,
  description,
  actions,
  parents = [],
  documentTitle,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  parents?: Crumb[];
  documentTitle?: string;
  children?: React.ReactNode;
}) {
  const label = documentTitle ?? (typeof title === 'string' ? title : '');
  return (
    <CanvasHeader
      breadcrumbs={[{ label: 'Admin portal', href: '/admin' }, ...parents, { label }]}
      documentTitle={`${label} · Admin`}
      title={title}
      description={description}
      actions={actions}
      className="px-0 pt-0 sm:px-0"
    >
      {children}
    </CanvasHeader>
  );
}

export function Forbidden({ title = "You don't have access to this page", description = 'Ask an administrator if you think this is a mistake.' }: { title?: string; description?: string }) {
  return (
    <div className="grid h-full place-items-center p-10 text-center">
      <div>
        <ShieldAlert className="mx-auto mb-3 size-7 text-subtle" />
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
    </div>
  );
}

/** Error state for admin pages: what failed, why, and a way to try again. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-5 text-sm sm:flex-row sm:items-center">
      <CircleAlert className="size-5 shrink-0 text-danger" />
      <p className="flex-1">
        <span className="font-medium">We couldn&apos;t load {what}.</span> <span className="text-muted">{errorMessage(error)}</span>
      </p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
