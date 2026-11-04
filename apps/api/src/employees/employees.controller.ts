import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  changeEmployeeEmailSchema,
  createAccountSchema,
  listEmployeesQuerySchema,
  PERMISSIONS,
  setEmployeePasswordSchema,
  suspendEmployeeSchema,
  updateEmployeeAccessSchema,
  updateEmployeeSchema,
} from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext, RequirePermissions, RequireRecentAuth } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listEmployeesQuerySchema)) q: z.infer<typeof listEmployeesQuerySchema>) {
    return this.employees.list(auth, q);
  }

  /** Everything about one person for the admin employee page. */
  @Get(':id/overview')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  overview(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.overview(auth, id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.get(auth, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(createAccountSchema)) body: z.infer<typeof createAccountSchema>) {
    return this.employees.create(auth, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updateEmployeeSchema)) body: z.infer<typeof updateEmployeeSchema>) {
    return this.employees.update(auth, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  deactivate(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.setActive(auth, id, false);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  activate(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.setActive(auth, id, true);
  }

  /** Temporarily blocks an account: signs them out everywhere and closes their live connections. */
  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  @RequireRecentAuth()
  suspend(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(suspendEmployeeSchema)) body: z.infer<typeof suspendEmployeeSchema>) {
    return this.employees.suspend(auth, id, body);
  }

  @Post(':id/unsuspend')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  unsuspend(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.unsuspend(auth, id);
  }

  /** Hides a deactivated account from lists and pickers; history is kept. */
  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  @RequireRecentAuth()
  archive(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.archive(auth, id);
  }

  /** Brings an archived account back as deactivated. */
  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  restore(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.restore(auth, id);
  }

  /** Main role, extra roles and exceptions for one person, and whether the caller may change them. */
  @Get(':id/access')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  access(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.getAccess(auth, id);
  }

  /** Replaces one person's access. Escalation rules in packages/shared/src/access.ts. */
  @Put(':id/access')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  @RequireRecentAuth()
  updateAccess(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updateEmployeeAccessSchema)) body: z.infer<typeof updateEmployeeAccessSchema>) {
    return this.employees.updateAccess(auth, id, body);
  }

  /** Changes the work email (sign-in name) and signs the person out everywhere. */
  @Post(':id/email')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  @RequireRecentAuth()
  changeEmail(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(changeEmployeeEmailSchema)) body: z.infer<typeof changeEmployeeEmailSchema>) {
    return this.employees.changeEmail(auth, id, body.email);
  }

  /** Sets a temporary password the admin hands over; the employee must change it at next sign-in. */
  @Post(':id/password')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  @RequireRecentAuth()
  setPassword(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(setEmployeePasswordSchema)) body: z.infer<typeof setEmployeePasswordSchema>) {
    return this.employees.setPassword(auth, id, body.password);
  }

  /** Devices the employee is signed in on. */
  @Get(':id/sessions')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  sessions(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.listSessions(auth, id);
  }

  /** Signs the employee out everywhere and closes their live connections. */
  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  @RequireRecentAuth()
  revokeSessions(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.revokeSessions(auth, id);
  }
}
