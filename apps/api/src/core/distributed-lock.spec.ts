import {
  RELEASE_LOCK_LUA,
  RENEW_LOCK_LUA,
  type RedisLockClient,
  RedisDistributedLock,
  releaseOwnedLock,
  renewOwnedLock,
} from './distributed-lock';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import type { RedisService } from '../infrastructure/infrastructure.module';

describe('Redis distributed lock ownership', () => {
  it('releases only when the token still owns the key', async () => {
    const redis = new InMemoryRedisLockClient();
    await redis.set('lock', 'owner-token', 'PX', 10_000, 'NX');

    await expect(releaseOwnedLock(redis, 'lock', 'other-token')).resolves.toBe(
      false,
    );
    expect(redis.values.get('lock')).toBe('owner-token');

    await expect(releaseOwnedLock(redis, 'lock', 'owner-token')).resolves.toBe(
      true,
    );
    expect(redis.values.has('lock')).toBe(false);
  });

  it('renews only the current owner', async () => {
    const redis = new InMemoryRedisLockClient();
    await redis.set('lock', 'owner-token', 'PX', 10_000, 'NX');

    await expect(
      renewOwnedLock(redis, 'lock', 'other-token', 20_000),
    ).resolves.toBe(false);
    await expect(
      renewOwnedLock(redis, 'lock', 'owner-token', 20_000),
    ).resolves.toBe(true);
  });

  it('uses distinct keys and skips a key already owned elsewhere', async () => {
    const redis = new InMemoryRedisLockClient();
    const lock = distributedLock(redis);

    const outer = await lock.tryWithLock('worker:a', 10_000, async () => {
      const duplicate = await lock.tryWithLock('worker:a', 10_000, () =>
        Promise.resolve('unexpected'),
      );
      const distinct = await lock.tryWithLock('worker:b', 10_000, () =>
        Promise.resolve('ok'),
      );
      return { duplicate, distinct };
    });

    expect(outer).toEqual({
      acquired: true,
      value: {
        duplicate: { acquired: false },
        distinct: { acquired: true, value: 'ok' },
      },
    });
  });

  it('aborts a locked operation after ownership is lost', async () => {
    const redis = new InMemoryRedisLockClient();
    const lock = distributedLock(redis);

    await expect(
      lock.tryWithLock('worker:a', 10_000, async (assertOwned) => {
        redis.values.delete('worker:a');
        await assertOwned.verify();
      }),
    ).rejects.toThrow('ownership was lost');
  });
});

class InMemoryRedisLockClient implements RedisLockClient {
  readonly values = new Map<string, string>();

  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<'OK' | null> {
    void mode;
    void ttlMs;
    void condition;
    if (this.values.has(key)) {
      return Promise.resolve(null);
    }
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    ...args: string[]
  ): Promise<unknown> {
    void numberOfKeys;
    const token = args[0];
    if (this.values.get(key) !== token) {
      return Promise.resolve(0);
    }
    if (script === RELEASE_LOCK_LUA) {
      this.values.delete(key);
      return Promise.resolve(1);
    }
    if (script === RENEW_LOCK_LUA) {
      return Promise.resolve(1);
    }
    throw new Error('Unexpected Lua script');
  }
}

function distributedLock(
  client: InMemoryRedisLockClient,
): RedisDistributedLock {
  const redis = {
    getClient: () => client,
  } as unknown as RedisService;
  const config = {
    get: () => 60_000,
  } as unknown as ConfigService<AppEnvironment, true>;
  return new RedisDistributedLock(redis, config);
}
