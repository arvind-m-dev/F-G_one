import { ShieldAlert } from 'lucide-react';
import { PageHeader as CanvasHeader } from '@/components/shell/page';

/** Admin pages share the canvas header with an "Admin" eyebrow. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return <CanvasHeader breadcrumbs={[{ label: 'Admin portal', href: '/admin' }, { label: title }]} documentTitle={`${title} · Admin`} title={title} description={description} actions={actions} className="px-0 pt-0 sm:px-0" />;
}

export function Forbidden() {
  return (
    <div className="grid h-full place-items-center p-10 text-center">
      <div>
        <ShieldAlert className="mx-auto mb-3 size-7 text-subtle" />
        <p className="text-base font-semibold">You don&apos;t have access to this page</p>
        <p className="mt-1 text-sm text-muted">Ask an administrator if you think this is a mistake.</p>
      </div>
    </div>
  );
}
