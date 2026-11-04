import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createEmployeeSchema, listEmployeesQuerySchema, PERMISSIONS, setEmployeePasswordSchema, updateEmployeeSchema } from '@fg/shared';
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

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.employees.get(auth, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(createEmployeeSchema)) body: z.infer<typeof createEmployeeSchema>) {
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
