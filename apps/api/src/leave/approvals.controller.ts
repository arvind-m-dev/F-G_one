import { Controller, Get } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth-context';
import { deciderScope } from '../common/approvals';
import { PrismaService } from '../prisma/prisma.service';
import { WorkService } from '../work/work.service';

/** Count of things waiting for the caller's decision (for the nav badge). */
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly work: WorkService,
  ) {}

  @Get('count')
  async count(@Auth() auth: AuthContext) {
    const leaveScope = deciderScope(auth, 'leave');
    const corrScope = deciderScope(auth, 'attendance');
    const [leave, corrections, work] = await Promise.all([
      leaveScope ? this.prisma.leaveRequest.count({ where: { ...leaveScope, status: 'PENDING' } }) : 0,
      corrScope ? this.prisma.attendanceCorrection.count({ where: { ...corrScope, status: 'PENDING' } }) : 0,
      // Project leads decide on timeline requests too, so this is counted for everyone.
      this.prisma.workRequest.count({ where: { AND: [this.work.deciderWhere(auth), { status: 'PENDING' }] } }),
    ]);
    return { canApprove: !!(leaveScope || corrScope) || work > 0, leave, corrections, work, total: leave + corrections + work };
  }
}
