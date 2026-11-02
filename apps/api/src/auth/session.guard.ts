import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermission, type Permission } from '@fg/shared';
import { IS_PUBLIC, REQUIRED_PERMISSIONS } from '../common/auth-context';
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

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, targets);
    if (required?.length && !hasPermission(auth.permissions, required)) {
      throw new ForbiddenException('You do not have permission to do that');
    }
    return true;
  }
}
