import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/session.guard';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { OriginCheckMiddleware } from './common/origin.middleware';
import { env } from './common/env';
import { DashboardController } from './dashboard/dashboard.controller';
import { DepartmentsController } from './departments/departments.controller';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { HealthController } from './health.controller';
import { MailService } from './mail/mail.service';
import { MeController } from './me/me.controller';
import { OrganizationController } from './organization/organization.controller';
import { PrismaModule } from './prisma/prisma.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RolesController } from './roles/roles.controller';
import { SearchController } from './search/search.controller';

@Module({
  imports: [
    PrismaModule,
    // Global default: 300 req/min per IP; auth endpoints declare stricter limits.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: env().NODE_ENV === 'test' ? 10_000 : 300 }], skipIf: () => env().NODE_ENV === 'test' }),
  ],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    EmployeesController,
    DepartmentsController,
    RolesController,
    OrganizationController,
    DashboardController,
    ChatController,
    SearchController,
    AuditController,
  ],
  providers: [
    AuditService,
    AuthService,
    MailService,
    EmployeesService,
    ChatService,
    RealtimeGateway,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginCheckMiddleware).forRoutes('*path');
  }
}
