import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence-in-depth on top of SameSite=Lax cookies: state-changing requests
 * that carry an Origin header must come from the web app's origin.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (SAFE.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== env().WEB_ORIGIN) throw new ForbiddenException('Cross-origin request blocked');
    next();
  }
}
