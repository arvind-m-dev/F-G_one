import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AnnouncementsController } from './announcements/announcements.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { AuditController } from './audit/audit.controller';
import { HolidaysController } from './holidays/holidays.controller';
import { ApprovalsController } from './leave/approvals.controller';
import { LeaveController } from './leave/leave.controller';
import { LeaveService } from './leave/leave.service';
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
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { OrganizationController } from './organization/organization.controller';
import { PrismaModule } from './prisma/prisma.service';
import { SuperAdminsController } from './super-admins/super-admins.controller';
import { SuperAdminsService } from './super-admins/super-admins.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RolesController } from './roles/roles.controller';
import { SearchController } from './search/search.controller';
import { WorkController } from './work/work.controller';
import { WorkService } from './work/work.service';

@Module({
  imports: [
    PrismaModule,
    // Global default: RATE_LIMIT_PER_MIN (300) requests a minute per IP; auth endpoints declare stricter limits.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: env().NODE_ENV === 'test' ? 10_000 : env().RATE_LIMIT_PER_MIN }], skipIf: () => env().NODE_ENV === 'test' }),
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
    AttendanceController,
    AnnouncementsController,
    NotificationsController,
    HolidaysController,
    LeaveController,
    ApprovalsController,
    SuperAdminsController,
    WorkController,
  ],
  providers: [
    AuditService,
    AuthService,
    MailService,
    EmployeesService,
    ChatService,
    RealtimeGateway,
    AttendanceService,
    NotificationsService,
    LeaveService,
    SuperAdminsService,
    WorkService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginCheckMiddleware).forRoutes('*path');
  }
}
