'use client';
import { Check, KeyRound, Minus } from 'lucide-react';
import { ALL_PERMISSIONS, PERMISSIONS } from '@fg/shared';
import { Forbidden, LoadError, PageHeader } from '@/components/admin/page-header';
import { Card } from '@/components/ui/card';
import { Badge, Skeleton } from '@/components/ui/misc';
import { useRoles } from '@/lib/hooks';
import { useCan } from '@/lib/session';

export default function RolesPage() {
  const can = useCan();
  const roles = useRoles();
  if (!can(PERMISSIONS.EMPLOYEES_MANAGE)) return <Forbidden />;
  return (
    <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-14 sm:px-10">
      <PageHeader title="Roles & access" description="What each role can do. Permissions are enforced by the API on every request." />
      {roles.isError ? (
        <LoadError what="roles" error={roles.error} onRetry={() => roles.refetch()} />
      ) : !roles.data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {roles.data.roles.map((r) => (
              <Card key={r.id} className="p-5">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
                    <KeyRound className="size-4" />
                  </span>
                  {r.isSystem && <Badge tone="muted">system</Badge>}
                </div>
                <p className="mt-3 font-semibold">{r.name}</p>
                <p className="text-sm text-muted">{r.description}</p>
                <p className="mt-3 text-xs text-muted">
                  <b className="text-foreground">{r.memberCount}</b> members · {r.permissions.length} permissions
                </p>
              </Card>
            ))}
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-surface-2/50 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3">Permission</th>
                  {roles.data.roles.map((r) => (
                    <th key={r.id} className="px-4 py-3 text-center">
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {ALL_PERMISSIONS.map((p) => (
                  <tr key={p} className="hover:bg-surface-2/40">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{roles.data.permissionLabels[p]}</p>
                      <p className="font-mono text-xs text-muted">{p}</p>
                    </td>
                    {roles.data.roles.map((r) => (
                      <td key={r.id} className="px-4 py-2.5 text-center">
                        {r.permissions.includes(p) ? <Check className="mx-auto size-4 text-success" aria-label="Granted" /> : <Minus className="mx-auto size-4 text-muted/50" aria-label="Not granted" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="mt-3 text-xs text-muted">Custom roles and per-permission editing are planned for a later milestone; the data model already supports them.</p>
        </>
      )}
    </div>
  );
}
