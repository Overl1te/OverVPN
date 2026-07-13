import { MAX_SIGNED_BIGINT } from '@overvpn/shared/constants';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import type { CoreProvider } from '../core/core-provider';
import type {
  AssertLockOwnership,
  RedisDistributedLock,
} from '../core/distributed-lock';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import {
  computeTrafficDelta,
  parseNonnegativeInt64,
} from './traffic-accounting';
import { TrafficCollectorService } from './traffic-collector.service';
import type {
  WorkerHealthResult,
  WorkerHealthService,
} from './worker-health.service';

const userId = '5a29e0c0-094a-47d3-bef5-d2f3ea187d3f';

describe('traffic delta accounting', () => {
  it('baselines the first observation', () => {
    expect(computeTrafficDelta(userId, 0, 10n, 20n, null)).toMatchObject({
      baseline: true,
      counterReset: false,
      uploadDelta: 0n,
      downloadDelta: 0n,
      generation: 0,
    });
  });

  it('computes a normal absolute-counter delta', () => {
    expect(
      computeTrafficDelta(userId, 0, 15n, 29n, {
        lastUploadBytes: 10n,
        lastDownloadBytes: 20n,
        accountingEpoch: 0,
        generation: 2,
      }),
    ).toMatchObject({
      baseline: false,
      counterReset: false,
      uploadDelta: 5n,
      downloadDelta: 9n,
      generation: 2,
    });
  });

  it('makes a duplicate snapshot a zero delta with the same sample key', () => {
    const cursor = {
      lastUploadBytes: 15n,
      lastDownloadBytes: 29n,
      accountingEpoch: 0,
      generation: 2,
    };
    const first = computeTrafficDelta(userId, 0, 15n, 29n, cursor);
    const duplicate = computeTrafficDelta(userId, 0, 15n, 29n, cursor);
    expect(duplicate.uploadDelta).toBe(0n);
    expect(duplicate.downloadDelta).toBe(0n);
    expect(duplicate.sampleKey).toBe(first.sampleKey);
  });

  it('counts both current counters when the core generation resets', () => {
    expect(
      computeTrafficDelta(userId, 0, 4n, 7n, {
        lastUploadBytes: 100n,
        lastDownloadBytes: 200n,
        accountingEpoch: 0,
        generation: 0,
      }),
    ).toMatchObject({
      baseline: false,
      counterReset: true,
      uploadDelta: 4n,
      downloadDelta: 7n,
      generation: 1,
    });
  });

  it('baselines after an accounting epoch reset', () => {
    expect(
      computeTrafficDelta(userId, 4, 100n, 200n, {
        lastUploadBytes: 90n,
        lastDownloadBytes: 180n,
        accountingEpoch: 3,
        generation: 1,
      }),
    ).toMatchObject({
      baseline: true,
      counterReset: false,
      uploadDelta: 0n,
      downloadDelta: 0n,
      generation: 2,
    });
  });

  it('accepts the signed 64-bit boundary and rejects unsafe values', () => {
    expect(parseNonnegativeInt64(MAX_SIGNED_BIGINT.toString())).toBe(
      MAX_SIGNED_BIGINT,
    );
    expect(
      parseNonnegativeInt64((MAX_SIGNED_BIGINT + 1n).toString()),
    ).toBeNull();
    expect(parseNonnegativeInt64('-1')).toBeNull();
    expect(parseNonnegativeInt64('01')).toBeNull();
  });
});

describe('traffic collector multi-engine counters', () => {
  it('keeps per-engine cursors and sums user deltas across engines', () => {
    const singBox = computeTrafficDelta(`SING_BOX:${userId}`, 0, 15n, 29n, {
      lastUploadBytes: 10n,
      lastDownloadBytes: 20n,
      accountingEpoch: 0,
      generation: 1,
    });
    const xray = computeTrafficDelta(`XRAY:${userId}`, 0, 7n, 3n, {
      lastUploadBytes: 2n,
      lastDownloadBytes: 1n,
      accountingEpoch: 0,
      generation: 0,
    });
    expect(singBox.sampleKey).not.toBe(xray.sampleKey);
    expect(singBox.uploadDelta + xray.uploadDelta).toBe(10n);
    expect(singBox.downloadDelta + xray.downloadDelta).toBe(11n);
  });
});

describe('traffic collector unavailable snapshots', () => {
  it.each(['UNSUPPORTED', 'UNAVAILABLE'] as const)(
    'records %s as degraded without touching PostgreSQL',
    async (code) => {
      const transaction = jest.fn();
      const prisma = {
        $transaction: transaction,
      } as unknown as PrismaService;
      const provider = {
        getTrafficSnapshot: jest.fn().mockResolvedValue({
          supported: false,
          capturedAt: new Date('2026-07-12T00:00:00.000Z'),
          error: { code, message: 'not available' },
        }),
      } as unknown as CoreProvider;
      const guard = Object.assign(jest.fn(), {
        verify: jest.fn().mockResolvedValue(undefined),
      }) as AssertLockOwnership;
      const lock = {
        tryWithLock: jest.fn(
          async (
            _key: string,
            _ttl: number,
            operation: (assertOwned: AssertLockOwnership) => Promise<unknown>,
          ) => ({ acquired: true, value: await operation(guard) }),
        ),
      } as unknown as RedisDistributedLock;
      const markDegraded = jest.fn().mockResolvedValue(undefined);
      const health = {
        getOne: jest.fn().mockResolvedValue(emptyHealth()),
        markRunning: jest.fn().mockResolvedValue(undefined),
        markDegraded,
        markFailure: jest.fn().mockResolvedValue(undefined),
      } as unknown as WorkerHealthService;
      const service = new TrafficCollectorService(
        prisma,
        provider,
        lock,
        health,
        config(),
      );

      await expect(service.runOnce()).resolves.toMatchObject({
        acquired: true,
        status: 'DEGRADED',
        uploadDelta: null,
        downloadDelta: null,
      });
      expect(transaction).not.toHaveBeenCalled();
      expect(markDegraded).toHaveBeenCalled();
    },
  );
});

function config(): ConfigService<AppEnvironment, true> {
  const values = {
    WORKERS_ENABLED: true,
    WORKER_LOCK_TTL_MS: 60_000,
  } satisfies Partial<AppEnvironment>;
  return {
    get: (key: keyof AppEnvironment) => values[key as keyof typeof values],
  } as ConfigService<AppEnvironment, true>;
}

function emptyHealth(): WorkerHealthResult {
  return {
    name: 'traffic-collector',
    state: 'NOT_RUN',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    error: null,
    durationMs: null,
    details: {},
    staleAfterMs: 60_000,
  };
}
