import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@fg/shared';

export interface AuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  email: string;
  roleKey: string;
  rank: number;
  permissions: string[];
  ip?: string;
}

export const IS_PUBLIC = 'fg:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSIONS = 'fg:permissions';
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest();
  return req.auth as AuthContext;
});
