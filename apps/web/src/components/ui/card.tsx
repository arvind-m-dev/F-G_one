import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-surface', className)} {...props} />;
}

/** Section heading used inside pages — quiet label style, not a boxed card header. */
export function SectionTitle({ children, action, className, icon }: { children: React.ReactNode; action?: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground [&_svg]:size-4 [&_svg]:text-muted">
        {icon}
        {children}
      </h2>
      {action}
    </div>
  );
}

export function CardHeader({ title, icon, action, subtitle, className }: { title: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; subtitle?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-muted [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
