import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { decisionSchema, isCalendarDate, leaveCalendarSchema, leaveListSchema, leaveRequestSchema, recordLeaveSchema, leaveTypeSchema, PERMISSIONS, type LeaveRequestInput, type RecordLeaveInput, type LeaveTypeInput } from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { LeaveService } from './leave.service';

const typesQuery = z.object({ include: z.enum(['active', 'all']).default('active') });
/** `at`: a date in the leave year to show (default: today in the organization's time zone). */
const balanceQuery = z.object({ userId: z.string().max(40).optional(), at: z.string().refine(isCalendarDate, 'Use YYYY-MM-DD').optional() });

@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  types(@Auth() auth: AuthContext, @Query(new ZodPipe(typesQuery)) q: z.infer<typeof typesQuery>) {
    return this.leave.listTypes(auth, q.include === 'all');
  }

  @Post('types')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  createType(@Auth() auth: AuthContext, @Body(new ZodPipe(leaveTypeSchema)) body: LeaveTypeInput) {
    return this.leave.createType(auth, body);
  }

  @Patch('types/:id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  updateType(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(leaveTypeSchema.partial())) body: Partial<LeaveTypeInput>) {
    return this.leave.updateType(auth, id, body);
  }

  @Get('balances')
  balances(@Auth() auth: AuthContext, @Query(new ZodPipe(balanceQuery)) q: z.infer<typeof balanceQuery>) {
    return this.leave.balances(auth, q.userId ?? auth.userId, q.at);
  }

  @Post('preview')
  @HttpCode(200)
  preview(@Auth() auth: AuthContext, @Body(new ZodPipe(leaveRequestSchema)) body: LeaveRequestInput) {
    return this.leave.preview(auth, body);
  }

  @Get('requests')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(leaveListSchema)) q: z.infer<typeof leaveListSchema>) {
    return this.leave.list(auth, q.scope, q.status);
  }

  @Post('requests')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(leaveRequestSchema)) body: LeaveRequestInput) {
    return this.leave.create(auth, body);
  }

  /** HR/admin records leave on someone's behalf; approved straight away. */
  @Post('requests/record')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_MANAGE)
  record(@Auth() auth: AuthContext, @Body(new ZodPipe(recordLeaveSchema)) body: RecordLeaveInput) {
    return this.leave.record(auth, body);
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  decide(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.leave.decide(auth, id, body.decision, body.note);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.leave.cancel(auth, id);
  }

  @Get('calendar')
  calendar(@Auth() auth: AuthContext, @Query(new ZodPipe(leaveCalendarSchema)) q: z.infer<typeof leaveCalendarSchema>) {
    return this.leave.calendar(auth, q.month);
  }
}
