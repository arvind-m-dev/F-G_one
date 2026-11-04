import { ShieldAlert } from 'lucide-react';
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
