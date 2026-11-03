import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { attendanceBoardSchema, attendanceRangeSchema, checkInSchema, checkOutSchema, correctionSchema, decisionSchema, type CorrectionInput } from '@fg/shared';
import { z } from 'zod';
import { Auth, AuthContext } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('today')
  today(@Auth() auth: AuthContext) {
    return this.attendance.today(auth);
  }

  @Post('check-in')
  @HttpCode(200)
  checkIn(@Auth() auth: AuthContext, @Body(new ZodPipe(checkInSchema)) body: z.infer<typeof checkInSchema>) {
    return this.attendance.checkIn(auth, body.location, body.remarks);
  }

  /** Called by the portal on open; checks in only when the company uses automatic check-in and today qualifies. */
  @Post('auto-check-in')
  @HttpCode(200)
  autoCheckIn(@Auth() auth: AuthContext) {
    return this.attendance.autoCheckIn(auth);
  }

  /** Activity heartbeat for the idle auto check-out rule. */
  @Post('activity')
  @HttpCode(200)
  activity(@Auth() auth: AuthContext) {
    return this.attendance.activity(auth);
  }

  @Post('break/start')
  @HttpCode(200)
  startBreak(@Auth() auth: AuthContext) {
    return this.attendance.startBreak(auth);
  }

  @Post('break/end')
  @HttpCode(200)
  endBreak(@Auth() auth: AuthContext) {
    return this.attendance.endBreak(auth);
  }

  @Post('check-out')
  @HttpCode(200)
  checkOut(@Auth() auth: AuthContext, @Body(new ZodPipe(checkOutSchema)) body: z.infer<typeof checkOutSchema>) {
    return this.attendance.checkOut(auth, body.remarks);
  }

  @Get('me')
  mine(@Auth() auth: AuthContext, @Query(new ZodPipe(attendanceRangeSchema)) q: z.infer<typeof attendanceRangeSchema>) {
    return this.attendance.history(auth, auth.userId, q.from, q.to);
  }

  /** Team views — permission (view_all / view_team) is checked in the service. */
  @Get('board')
  board(@Auth() auth: AuthContext, @Query(new ZodPipe(attendanceBoardSchema)) q: z.infer<typeof attendanceBoardSchema>) {
    return this.attendance.board(auth, q.date);
  }

  @Get('users/:id')
  forUser(@Auth() auth: AuthContext, @Param('id') id: string, @Query(new ZodPipe(attendanceRangeSchema)) q: z.infer<typeof attendanceRangeSchema>) {
    return this.attendance.history(auth, id, q.from, q.to);
  }

  @Post('corrections')
  requestCorrection(@Auth() auth: AuthContext, @Body(new ZodPipe(correctionSchema)) body: CorrectionInput) {
    return this.attendance.requestCorrection(auth, body);
  }

  @Get('corrections')
  corrections(@Auth() auth: AuthContext, @Query(new ZodPipe(z.object({ scope: z.enum(['mine', 'approvals']).default('mine') }))) q: { scope: 'mine' | 'approvals' }) {
    return this.attendance.listCorrections(auth, q.scope);
  }

  @Post('corrections/:id/decision')
  @HttpCode(200)
  decide(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.attendance.decideCorrection(auth, id, body.decision, body.note);
  }

  @Get('export')
  async export(@Auth() auth: AuthContext, @Query(new ZodPipe(attendanceRangeSchema)) q: z.infer<typeof attendanceRangeSchema>, @Res() res: Response) {
    const { filename, csv } = await this.attendance.exportCsv(auth, q.from, q.to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`﻿${csv}`);
  }
}
