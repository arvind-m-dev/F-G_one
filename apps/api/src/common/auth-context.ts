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

export const REQUIRED_PERMISSIONS = 'fg:permissions';
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest();
  return req.auth as AuthContext;
});
