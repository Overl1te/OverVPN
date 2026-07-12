import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import type { AppEnvironment } from '../config/environment';
import type { CoreApplyService } from '../core/core-apply.service';
import type {
  AssertLockOwnership,
  RedisDistributedLock,
} from '../core/distributed-lock';
import type { User } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import type { TelegramNotificationService } from '../notifications/telegram-notification.service';
import { LimitEnforcerService } from './limit-enforcer.service';
import {
  evaluateEnforcedStatus,
  type EnforceableUser,
} from './limit-enforcement';
import type { WorkerHealthService } from './worker-health.service';

describe('limit enforcement decisions', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');

  it('expires a user at the exact expiry instant', () => {
    expect(
      evaluateEnforcedStatus(
        state({ expireAt: now }),
        { devices: 0, ips: 0 },
        now,
      ),
    ).toEqual({ status: 'EXPIRED', statusReason: 'expired' });
  });

  it('limits a user at the exact quota', () => {
    expect(
      evaluateEnforcedStatus(
        state({
          dataLimitBytes: 100n,
          usedUploadBytes: 40n,
          usedDownloadBytes: 60n,
        }),
        { devices: 0, ips: 0 },
        now,
      ),
    ).toEqual({ status: 'LIMITED', statusReason: 'quota' });
  });

  it('enforces distinct device and IP limits', () => {
    expect(
      evaluateEnforcedStatus(
        state({ deviceLimit: 1 }),
        { devices: 2, ips: 1 },
        now,
      ),
    ).toEqual({ status: 'LIMITED', statusReason: 'device' });
    expect(
      evaluateEnforcedStatus(
        state({ ipLimit: 1 }),
        { devices: 1, ips: 2 },
        now,
      ),
    ).toEqual({ status: 'LIMITED', statusReason: 'ip' });
  });

  it('preserves a manually disabled user', () => {
    expect(
      evaluateEnforcedStatus(
        state({
          status: 'DISABLED',
          statusReason: 'manual',
          expireAt: now,
          dataLimitBytes: 0n,
        }),
        { devices: 10, ips: 10 },
        now,
      ),
    ).toEqual({ status: 'DISABLED', statusReason: 'manual' });
  });

  it('recovers an automatically limited user when conditions clear', () => {
    expect(
      evaluateEnforcedStatus(
        state({ status: 'LIMITED', statusReason: 'quota' }),
        { devices: 0, ips: 0 },
        now,
      ),
    ).toEqual({ status: 'ACTIVE', statusReason: null });
  });
});

describe('LimitEnforcerService scheduling and apply retries', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');

  it('performs one scheduled reset and is idempotent on the second run', async () => {
    const user = userFixture({
      status: 'LIMITED',
      statusReason: 'quota',
      dataLimitBytes: 100n,
      usedUploadBytes: 60n,
      usedDownloadBytes: 40n,
      resetStrategy: 'DAILY',
      nextResetAt: new Date('2026-07-12T00:00:00.000Z'),
    });
    const fixture = serviceFixture([user], ['SUCCEEDED']);

    await expect(fixture.service.runOnce(now)).resolves.toMatchObject({
      status: 'HEALTHY',
      resets: 1,
      statusChanges: 1,
    });
    expect(user).toMatchObject({
      status: 'ACTIVE',
      statusReason: null,
      usedUploadBytes: 0n,
      usedDownloadBytes: 0n,
      accountingEpoch: 1,
    });
    expect(user.nextResetAt).toEqual(new Date('2026-07-13T00:00:00.000Z'));

    await expect(fixture.service.runOnce(now)).resolves.toMatchObject({
      status: 'HEALTHY',
      resets: 0,
      statusChanges: 0,
      applyStatus: null,
    });
    expect(user.accountingEpoch).toBe(1);
    expect(fixture.applySystem).toHaveBeenCalledTimes(1);
  });

  it('retries a failed core apply without requiring another transition', async () => {
    const user = userFixture({
      expireAt: new Date('2026-07-12T11:00:00.000Z'),
    });
    const fixture = serviceFixture([user], ['FAILED', 'SUCCEEDED']);

    await expect(fixture.service.runOnce(now)).resolves.toMatchObject({
      status: 'DEGRADED',
      statusChanges: 1,
      applyStatus: 'FAILED',
    });
    expect(user.status).toBe('EXPIRED');
    expect(user.needsApply).toBe(true);

    await expect(fixture.service.runOnce(now)).resolves.toMatchObject({
      status: 'HEALTHY',
      statusChanges: 0,
      applyStatus: 'SUCCEEDED',
    });
    expect(fixture.applySystem).toHaveBeenCalledTimes(2);
    expect(user.needsApply).toBe(false);
  });
});

