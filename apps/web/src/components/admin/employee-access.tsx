'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, RotateCcw, RotateCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AccessEditor } from '@/components/admin/access-editor';
import { accessProblem, actorFromMe, sameAccess } from '@/components/admin/access-model';
import { isCancelled, useReauth } from '@/components/security/reauth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useRoles } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { AccessOverride, AccessValue } from '@/lib/types';

interface AccessResponse {
  userId: string;
  roleId: string;
  extraRoleIds: string[];
  overrides: (AccessOverride & { reason: string | null; createdAt: string })[];
  grants: Record<string, string>;
  isSuperAdmin: boolean;
  superAdminActive: boolean;
  editable: boolean;
  readOnlyReason: string | null;
}

const toValue = (a: AccessResponse): AccessValue => ({ roleId: a.roleId, extraRoleIds: a.extraRoleIds, overrides: a.overrides.map((o) => ({ permission: o.permission, effect: o.effect, scope: o.scope })) });

/**
 * The Access section of the employee page: main role, extra roles and exceptions, with a live preview.
 * Saving replaces their access in one request; it applies on their next action, no sign-out needed.
 */
export function EmployeeAccess({ userId, firstName }: { userId: string; firstName: string }) {
  const me = useSession();
  const qc = useQueryClient();
  const reauth = useReauth();
  const roles = useRoles();
  const q = useQuery({ queryKey: ['employee-access', userId], queryFn: () => api<AccessResponse>(`/employees/${userId}/access`) });
  const [draft, setDraft] = useState<AccessValue | null>(null);
  useEffect(() => {
    if (q.data) setDraft(toValue(q.data));
  }, [q.data]);

  const save = useMutation({
    mutationFn: (v: AccessValue) => reauth.run(() => api<AccessResponse>(`/employees/${userId}/access`, { method: 'PUT', body: v })),
    onSuccess: (data) => {
      qc.setQueryData(['employee-access', userId], data);
      void qc.invalidateQueries({ queryKey: ['employee-overview', userId] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
      toast.success(`Access updated. ${firstName} sees the change on their next click; no need to sign out.`);
    },
    onError: (e) => {
      if (!isCancelled(e)) toast.error(errorMessage(e));
    },
  });

  if (q.isPending || roles.isPending || (q.data && !draft)) {
    return (
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (q.isError || roles.isError) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle />}
          title="Couldn't load their access"
          description={errorMessage(q.error ?? roles.error)}
          action={
            <Button variant="outline" onClick={() => void Promise.all([q.refetch(), roles.refetch()])}>
              <RotateCw /> Try again
            </Button>
          }
        />
      </Card>
    );
  }

  const data = q.data;
  const baseline = toValue(data);
  const value = draft!;
  const dirty = !sameAccess(baseline, value);
  const readOnly = !data.editable;
  const problem = readOnly ? null : accessProblem(actorFromMe(me), roles.data.roles, baseline, value);

  return (
    <div className="space-y-5">
      {data.readOnlyReason && (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {data.readOnlyReason}
        </p>
      )}
      {data.isSuperAdmin && (
        <p className="flex items-start gap-2 rounded-lg bg-primary-soft px-3 py-2 text-[13px] text-primary-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {data.superAdminActive
            ? 'They are a Super Admin, so they can do everything whatever is set here. These settings apply if their Super Admin authority is removed.'
            : 'They hold Super Admin authority, paused until they turn on two-step verification. Until then, what is set here applies.'}
        </p>
      )}
      <AccessEditor roles={roles.data.roles} value={value} onChange={setDraft} baseline={baseline} readOnly={readOnly} superAdmin={data.superAdminActive} />
      {!readOnly && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-elevated/95 px-4 py-3 shadow-md backdrop-blur">
          <p className="mr-auto text-xs text-muted" aria-live="polite">
            {dirty ? 'You have unsaved changes.' : 'No changes.'}
          </p>
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(baseline)}>
            <RotateCcw /> Discard
          </Button>
          <Button disabled={!dirty || !!problem} loading={save.isPending} onClick={() => save.mutate(value)}>
            <Save /> Save access
          </Button>
        </div>
      )}
      {reauth.dialog}
    </div>
  );
}
