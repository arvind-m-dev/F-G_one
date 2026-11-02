'use client';
import { UserAvatar } from '@/components/user-avatar';
import { timeAgo } from '@/lib/utils';

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  actor: { id: string; firstName: string; lastName: string; avatarColor: string; avatarUrl: string | null } | null;
}

const LABELS: Record<string, string> = {
  'auth.login': 'signed in',
  'auth.logout': 'signed out',
  'auth.locked': 'account locked after failed sign-ins',
  'auth.password_reset_requested': 'requested a password reset',
  'auth.password_reset': 'reset their password',
  'auth.password_changed': 'changed their password',
  'auth.invitation_accepted': 'accepted their invitation',
  'employee.created': 'created an employee',
  'employee.invited': 'sent an invitation',
  'employee.updated': 'updated an employee',
  'employee.role_changed': 'changed a role',
  'employee.deactivated': 'deactivated an employee',
  'employee.reactivated': 'reactivated an employee',
  'department.created': 'created a department',
  'department.updated': 'updated a department',
  'department.deleted': 'deleted a department',
  'settings.updated': 'updated company settings',
  'channel.created': 'created a channel',
  'channel.updated': 'updated a channel',
  'channel.members_added': 'added channel members',
  'channel.member_removed': 'removed a channel member',
  'message.deleted_by_moderator': 'removed a message as moderator',
};

export function describeAudit(e: AuditEntry) {
  const meta = e.metadata ?? {};
  const extra = (meta.email as string) || (meta.name as string) || (meta.to ? `→ ${meta.to}` : '');
  return `${LABELS[e.action] ?? e.action}${extra ? ` · ${extra}` : ''}`;
}

export function AuditList({ items, compact }: { items: AuditEntry[]; compact?: boolean }) {
  return (
    <ul className="divide-y">
      {items.map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
          {e.actor ? (
            <UserAvatar person={{ ...e.actor, name: `${e.actor.firstName} ${e.actor.lastName}` }} size="xs" showPresence={false} />
          ) : (
            <span className="size-6 rounded-full bg-surface-2" />
          )}
          <p className="min-w-0 flex-1 truncate text-sm">
            <b className="font-semibold">{e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : 'System'}</b> <span className="text-muted">{describeAudit(e)}</span>
          </p>
          {!compact && e.ip && <span className="hidden font-mono text-xs text-muted md:block">{e.ip}</span>}
          <span className="shrink-0 text-xs text-muted" title={new Date(e.createdAt).toLocaleString()}>
            {timeAgo(e.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
