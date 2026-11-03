import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  superAdminAcceptSchema, superAdminConfirmSchema, superAdminInviteSchema,
  type SuperAdminAcceptInput, type SuperAdminConfirmInput, type SuperAdminInviteInput,
} from '@fg/shared';
import { Auth, AuthContext, RequireRecentAuth, RequireSuperAdmin } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { SuperAdminsService } from './super-admins.service';

@Controller('super-admins')
export class SuperAdminsController {
  constructor(private readonly svc: SuperAdminsService) {}

  @Get()
  @RequireSuperAdmin()
  list(@Auth() auth: AuthContext) {
    return this.svc.list(auth);
  }

  @Post('invitations')
  @RequireRecentAuth()
  @RequireSuperAdmin()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(superAdminInviteSchema)) body: SuperAdminInviteInput) {
    return this.svc.invite(auth, body.userId, body.password);
  }

  @Post('invitations/:id/revoke')
  @RequireRecentAuth()
  @RequireSuperAdmin()
  @HttpCode(200)
  revoke(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.svc.revokeInvite(auth, id);
  }

  /** Called by the nominee (not yet a Super Admin). */
  @Post('invitations/accept')
  @RequireRecentAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(@Auth() auth: AuthContext, @Body(new ZodPipe(superAdminAcceptSchema)) body: SuperAdminAcceptInput) {
    return this.svc.accept(auth, body.token, body.password);
  }

  @Post(':userId/remove')
  @RequireRecentAuth()
  @RequireSuperAdmin()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  remove(@Auth() auth: AuthContext, @Param('userId') userId: string, @Body(new ZodPipe(superAdminConfirmSchema)) body: SuperAdminConfirmInput) {
    return this.svc.remove(auth, userId, body.password);
  }
}
