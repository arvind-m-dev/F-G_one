export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-0.5 text-xs font-semibold tracking-wider text-primary uppercase">Administration</p>
        <h2 className="font-display text-xl font-bold">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="grid h-full place-items-center p-10 text-center">
      <div>
        <p className="font-display text-lg font-semibold">You don&apos;t have access to this page</p>
        <p className="mt-1 text-sm text-muted">Ask a Super Admin or HR administrator if you think this is a mistake.</p>
      </div>
    </div>
  );
}
