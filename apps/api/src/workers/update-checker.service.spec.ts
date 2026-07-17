import { ConfigService } from '@nestjs/config';
import type { SystemUpdateStatus } from '@overvpn/shared/schemas';
import type { AppEnvironment } from '../config/environment';
import type { RedisDistributedLock } from '../core/distributed-lock';
import type { RedisService } from '../infrastructure/infrastructure.module';
import type { TelegramNotificationService } from '../notifications/telegram-notification.service';
import type { WorkerHealthService } from './worker-health.service';
import { UpdateCheckerService } from './update-checker.service';

describe('UpdateCheckerService', () => {
  const redisStore = new Map<string, string>();
  const redis = {
    getClient: () => ({
      get: (key: string) => Promise.resolve(redisStore.get(key) ?? null),
      set: (key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve('OK' as const);
      },
    }),
  } as unknown as RedisService;

  const lock = {
    tryWithLock: jest.fn(
      async (
        _key: string,
        _ttl: number,
        operation: () => Promise<unknown>,
      ) => ({ acquired: true as const, value: await operation() }),
    ),
  } as unknown as RedisDistributedLock;

  const health = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    markFailure: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkerHealthService;

  const notifyUpdateAvailable = jest.fn().mockResolvedValue(undefined);
  const notifications = {
    notifyUpdateAvailable,
  } as unknown as TelegramNotificationService;

  function config(values: Partial<AppEnvironment>) {
    return {
      get: (key: keyof AppEnvironment) => values[key],
    } as ConfigService<AppEnvironment, true>;
  }

  beforeEach(() => {
    redisStore.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks update available when remote sha differs and notifies once', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            html_url:
              'https://github.com/Overl1te/OverVPN/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const service = new UpdateCheckerService(
      redis,
      lock,
      health,
      notifications,
      config({
        WORKERS_ENABLED: true,
        UPDATE_CHECK_ENABLED: true,
        WORKER_LOCK_TTL_MS: 60_000,
        OVERVPN_GIT_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        UPDATE_CHECK_REPO: 'Overl1te/OverVPN',
        UPDATE_CHECK_REF: 'main',
        UPDATE_CHECK_TIMEOUT_MS: 5_000,
      }),
    );

    const first = await service.runOnce();
    expect(first).toEqual({
      acquired: true,
      status: 'HEALTHY',
      updateAvailable: true,
    });
    expect(notifyUpdateAvailable).toHaveBeenCalledTimes(1);

    const status = await service.getStatus();
    expect(status.updateAvailable).toBe(true);
    expect(status.latestShortSha).toBe('bbbbbbb');

    await service.runOnce();
    expect(notifyUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('reports unknown when OVERVPN_GIT_SHA is missing', async () => {
    const service = new UpdateCheckerService(
      redis,
      lock,
      health,
      notifications,
      config({
        WORKERS_ENABLED: true,
        UPDATE_CHECK_ENABLED: true,
        WORKER_LOCK_TTL_MS: 60_000,
        UPDATE_CHECK_REPO: 'Overl1te/OverVPN',
        UPDATE_CHECK_REF: 'main',
        UPDATE_CHECK_TIMEOUT_MS: 5_000,
      }),
    );

    const result = await service.checkNow();
    expect(result.currentKnown).toBe(false);
    expect(result.updateAvailable).toBe(false);
    expect(result.errorRu).toContain('OVERVPN_GIT_SHA');
  });

  it('returns cached empty status when checks are disabled', async () => {
    const service = new UpdateCheckerService(
      redis,
      lock,
      health,
      notifications,
      config({
        WORKERS_ENABLED: true,
        UPDATE_CHECK_ENABLED: false,
        WORKER_LOCK_TTL_MS: 60_000,
        OVERVPN_GIT_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        UPDATE_CHECK_REPO: 'Overl1te/OverVPN',
        UPDATE_CHECK_REF: 'main',
        UPDATE_CHECK_TIMEOUT_MS: 5_000,
      }),
    );

    const status: SystemUpdateStatus = await service.getStatus();
    expect(status.checkEnabled).toBe(false);
    expect(status.updateAvailable).toBe(false);
  });
});
