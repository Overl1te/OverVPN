import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { RedisService } from '../infrastructure/infrastructure.module';

export const WORKER_NAMES = [
  'traffic-collector',
  'daily-aggregator',
  'online-collector',
  'online-sweeper',
  'limit-enforcer',
] as const;

export type WorkerName = (typeof WORKER_NAMES)[number];
export type WorkerState =
  | 'NOT_RUN'
  | 'RUNNING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'FAILED'
  | 'DISABLED'
  | 'STALE'
  | 'UNAVAILABLE';

export type WorkerDetails = Record<
  string,
  string | number | boolean | null | string[]
>;

interface StoredWorkerHealth {
  name: WorkerName;
  state: Exclude<WorkerState, 'NOT_RUN' | 'DISABLED' | 'STALE' | 'UNAVAILABLE'>;
  lastStartedAt: string;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  error: string | null;
  durationMs: number | null;
  details: WorkerDetails;
}

export interface WorkerHealthResult {
  name: WorkerName;
  state: WorkerState;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  error: string | null;
  durationMs: number | null;
  details: WorkerDetails;
  staleAfterMs: number;
}

@Injectable()
export class WorkerHealthService {
  private readonly logger = new Logger(WorkerHealthService.name);
  private readonly enabled: boolean;
  private readonly intervals: Record<WorkerName, number>;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.intervals = {
      'traffic-collector': config.get('TRAFFIC_COLLECTION_INTERVAL_MS', {
        infer: true,
      }),
      'daily-aggregator': config.get('TRAFFIC_AGGREGATION_INTERVAL_MS', {
        infer: true,
      }),
      'online-collector': config.get('ONLINE_COLLECTION_INTERVAL_MS', {
        infer: true,
      }),
      'online-sweeper': config.get('ONLINE_SWEEP_INTERVAL_MS', {
        infer: true,
      }),
      'limit-enforcer': config.get('ENFORCEMENT_INTERVAL_MS', { infer: true }),
    };
  }

  async markRunning(name: WorkerName, now = new Date()): Promise<void> {
    const previous = await this.read(name);
    await this.write({
      name,
      state: 'RUNNING',
      lastStartedAt: now.toISOString(),
      lastFinishedAt: previous?.lastFinishedAt ?? null,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastFailureAt: previous?.lastFailureAt ?? null,
      error: previous?.error ?? null,
      durationMs: null,
      details: previous?.details ?? {},
    });
  }

  async markSuccess(
    name: WorkerName,
    startedAt: Date,
    details: WorkerDetails = {},
    now = new Date(),
  ): Promise<void> {
    const previous = await this.read(name);
    await this.write({
      name,
      state: 'HEALTHY',
      lastStartedAt: startedAt.toISOString(),
      lastFinishedAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      lastFailureAt: previous?.lastFailureAt ?? null,
      error: null,
      durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
      details,
    });
  }

  async markDegraded(
    name: WorkerName,
    startedAt: Date,
    error: string,
    details: WorkerDetails = {},
    now = new Date(),
  ): Promise<void> {
    const previous = await this.read(name);
    await this.write({
      name,
      state: 'DEGRADED',
      lastStartedAt: startedAt.toISOString(),
      lastFinishedAt: now.toISOString(),
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastFailureAt: now.toISOString(),
      error: sanitizeError(error),
      durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
      details,
    });
  }

  async markFailure(
    name: WorkerName,
    startedAt: Date,
    error: unknown,
    details: WorkerDetails = {},
    now = new Date(),
  ): Promise<void> {
    const previous = await this.read(name);
    await this.write({
      name,
      state: 'FAILED',
      lastStartedAt: startedAt.toISOString(),
      lastFinishedAt: now.toISOString(),
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastFailureAt: now.toISOString(),
      error: sanitizeError(errorMessage(error)),
      durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
      details,
    });
  }

  async getOne(name: WorkerName): Promise<WorkerHealthResult> {
    if (!this.enabled) {
      return this.empty(name, 'DISABLED');
    }
    try {
      const raw = await this.redis.getClient().get(this.key(name));
      const stored = raw ? (JSON.parse(raw) as StoredWorkerHealth) : null;
      if (!stored) {
        return this.empty(name, 'NOT_RUN');
      }
      if (stored.name !== name) {
        throw new Error('Worker health payload has a mismatched name');
      }
      const staleAfterMs = this.staleAfter(name);
      const freshnessReference =
        stored.lastFinishedAt ?? stored.lastStartedAt ?? null;
      const stale =
        freshnessReference !== null &&
        Date.now() - new Date(freshnessReference).getTime() > staleAfterMs;
      return {
        ...stored,
        state: stale ? 'STALE' : stored.state,
        staleAfterMs,
      };
    } catch (error: unknown) {
      this.logger.warn(`Could not read ${name} health: ${errorMessage(error)}`);
      return this.empty(name, 'UNAVAILABLE');
    }
  }

  async getAll(): Promise<WorkerHealthResult[]> {
    return Promise.all(WORKER_NAMES.map((name) => this.getOne(name)));
  }

  private async read(name: WorkerName): Promise<StoredWorkerHealth | null> {
    try {
      const raw = await this.redis.getClient().get(this.key(name));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as StoredWorkerHealth;
      return parsed.name === name ? parsed : null;
    } catch (error: unknown) {
      this.logger.warn(`Could not read ${name} health: ${errorMessage(error)}`);
      return null;
    }
  }

  private async write(value: StoredWorkerHealth): Promise<void> {
    try {
      await this.redis
        .getClient()
        .set(this.key(value.name), JSON.stringify(value));
    } catch (error: unknown) {
      this.logger.warn(
        `Could not persist ${value.name} health: ${errorMessage(error)}`,
      );
    }
  }

  private empty(name: WorkerName, state: WorkerState): WorkerHealthResult {
    return {
      name,
      state,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      error: null,
      durationMs: null,
      details: {},
      staleAfterMs: this.staleAfter(name),
    };
  }

  private staleAfter(name: WorkerName): number {
    return Math.max(this.intervals[name] * 3, 15_000);
  }

  private key(name: WorkerName): string {
    return `overvpn:workers:health:${name}`;
  }
}

function sanitizeError(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 1_000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
