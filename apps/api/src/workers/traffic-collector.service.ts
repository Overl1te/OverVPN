import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { localizeWorkerError } from '../core/core-user-messages';
import { CoreProvider, type TrafficCounter } from '../core/core-provider';
import {
  RedisDistributedLock,
  type AssertLockOwnership,
} from '../core/distributed-lock';
import { PrismaService } from '../infrastructure/infrastructure.module';
import {
  checkedByteSum,
  computeTrafficDelta,
  parseNonnegativeInt64,
} from './traffic-accounting';
import {
  WorkerHealthService,
  type WorkerDetails,
} from './worker-health.service';

const LOCK_KEY = 'overvpn:workers:traffic-collector:lock';
const WORKER_NAME = 'traffic-collector' as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ParsedCounter {
  statsKey: string;
  uploadBytes: bigint;
  downloadBytes: bigint;
}

export type TrafficCollectionResult =
  | { acquired: false }
  | {
      acquired: true;
      status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
      collectedUsers: number;
      uploadDelta: string | null;
      downloadDelta: string | null;
    };

@Injectable()
export class TrafficCollectorService {
  private readonly logger = new Logger(TrafficCollectorService.name);
  private readonly enabled: boolean;
  private readonly lockTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: CoreProvider,
    private readonly lock: RedisDistributedLock,
    private readonly health: WorkerHealthService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.lockTtlMs = config.get('WORKER_LOCK_TTL_MS', { infer: true });
  }

  async runOnce(): Promise<TrafficCollectionResult> {
    if (!this.enabled) {
      return { acquired: false };
    }
    const startedAt = new Date();
    try {
      const previous = await this.health.getOne(WORKER_NAME);
      const attempted = await this.lock.tryWithLock(
        LOCK_KEY,
        this.lockTtlMs,
        async (assertOwned) => {
          await this.health.markRunning(WORKER_NAME, startedAt);
          const snapshot = await this.provider.getTrafficSnapshot();
          await assertOwned.verify();
          if (!snapshot.supported) {
            const localized = localizeWorkerError(
              `${snapshot.error.code}: ${snapshot.error.message}`,
            );
            const workerError =
              localized?.en ??
              `${snapshot.error.code}: ${snapshot.error.message}`;
            await this.health.markDegraded(
              WORKER_NAME,
              startedAt,
              workerError,
              {
                trafficAvailable: false,
                capturedAt: snapshot.capturedAt.toISOString(),
                errorCode: snapshot.error.code,
              },
            );
            return {
              acquired: true,
              status: 'DEGRADED',
              collectedUsers: 0,
              uploadDelta: null,
              downloadDelta: null,
            } as const;
          }

          const parsed = this.parseCounters(snapshot.counters);
          const accounting = await this.persistSnapshot(
            parsed.counters,
            snapshot.capturedAt,
            assertOwned,
          );
          const throughput = calculateThroughput(
            previous.details,
            snapshot.capturedAt,
            accounting.uploadDelta,
            accounting.downloadDelta,
          );
          const details: WorkerDetails = {
            trafficAvailable: true,
            capturedAt: snapshot.capturedAt.toISOString(),
            collectedUsers: accounting.collectedUsers,
            baselineUsers: accounting.baselineUsers,
            resetCounters: accounting.resetCounters,
            staleSamples: accounting.staleSamples,
            unknownUsers: accounting.unknownUserIds.length,
            unknownUserIds: accounting.unknownUserIds.slice(0, 20),
            invalidCounters: parsed.invalidCounters,
            uploadDeltaBytes: accounting.uploadDelta.toString(),
            downloadDeltaBytes: accounting.downloadDelta.toString(),
            absoluteUploadBytes: parsed.absoluteUpload.toString(),
            absoluteDownloadBytes: parsed.absoluteDownload.toString(),
            throughputAvailable: throughput !== null,
            uploadBytesPerSecond: throughput?.upload.toString() ?? null,
            downloadBytesPerSecond: throughput?.download.toString() ?? null,
          };
          const degraded =
            parsed.invalidCounters > 0 || accounting.unknownUserIds.length > 0;
          if (degraded) {
            await this.health.markDegraded(
              WORKER_NAME,
              startedAt,
              'Some traffic counters were invalid or did not resolve to users',
              details,
            );
          } else {
            await this.health.markSuccess(WORKER_NAME, startedAt, details);
          }
          return {
            acquired: true,
            status: degraded ? ('DEGRADED' as const) : ('HEALTHY' as const),
            collectedUsers: accounting.collectedUsers,
            uploadDelta: accounting.uploadDelta.toString(),
            downloadDelta: accounting.downloadDelta.toString(),
          };
        },
      );
      if (!attempted.acquired) {
        return { acquired: false };
      }
      return attempted.value;
    } catch (error: unknown) {
      await this.health.markFailure(WORKER_NAME, startedAt, error, {
        trafficAvailable: false,
      });
      this.logger.error(`Traffic collection failed: ${errorMessage(error)}`);
      return {
        acquired: true,
        status: 'FAILED',
        collectedUsers: 0,
        uploadDelta: null,
        downloadDelta: null,
      };
    }
  }

  private parseCounters(counters: TrafficCounter[]): {
    counters: ParsedCounter[];
    invalidCounters: number;
    absoluteUpload: bigint;
    absoluteDownload: bigint;
  } {
    const parsed = new Map<string, ParsedCounter>();
    let invalidCounters = 0;
    for (const counter of counters) {
      if (counter.scope !== 'user') {
        continue;
      }
      const statsKey = counter.key.toLowerCase();
      const uploadBytes = parseNonnegativeInt64(counter.uplinkBytes);
      const downloadBytes = parseNonnegativeInt64(counter.downlinkBytes);
      if (
        !uuidPattern.test(statsKey) ||
        uploadBytes === null ||
        downloadBytes === null
      ) {
        invalidCounters += 1;
        continue;
      }
      parsed.set(statsKey, { statsKey, uploadBytes, downloadBytes });
    }
    let absoluteUpload = 0n;
    let absoluteDownload = 0n;
    for (const counter of parsed.values()) {
      absoluteUpload += counter.uploadBytes;
      absoluteDownload += counter.downloadBytes;
    }
    return {
      counters: [...parsed.values()].sort((left, right) =>
        left.statsKey.localeCompare(right.statsKey),
      ),
      invalidCounters,
      absoluteUpload,
      absoluteDownload,
    };
  }

  private async persistSnapshot(
    counters: ParsedCounter[],
    capturedAt: Date,
    assertOwned: AssertLockOwnership,
  ): Promise<{
    collectedUsers: number;
    baselineUsers: number;
    resetCounters: number;
    staleSamples: number;
    unknownUserIds: string[];
    uploadDelta: bigint;
    downloadDelta: bigint;
  }> {
    if (counters.length === 0) {
      await assertOwned.verify();
      return {
        collectedUsers: 0,
        baselineUsers: 0,
        resetCounters: 0,
        staleSamples: 0,
        unknownUserIds: [],
        uploadDelta: 0n,
        downloadDelta: 0n,
      };
    }
    return this.prisma.$transaction(
      async (tx) => {
        const users = await tx.user.findMany({
          where: {
            id: { in: counters.map((counter) => counter.statsKey) },
            deletedAt: null,
          },
          orderBy: { id: 'asc' },
        });
        const counterById = new Map(
          counters.map((counter) => [counter.statsKey, counter]),
        );
        const knownIds = new Set(users.map((user) => user.id));
        const unknownUserIds = counters
          .map((counter) => counter.statsKey)
          .filter((id) => !knownIds.has(id));
        const cursors = await tx.trafficCursor.findMany({
          where: { statsKey: { in: users.map((user) => user.id) } },
        });
        const cursorByKey = new Map(
          cursors.map((cursor) => [cursor.statsKey, cursor]),
        );
        let uploadDelta = 0n;
        let downloadDelta = 0n;
        let baselineUsers = 0;
        let resetCounters = 0;
        let staleSamples = 0;

        for (const user of users) {
          const counter = counterById.get(user.id);
          if (!counter) {
            continue;
          }
          const cursor = cursorByKey.get(counter.statsKey) ?? null;
          if (cursor && capturedAt <= cursor.observedAt) {
            staleSamples += 1;
            continue;
          }
          const computed = computeTrafficDelta(
            counter.statsKey,
            user.accountingEpoch,
            counter.uploadBytes,
            counter.downloadBytes,
            cursor,
          );
          if (computed.baseline) {
            baselineUsers += 1;
          }
          if (computed.counterReset) {
            resetCounters += 1;
          }
          if (computed.uploadDelta > 0n || computed.downloadDelta > 0n) {
            checkedByteSum(user.usedUploadBytes, computed.uploadDelta);
            checkedByteSum(user.usedDownloadBytes, computed.downloadDelta);
            await tx.trafficDelta.create({
              data: {
                userId: user.id,
                uploadBytes: computed.uploadDelta,
                downloadBytes: computed.downloadDelta,
                observedAt: capturedAt,
                source: 'CORE_POLL',
                generation: computed.generation,
                sampleKey: computed.sampleKey,
              },
            });
            await tx.user.update({
              where: { id: user.id },
              data: {
                usedUploadBytes: { increment: computed.uploadDelta },
                usedDownloadBytes: { increment: computed.downloadDelta },
              },
            });
            uploadDelta += computed.uploadDelta;
            downloadDelta += computed.downloadDelta;
          }
          await tx.trafficCursor.upsert({
            where: { statsKey: counter.statsKey },
            create: {
              statsKey: counter.statsKey,
              userId: user.id,
              lastUploadBytes: counter.uploadBytes,
              lastDownloadBytes: counter.downloadBytes,
              accountingEpoch: user.accountingEpoch,
              generation: computed.generation,
              lastSampleHash: computed.sampleKey,
              observedAt: capturedAt,
            },
            update: {
              userId: user.id,
              lastUploadBytes: counter.uploadBytes,
              lastDownloadBytes: counter.downloadBytes,
              accountingEpoch: user.accountingEpoch,
              generation: computed.generation,
              lastSampleHash: computed.sampleKey,
              observedAt: capturedAt,
            },
          });
        }
        await assertOwned.verify();
        return {
          collectedUsers: users.length,
          baselineUsers,
          resetCounters,
          staleSamples,
          unknownUserIds,
          uploadDelta,
          downloadDelta,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }
}

function calculateThroughput(
  previous: WorkerDetails,
  capturedAt: Date,
  uploadDelta: bigint,
  downloadDelta: bigint,
): { upload: bigint; download: bigint } | null {
  const previousCapturedAt = previous.capturedAt;
  if (typeof previousCapturedAt !== 'string') {
    return null;
  }
  const elapsedMs =
    capturedAt.getTime() - new Date(previousCapturedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return null;
  }
  const elapsed = BigInt(Math.trunc(elapsedMs));
  return {
    upload: (uploadDelta * 1_000n) / elapsed,
    download: (downloadDelta * 1_000n) / elapsed,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
