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
  'employee.email_changed': 'changed an email',
  'employee.password_set': 'set a new password for an employee',
  'employee.sessions_revoked': "signed an employee out everywhere",
  'employee.suspended': 'suspended an employee',
  'employee.unsuspended': 'lifted a suspension',
  'employee.archived': 'archived an employee',
  'employee.restored': 'restored an archived employee',
  'employee.access_changed': "changed an employee's access",
  'auth.mfa_enabled': 'turned on two-step verification',
  'auth.mfa_disabled': 'turned off two-step verification',
  'auth.mfa_failed': 'entered a wrong sign-in code',
  'auth.mfa_recovery_codes_regenerated': 'replaced their recovery codes',
  'auth.reauthenticated': 'confirmed it was them',
  'auth.reauth_failed': 'failed to confirm it was them',
  'auth.session_revoked': 'signed out one of their devices',
  'auth.sessions_revoked': 'signed out their other devices',
  'leave.requested': 'requested leave',
  'leave.recorded': 'recorded leave for someone',
  'leave.cancelled': 'cancelled leave',
  'leave.approved': 'approved a leave request',
  'leave.rejected': 'declined a leave request',
  'attendance.correction_requested': 'asked for an attendance correction',
  'superadmin.invited': 'nominated a Super Admin',
  'superadmin.accepted': 'became a Super Admin',
  'superadmin.removed': 'removed a Super Admin',
  'department.created': 'created a department',
  'department.updated': 'updated a department',
  'department.deleted': 'deleted a department',
  'settings.updated': 'updated company settings',
  'channel.created': 'created a channel',
  'channel.updated': 'updated a channel',
  'channel.members_added': 'added channel members',
  'channel.member_removed': 'removed a channel member',
  'message.deleted_by_moderator': 'removed a message as moderator',
  'superadmin.invite_revoked': 'withdrew a Super Admin nomination',
  'superadmin.reauth_failed': 'entered a wrong password for a Super Admin action',
  'announcement.published': 'published an announcement',
  'announcement.updated': 'updated an announcement',
  'announcement.deleted': 'deleted an announcement',
  'holiday.created': 'added a holiday',
  'holiday.updated': 'updated a holiday',
  'holiday.deleted': 'removed a holiday',
  'leave_type.created': 'added a leave type',
  'leave_type.updated': 'updated a leave type',
  'attendance.exported': 'exported attendance',
  'attendance.corrected': 'approved an attendance correction',
  'attendance.correction_rejected': 'declined an attendance correction',
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
