import type { ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiException } from '../common/api-error';
import type { RedisService } from '../infrastructure/infrastructure.module';
import {
  SUBSCRIPTION_RATE_LIMIT_SCRIPT,
  SubscriptionRateLimitGuard,
  type SubscriptionRateLimiter,
  SubscriptionRateLimitStore,
  subscriptionTokenFingerprint,
} from './subscription-rate-limit';

describe('SubscriptionRateLimitStore', () => {
  it('atomically applies IP and fingerprint windows without exposing the token', async () => {
    const token = Buffer.alloc(32, 7).toString('base64url');
    const evalMock = jest.fn().mockResolvedValue([1, 8, 59_500, 2, 3]);
    const redis = {
      getClient: () => ({ eval: evalMock }),
    };
    const store = new SubscriptionRateLimitStore(
      redis as unknown as RedisService,
    );

    const result = await store.consume({
      ipAddress: '203.0.113.42',
      token,
      ipLimit: 10,
      tokenLimit: 20,
      windowMs: 60_000,
    });

    expect(evalMock).toHaveBeenCalledTimes(1);
    const [script, keyCount, ipKey, tokenKey, ipLimit, tokenLimit, windowMs] =
      evalMock.mock.calls[0] as [
        string,
        number,
        string,
        string,
        number,
        number,
        number,
      ];
    expect(script).toBe(SUBSCRIPTION_RATE_LIMIT_SCRIPT);
    expect(script.match(/redis\.call\('INCR'/g)).toHaveLength(2);
    expect(script.match(/redis\.call\('PEXPIRE'/g)).toHaveLength(2);
    expect(keyCount).toBe(2);
    expect(ipKey).toMatch(/^sub-rate:v1:ip:[a-f0-9]{64}$/);
    expect(tokenKey).toBe(
      `sub-rate:v1:token:${subscriptionTokenFingerprint(token)}`,
    );
    expect(ipKey).not.toContain('203.0.113.42');
    expect(tokenKey).not.toContain(token);
    expect(JSON.stringify(evalMock.mock.calls)).not.toContain(token);
    expect([ipLimit, tokenLimit, windowMs]).toEqual([10, 20, 60_000]);
    expect(result).toEqual({
      allowed: true,
      limit: 10,
      remaining: 8,
      resetSeconds: 60,
    });
  });

  it('returns a blocked atomic decision from either exhausted dimension', async () => {
    const evalMock = jest.fn().mockResolvedValue([0, 0, 1_001, 11, 4]);
    const store = new SubscriptionRateLimitStore({
      getClient: () => ({ eval: evalMock }),
    } as unknown as RedisService);

    await expect(
      store.consume({
        ipAddress: '198.51.100.10',
        token: Buffer.alloc(32, 8).toString('base64url'),
        ipLimit: 10,
        tokenLimit: 20,
        windowMs: 60_000,
      }),
    ).resolves.toEqual({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetSeconds: 2,
    });
    expect(evalMock).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionRateLimitGuard', () => {
  it('fails closed with Retry-After when Redis is unavailable', async () => {
    const limiter = {
      consume: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      policy: () => '10;w=60',
    };
    const { context, headers } = guardContext();
    const guard = new SubscriptionRateLimitGuard(
      limiter as unknown as SubscriptionRateLimiter,
    );

    const error = await guardRejection(guard.canActivate(context));

    expect(error).toMatchObject({ code: 'SUBSCRIPTION_UNAVAILABLE' });
    expect(error.getStatus()).toBe(503);
    expect(headers['Retry-After']).toBe('5');
  });

  it('emits standard headers and Retry-After for an exhausted dimension', async () => {
    const limiter = {
      consume: jest.fn().mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetSeconds: 17,
      }),
      policy: () => '10;w=60',
    };
    const { context, headers } = guardContext();
    const guard = new SubscriptionRateLimitGuard(
      limiter as unknown as SubscriptionRateLimiter,
    );

    const error = await guardRejection(guard.canActivate(context));

    expect(error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(error.getStatus()).toBe(429);
    expect(headers).toMatchObject({
      'RateLimit-Limit': '10',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '17',
      'RateLimit-Policy': '10;w=60',
      'Retry-After': '17',
    });
  });
});

function guardContext(): {
  context: ExecutionContext;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const request = {
    params: { token: Buffer.alloc(32, 9).toString('base64url') },
    ip: '203.0.113.9',
    socket: {},
  } as unknown as Request;
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

async function guardRejection(
  promise: Promise<boolean>,
): Promise<ApiException> {
  try {
    await promise;
    throw new Error('Expected guard to reject');
  } catch (error: unknown) {
    return error as ApiException;
  }
}
