import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AppEnvironment } from '../config/environment';
import { DailyUsageAggregatorService } from './daily-usage-aggregator.service';
import { LimitEnforcerService } from './limit-enforcer.service';
import { OnlineSessionCollectorService } from './online-session-collector.service';
import { OnlineSessionSweeperService } from './online-session-sweeper.service';
import { TrafficCollectorService } from './traffic-collector.service';

@Injectable()
export class WorkerSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerSchedulerService.name);
  private readonly enabled: boolean;
  private readonly intervals: {
    traffic: number;
    aggregate: number;
    online: number;
    sweep: number;
    enforce: number;
  };

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly traffic: TrafficCollectorService,
    private readonly aggregator: DailyUsageAggregatorService,
    private readonly online: OnlineSessionCollectorService,
    private readonly sweeper: OnlineSessionSweeperService,
    private readonly enforcer: LimitEnforcerService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.intervals = {
      traffic: config.get('TRAFFIC_COLLECTION_INTERVAL_MS', { infer: true }),
      aggregate: config.get('TRAFFIC_AGGREGATION_INTERVAL_MS', {
        infer: true,
      }),
      online: config.get('ONLINE_COLLECTION_INTERVAL_MS', { infer: true }),
      sweep: config.get('ONLINE_SWEEP_INTERVAL_MS', { infer: true }),
      enforce: config.get('ENFORCEMENT_INTERVAL_MS', { infer: true }),
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
    this.logger.log('Scheduled workers started');
  }

  private register(
    name: string,
    intervalMs: number,
    operation: () => Promise<unknown>,
  ): void {
    const interval = setInterval(() => {
      void operation();
    }, intervalMs);
    interval.unref();
    this.registry.addInterval(`overvpn:${name}`, interval);
  }
}
