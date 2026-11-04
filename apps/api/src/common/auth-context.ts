import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { GrantMap, Permission } from '@fg/shared';

export interface AuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  email: string;
  roleKey: string;
  rank: number;
  /** Legacy flat permissions, derived from `grants` (kept for existing @RequirePermissions checks). */
  permissions: string[];
  /** System authority, separate from roles (User.isSuperAdmin). */
  isSuperAdmin: boolean;
  accountType: 'INTERNAL' | 'CLIENT';
  /** Effective v2 grants: permission → widest scope. */
  grants: GrantMap;
  /** Password accepted, second step still owed (only MFA verify and sign out are allowed). */
  mfaPending: boolean;
  mfaEnabled: boolean;
  /** Signed in with a password an admin set; no permissions until they choose their own. */
  mustChangePassword: boolean;
  /** Super Admin flag is set but authority is dormant until two-step verification is on. */
  superAdminNeedsMfa: boolean;
  /** Last time the user proved who they are (sign-in or re-authentication). */
  authenticatedAt: Date;
  ip?: string;
}

export const IS_PUBLIC = 'fg:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is restricted to Super Admins (the authority flag, not a role). */
export const SUPER_ADMIN_ONLY = 'fg:superAdminOnly';
export const RequireSuperAdmin = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/** Route may be used by client (external) accounts. Everything else is internal-only by default. */
export const CLIENT_ALLOWED = 'fg:clientAllowed';
export const ClientAllowed = () => SetMetadata(CLIENT_ALLOWED, true);

/** Route stays available while the user must replace an admin-set password (me, sign out, change password). */
export const PASSWORD_CHANGE_OK = 'fg:passwordChangeOk';
export const PasswordChangeAllowed = () => SetMetadata(PASSWORD_CHANGE_OK, true);

/** Route may be used by a session that still owes its second sign-in step. */
export const MFA_PENDING_OK = 'fg:mfaPendingOk';
export const MfaPendingAllowed = () => SetMetadata(MFA_PENDING_OK, true);

/** Sensitive route: the user must have signed in or re-authenticated within `minutes`. */
export const RECENT_AUTH = 'fg:recentAuth';
export const RECENT_AUTH_DEFAULT_MINUTES = 10;
export const RequireRecentAuth = (minutes = RECENT_AUTH_DEFAULT_MINUTES) => SetMetadata(RECENT_AUTH, minutes);

export const REQUIRED_PERMISSIONS = 'fg:permissions';
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest();
  return req.auth as AuthContext;
});
