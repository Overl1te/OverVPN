import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from '../audit/audit.module';
import { CoreModule } from '../core/core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DailyUsageAggregatorService } from './daily-usage-aggregator.service';
import { LimitEnforcerService } from './limit-enforcer.service';
import { OnlineSessionCollectorService } from './online-session-collector.service';
import { OnlineSessionSweeperService } from './online-session-sweeper.service';
import { TrafficCollectorService } from './traffic-collector.service';
import { UpdateCheckerService } from './update-checker.service';
import { WorkerHealthService } from './worker-health.service';
import { WorkerSchedulerService } from './worker-scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuditModule,
    CoreModule,
    NotificationsModule,
  ],
  providers: [
    WorkerHealthService,
    TrafficCollectorService,
    DailyUsageAggregatorService,
    OnlineSessionCollectorService,
    OnlineSessionSweeperService,
    LimitEnforcerService,
    UpdateCheckerService,
    WorkerSchedulerService,
  ],
  exports: [
    WorkerHealthService,
    TrafficCollectorService,
    DailyUsageAggregatorService,
    OnlineSessionCollectorService,
    OnlineSessionSweeperService,
    LimitEnforcerService,
    UpdateCheckerService,
  ],
})
export class WorkersModule {}