function state(overrides: Partial<EnforceableUser> = {}): EnforceableUser {
  return {
    status: 'ACTIVE' as const,
    statusReason: null,
    expireAt: null,
    dataLimitBytes: null,
    usedUploadBytes: 0n,
    usedDownloadBytes: 0n,
    deviceLimit: null,
    ipLimit: null,
    ...overrides,
  };
}

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: '5a29e0c0-094a-47d3-bef5-d2f3ea187d3f',
    identity: 'alice',
    username: 'alice',
    status: 'ACTIVE',
    statusReason: null,
    note: null,
    tags: [],
    expireAt: null,
    dataLimitBytes: null,
    usedUploadBytes: 0n,
    usedDownloadBytes: 0n,
    accountingEpoch: 0,
    trafficResetAt: null,
    resetStrategy: 'NO_RESET',
    nextResetAt: null,
    deviceLimit: null,
    ipLimit: null,
    speedLimitBps: null,
    subToken: 'token',
    planId: null,
    needsApply: false,
    revision: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    disabledAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function serviceFixture(users: User[], applyStatuses: string[]) {
  const userDelegate = {
    findMany: jest.fn().mockResolvedValue(users),
    count: jest.fn(() =>
      Promise.resolve(users.filter((user) => user.needsApply).length),
    ),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const user = users.find((candidate) => candidate.id === where.id);
        if (!user) {
          throw new Error('missing test user');
        }
        applyData(user, data);
        return Promise.resolve({ ...user });
      },
    ),
  };
  const tx = {
    user: userDelegate,
    onlineSession: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(
      async (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
    ),
  } as unknown as PrismaService;
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
  const health = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    markDegraded: jest.fn().mockResolvedValue(undefined),
    markFailure: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkerHealthService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const applySystem = jest.fn(() => {
    const status = applyStatuses.shift() ?? 'SUCCEEDED';
    if (status === 'SUCCEEDED') {
      for (const user of users) {
        user.needsApply = false;
      }
    }
    return Promise.resolve({
      id: 'e8f91dfa-b7df-4b80-856d-22f9f73131d8',
      status,
      desiredHash: null,
      previousHash: null,
      error: status === 'SUCCEEDED' ? null : 'apply failed',
      rollbackOutcome: null,
      startedAt: '2026-07-12T12:00:00.000Z',
      completedAt: '2026-07-12T12:00:00.000Z',
    });
  });
  const coreApply = { applySystem } as unknown as CoreApplyService;
  const notifications = {
    notifyUserTransition: jest.fn().mockResolvedValue(undefined),
  } as unknown as TelegramNotificationService;
  const configValues = {
    WORKERS_ENABLED: true,
    WORKER_LOCK_TTL_MS: 60_000,
    ONLINE_SESSION_TIMEOUT_MS: 90_000,
  } satisfies Partial<AppEnvironment>;
  const config = {
    get: (key: keyof AppEnvironment) =>
      configValues[key as keyof typeof configValues],
  } as ConfigService<AppEnvironment, true>;
  return {
    service: new LimitEnforcerService(
      prisma,
      lock,
      health,
      audit,
      coreApply,
      notifications,
      config,
    ),
    applySystem,
  };
}

function applyData(user: User, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      const increment = (value as { increment: number }).increment;
      const current = user[key as keyof User];
      if (typeof current === 'number') {
        (user as unknown as Record<string, unknown>)[key] = current + increment;
      }
      continue;
    }
    (user as unknown as Record<string, unknown>)[key] = value;
  }
}
