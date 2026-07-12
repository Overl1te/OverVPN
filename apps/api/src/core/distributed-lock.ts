import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { RedisService } from '../infrastructure/infrastructure.module';

export const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`.trim();

export const RENEW_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`.trim();

export interface RedisLockClient {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    ...args: string[]
  ): Promise<unknown>;
}

export async function releaseOwnedLock(
  client: RedisLockClient,
  key: string,
  token: string,
): Promise<boolean> {
  return Number(await client.eval(RELEASE_LOCK_LUA, 1, key, token)) === 1;
}

export async function renewOwnedLock(
  client: RedisLockClient,
  key: string,
  token: string,
  ttlMs: number,
): Promise<boolean> {
  return (
    Number(await client.eval(RENEW_LOCK_LUA, 1, key, token, String(ttlMs))) ===
    1
  );
}

export type AssertLockOwnership = (() => void) & {
  verify: () => Promise<void>;
};

export type LockAttempt<T> = { acquired: false } | { acquired: true; value: T };

export class LockNotAcquiredError extends Error {
  constructor(key: string) {
    super(`Distributed lock is already held: ${key}`);
    this.name = 'LockNotAcquiredError';
  }
}

@Injectable()
export class RedisDistributedLock {
  private readonly logger = new Logger(RedisDistributedLock.name);
  private readonly coreApplyKey = 'overvpn:core:apply:lock';
  private readonly coreApplyTtlMs: number;
  private readonly client: RedisLockClient;

  constructor(
    redis: RedisService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.client = redis.getClient();
    this.coreApplyTtlMs = config.get('CORE_APPLY_LOCK_TTL_MS', { infer: true });
  }

  async withLock<T>(
    operation: (assertOwned: AssertLockOwnership) => Promise<T>,
  ): Promise<T> {
    const attempted = await this.tryWithLock(
      this.coreApplyKey,
      this.coreApplyTtlMs,
      operation,
    );
    if (!attempted.acquired) {
      throw new Error('Another core apply operation currently holds the lock');
    }
    return attempted.value;
  }

  async withNamedLock<T>(
    key: string,
    ttlMs: number,
    operation: (assertOwned: AssertLockOwnership) => Promise<T>,
  ): Promise<T> {
    const attempted = await this.tryWithLock(key, ttlMs, operation);
    if (!attempted.acquired) {
      throw new LockNotAcquiredError(key);
    }
    return attempted.value;
  }

  async tryWithLock<T>(
    key: string,
    ttlMs: number,
    operation: (assertOwned: AssertLockOwnership) => Promise<T>,
  ): Promise<LockAttempt<T>> {
    if (!key || ttlMs < 1_000 || !Number.isSafeInteger(ttlMs)) {
      throw new Error(
        'Distributed lock requires a key and a safe TTL >= 1000ms',
      );
    }
    const token = randomUUID();
    const acquired = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') {
      return { acquired: false };
    }

    let ownershipError: Error | null = null;
    let renewalPromise: Promise<void> | null = null;
    const renew = async (): Promise<void> => {
      if (ownershipError) {
        return;
      }
      if (renewalPromise) {
        await renewalPromise;
        return;
      }
      renewalPromise = (async () => {
        try {
          const renewed = await renewOwnedLock(this.client, key, token, ttlMs);
          if (!renewed) {
            ownershipError = new Error(
              `Distributed lock ownership was lost during the operation: ${key}`,
            );
          }
        } catch (error: unknown) {
          ownershipError = new Error(
            `Distributed lock renewal failed for ${key}: ${errorMessage(error)}`,
          );
        } finally {
          renewalPromise = null;
        }
      })();
      await renewalPromise;
    };
    const timer = setInterval(
      () => {
        void renew();
      },
      Math.max(1_000, Math.floor(ttlMs / 3)),
    );
    timer.unref();
    const assertOwned = (() => {
      if (ownershipError) {
        throw ownershipError;
      }
    }) as AssertLockOwnership;
    assertOwned.verify = async (): Promise<void> => {
      await renew();
      assertOwned();
    };

    let outcome:
      { succeeded: true; value: T } | { succeeded: false; error: unknown };
    try {
      const result = await operation(assertOwned);
      assertOwned();
      outcome = { succeeded: true, value: result };
    } catch (error: unknown) {
      outcome = { succeeded: false, error };
    }

    clearInterval(timer);
    let releaseError: unknown;
    try {
      const released = await releaseOwnedLock(this.client, key, token);
      if (!released) {
        releaseError = new Error(
          `Distributed lock was no longer owned during release: ${key}`,
        );
      }
    } catch (error: unknown) {
      releaseError = error;
    }
    if (!outcome.succeeded) {
      throw outcome.error;
    }
    if (releaseError !== undefined) {
      this.logger.error(
        `Locked operation completed but release failed: ${errorMessage(
          releaseError,
        )}`,
      );
    }
    return { acquired: true, value: outcome.value };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
