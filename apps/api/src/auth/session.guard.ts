import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission, type Permission } from '@fg/shared';
import { CLIENT_ALLOWED, IS_PUBLIC, MFA_PENDING_OK, PASSWORD_CHANGE_OK, RECENT_AUTH, REQUIRED_PERMISSIONS, SUPER_ADMIN_ONLY } from '../common/auth-context';
import { env } from '../common/env';
import { AuthService } from './auth.service';

/**
 * Global guard: every route requires a valid session unless marked @Public().
 * Then checks @RequirePermissions(...) against the role's permission set.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { auth?: unknown }>();
    const token = req.cookies?.[env().SESSION_COOKIE_NAME];
    const auth = token ? await this.auth.validateSession(token, req.ip) : null;
    if (!auth) throw new UnauthorizedException('Please sign in');
    req.auth = auth;

    if (auth.mfaPending && !this.reflector.getAllAndOverride<boolean>(MFA_PENDING_OK, targets)) {
      throw new UnauthorizedException({ statusCode: 401, code: 'MFA_REQUIRED', message: 'Enter the code from your authenticator app to finish signing in' });
    }

    // An admin-set temporary password unlocks nothing until the user replaces it.
    if (auth.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_OK, targets)) {
      throw new ForbiddenException({ statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Choose a new password to continue' });
    }

    // Client accounts are default-denied on every internal route.
    if (auth.accountType === 'CLIENT' && !this.reflector.getAllAndOverride<boolean>(CLIENT_ALLOWED, targets)) {
      throw new ForbiddenException('This area is not available to client accounts');
    }
    if (this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, targets) && !auth.isSuperAdmin) {
      if (auth.superAdminNeedsMfa) {
        throw new ForbiddenException({ statusCode: 403, code: 'MFA_SETUP_REQUIRED', message: 'Turn on two-step verification to use your Super Admin authority' });
      }
      throw new ForbiddenException('Only a Super Admin can do that');
    }

    const recent = this.reflector.getAllAndOverride<number>(RECENT_AUTH, targets);
    if (recent && Date.now() - auth.authenticatedAt.getTime() > recent * 60_000) {
      throw new ForbiddenException({ statusCode: 403, code: 'REAUTH_REQUIRED', message: 'For your security, confirm it is you to continue' });
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets);
    if (required?.length && !hasPermission(auth.permissions, required)) {
      throw new ForbiddenException('You do not have permission to do that');
    }
    return true;
  }
}
