import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from './common/auth-context';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health(@Req() req: Request) {
    await this.prisma.$queryRaw`SELECT 1`;
    // clientIp is the address used for rate limiting; compare it with your real IP after deploying.
    return { status: 'ok', time: new Date().toISOString(), clientIp: req.ip };
  }
}
