import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { RedisDistributedLock } from '../core/distributed-lock';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { WorkerHealthService } from './worker-health.service';

const LOCK_KEY = 'overvpn:workers:online-sweeper:lock';
const WORKER_NAME = 'online-sweeper' as const;

export type OnlineSweepResult =
  | { acquired: false }
  | {
      acquired: true;
      status: 'HEALTHY' | 'FAILED';
      disconnected: number;
      pruned: number;
    };

@Injectable()
export class OnlineSessionSweeperService {
  private readonly logger = new Logger(OnlineSessionSweeperService.name);
  private readonly enabled: boolean;
  private readonly lockTtlMs: number;
  private readonly timeoutMs: number;
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: RedisDistributedLock,
    private readonly health: WorkerHealthService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.lockTtlMs = config.get('WORKER_LOCK_TTL_MS', { infer: true });
    this.timeoutMs = config.get('ONLINE_SESSION_TIMEOUT_MS', { infer: true });
    this.retentionDays = config.get('ONLINE_SESSION_RETENTION_DAYS', {
      infer: true,
    });
  }

  async runOnce(now = new Date()): Promise<OnlineSweepResult> {
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
          const staleCutoff = new Date(now.getTime() - this.timeoutMs);
          const retentionCutoff = new Date(
            now.getTime() - this.retentionDays * 24 * 60 * 60 * 1_000,
          );
          const result = await this.prisma.$transaction(
            async (tx) => {
              const disconnected = await tx.onlineSession.updateMany({
                where: {
                  disconnectedAt: null,
                  lastSeenAt: { lt: staleCutoff },
                },
                data: { disconnectedAt: now },
              });
              const pruned = await tx.onlineSession.deleteMany({
                where: {
                  disconnectedAt: { lt: retentionCutoff },
                },
              });
              await assertOwned.verify();
              return {
                disconnected: disconnected.count,
                pruned: pruned.count,
              };
            },
            { isolationLevel: 'Serializable' },
          );
          await this.health.markSuccess(WORKER_NAME, startedAt, {
            staleAfterMs: this.timeoutMs,
            disconnectedSessions: result.disconnected,
            prunedSessions: result.pruned,
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
      this.logger.error(`Online session sweep failed: ${errorMessage(error)}`);
      return {
        acquired: true,
        status: 'FAILED',
        disconnected: 0,
        pruned: 0,
      };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
