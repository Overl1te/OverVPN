import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { RedisDistributedLock } from '../core/distributed-lock';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { checkedByteSum } from './traffic-accounting';
import { WorkerHealthService } from './worker-health.service';

const LOCK_KEY = 'overvpn:workers:daily-aggregator:lock';
const WORKER_NAME = 'daily-aggregator' as const;
const USER_SCOPE = 'user';

export type DailyAggregationResult =
  | { acquired: false }
  | {
      acquired: true;
      status: 'HEALTHY' | 'FAILED';
      consumed: number;
      groups: number;
      pruned: number;
    };

@Injectable()
export class DailyUsageAggregatorService {
  private readonly logger = new Logger(DailyUsageAggregatorService.name);
  private readonly enabled: boolean;
  private readonly lockTtlMs: number;
  private readonly batchSize: number;
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: RedisDistributedLock,
    private readonly health: WorkerHealthService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.lockTtlMs = config.get('WORKER_LOCK_TTL_MS', { infer: true });
    this.batchSize = config.get('TRAFFIC_AGGREGATION_BATCH_SIZE', {
      infer: true,
    });
    this.retentionDays = config.get('TRAFFIC_LEDGER_RETENTION_DAYS', {
      infer: true,
    });
  }

  async runOnce(): Promise<DailyAggregationResult> {
    if (!this.enabled) {
      return { acquired: false };
    }
    const startedAt = new Date();
    try {
      const attempted = await this.lock.tryWithLock(
        LOCK_KEY,
        this.lockTtlMs,
        async (assertOwned) => {
          await this.health.markRunning(WORKER_NAME, startedAt);
          const result = await this.prisma.$transaction(
            async (tx) => {
              const deltas = await tx.trafficDelta.findMany({
                where: { aggregatedAt: null },
                orderBy: { id: 'asc' },
                take: this.batchSize,
              });
              const grouped = new Map<
                string,
                {
                  userId: string;
                  day: Date;
                  uploadBytes: bigint;
                  downloadBytes: bigint;
                }
              >();
              for (const delta of deltas) {
                const day = utcDay(delta.observedAt);
                const key = `${delta.userId}\0${day.toISOString()}`;
                const group = grouped.get(key) ?? {
                  userId: delta.userId,
                  day,
                  uploadBytes: 0n,
                  downloadBytes: 0n,
                };
                group.uploadBytes = checkedByteSum(
                  group.uploadBytes,
                  delta.uploadBytes,
                );
                group.downloadBytes = checkedByteSum(
                  group.downloadBytes,
                  delta.downloadBytes,
                );
                grouped.set(key, group);
              }
              for (const group of grouped.values()) {
                await tx.usageDaily.upsert({
                  where: {
                    userId_day_scopeKey: {
                      userId: group.userId,
                      day: group.day,
                      scopeKey: USER_SCOPE,
                    },
                  },
                  create: {
                    userId: group.userId,
                    inboundId: null,
                    scopeKey: USER_SCOPE,
                    day: group.day,
                    uploadBytes: group.uploadBytes,
                    downloadBytes: group.downloadBytes,
                  },
                  update: {
                    uploadBytes: { increment: group.uploadBytes },
                    downloadBytes: { increment: group.downloadBytes },
                  },
                });
              }
              if (deltas.length > 0) {
                await tx.trafficDelta.updateMany({
                  where: {
                    id: { in: deltas.map((delta) => delta.id) },
                    aggregatedAt: null,
                  },
                  data: { aggregatedAt: startedAt },
                });
              }
              const retentionCutoff = new Date(
                startedAt.getTime() - this.retentionDays * 24 * 60 * 60 * 1_000,
              );
              const pruned = await tx.trafficDelta.deleteMany({
                where: {
                  aggregatedAt: { not: null },
                  observedAt: { lt: retentionCutoff },
                },
              });
              await assertOwned.verify();
              return {
                consumed: deltas.length,
                groups: grouped.size,
                pruned: pruned.count,
              };
            },
            { isolationLevel: 'Serializable' },
          );
          await this.health.markSuccess(WORKER_NAME, startedAt, {
            consumedDeltas: result.consumed,
            aggregatedGroups: result.groups,
            prunedDeltas: result.pruned,
            batchSize: this.batchSize,
          });
          return {
            acquired: true,
            status: 'HEALTHY' as const,
            ...result,
          };
        },
      );
      return attempted.acquired ? attempted.value : { acquired: false };
    } catch (error: unknown) {
      await this.health.markFailure(WORKER_NAME, startedAt, error);
      this.logger.error(
        `Daily usage aggregation failed: ${errorMessage(error)}`,
      );
      return {
        acquired: true,
        status: 'FAILED',
        consumed: 0,
        groups: 0,
        pruned: 0,
      };
    }
  }
}

function utcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
