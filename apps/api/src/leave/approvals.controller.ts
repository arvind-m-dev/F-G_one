import { Controller, Get } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth-context';
import { deciderScope } from '../common/approvals';
import { PrismaService } from '../prisma/prisma.service';

/** Count of things waiting for the caller's decision (for the nav badge). */
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('count')
  async count(@Auth() auth: AuthContext) {
    const leaveScope = deciderScope(auth, 'leave');
    const corrScope = deciderScope(auth, 'attendance');
    const [leave, corrections] = await Promise.all([
      leaveScope ? this.prisma.leaveRequest.count({ where: { ...leaveScope, status: 'PENDING' } }) : 0,
      corrScope ? this.prisma.attendanceCorrection.count({ where: { ...corrScope, status: 'PENDING' } }) : 0,
    ]);
    return { canApprove: !!(leaveScope || corrScope), leave, corrections, total: leave + corrections };
  }
}
