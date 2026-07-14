import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SupportIntegrityService } from '../common/support-integrity';
import type { AppEnvironment } from '../config/environment';
import { DailyUsageAggregatorService } from './daily-usage-aggregator.service';
import { LimitEnforcerService } from './limit-enforcer.service';
import { OnlineSessionCollectorService } from './online-session-collector.service';
import { OnlineSessionSweeperService } from './online-session-sweeper.service';
import { TrafficCollectorService } from './traffic-collector.service';
import { UpdateCheckerService } from './update-checker.service';

@Injectable()
export class WorkerSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerSchedulerService.name);
  private readonly enabled: boolean;
  private readonly updateCheckEnabled: boolean;
  private readonly intervals: {
    traffic: number;
    aggregate: number;
    online: number;
    sweep: number;
    enforce: number;
    updateCheck: number;
  };

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly traffic: TrafficCollectorService,
    private readonly aggregator: DailyUsageAggregatorService,
    private readonly online: OnlineSessionCollectorService,
    private readonly sweeper: OnlineSessionSweeperService,
    private readonly enforcer: LimitEnforcerService,
    private readonly updateChecker: UpdateCheckerService,
    private readonly supportIntegrity: SupportIntegrityService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.updateCheckEnabled = config.get('UPDATE_CHECK_ENABLED', {
      infer: true,
    });
    this.intervals = {
      traffic: config.get('TRAFFIC_COLLECTION_INTERVAL_MS', { infer: true }),
      aggregate: config.get('TRAFFIC_AGGREGATION_INTERVAL_MS', {
        infer: true,
      }),
      online: config.get('ONLINE_COLLECTION_INTERVAL_MS', { infer: true }),
      sweep: config.get('ONLINE_SWEEP_INTERVAL_MS', { infer: true }),
      enforce: config.get('ENFORCEMENT_INTERVAL_MS', { infer: true }),
      updateCheck: config.get('UPDATE_CHECK_INTERVAL_MS', { infer: true }),
    };
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Scheduled workers are disabled');
      return;
    }
    this.register('traffic-collector', this.intervals.traffic, () =>
      this.traffic.runOnce(),
    );
    this.register('daily-aggregator', this.intervals.aggregate, () =>
      this.aggregator.runOnce(),
    );
    this.register('online-collector', this.intervals.online, () =>
      this.online.runOnce(),
    );
    this.register('online-sweeper', this.intervals.sweep, () =>
      this.sweeper.runOnce(),
    );
    this.register('limit-enforcer', this.intervals.enforce, () =>
      this.enforcer.runOnce(),
    );
    if (this.updateCheckEnabled) {
      this.register('update-checker', this.intervals.updateCheck, () =>
        this.updateChecker.runOnce(),
      );
      const firstCheck = setTimeout(() => {
        void this.updateChecker.runOnce();
      }, 30_000);
      firstCheck.unref();
    }
    this.logger.log('Scheduled workers started');
  }

  private register(
    name: string,
    intervalMs: number,
    operation: () => Promise<unknown>,
  ): void {
    const interval = setInterval(() => {
      if (!this.supportIntegrity.isIntact()) {
        this.logger.warn(
          `Skipping worker ${name}: support integrity check failed`,
        );
        return;
      }
      void operation();
    }, intervalMs);
    interval.unref();
    this.registry.addInterval(`overvpn:${name}`, interval);
  }
}
