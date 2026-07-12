import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';
import { RedisService } from '../infrastructure/infrastructure.module';

export const SUBSCRIPTION_RATE_LIMIT_SCRIPT = `
local ip_count = redis.call('INCR', KEYS[1])
if ip_count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
end

local token_count = redis.call('INCR', KEYS[2])
if token_count == 1 then
  redis.call('PEXPIRE', KEYS[2], ARGV[3])
end

local ip_ttl = redis.call('PTTL', KEYS[1])
local token_ttl = redis.call('PTTL', KEYS[2])
local reset_ms = math.max(ip_ttl, token_ttl)
local remaining = math.min(tonumber(ARGV[1]) - ip_count, tonumber(ARGV[2]) - token_count)
if remaining < 0 then remaining = 0 end

local allowed = 0
if ip_count <= tonumber(ARGV[1]) and token_count <= tonumber(ARGV[2]) then
  allowed = 1
end

return { allowed, remaining, reset_ms, ip_count, token_count }
`.trim();

export interface SubscriptionRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

@Injectable()
export class SubscriptionRateLimitStore {
  constructor(private readonly redis: RedisService) {}

  async consume(input: {
    ipAddress: string;
    token: string;
    ipLimit: number;
    tokenLimit: number;
    windowMs: number;
  }): Promise<SubscriptionRateLimitResult> {
    const ipKey = `sub-rate:v1:ip:${sha256(input.ipAddress)}`;
    const tokenKey = `sub-rate:v1:token:${subscriptionTokenFingerprint(
      input.token,
    )}`;
    const raw = await this.redis
      .getClient()
      .eval(
        SUBSCRIPTION_RATE_LIMIT_SCRIPT,
        2,
        ipKey,
        tokenKey,
        input.ipLimit,
        input.tokenLimit,
        input.windowMs,
      );
    if (
      !Array.isArray(raw) ||
      raw.length !== 5 ||
      raw.some((entry) => typeof entry !== 'number')
    ) {
      throw new Error(
        'Redis returned an invalid subscription rate-limit result',
      );
    }
    const [allowed, remaining, resetMs] = raw as number[];
    return {
      allowed: allowed === 1,
      limit: Math.min(input.ipLimit, input.tokenLimit),
      remaining,
      resetSeconds: Math.max(1, Math.ceil(resetMs / 1_000)),
    };
  }
}

@Injectable()
export class SubscriptionRateLimiter {
  private readonly ipLimit: number;
  private readonly tokenLimit: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly store: SubscriptionRateLimitStore,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.ipLimit = config.get('SUB_RATE_LIMIT_IP_LIMIT', { infer: true });
    this.tokenLimit = config.get('SUB_RATE_LIMIT_TOKEN_LIMIT', { infer: true });
    this.windowSeconds = config.get('SUB_RATE_LIMIT_WINDOW_SECONDS', {
      infer: true,
    });
  }

  consume(
    ipAddress: string,
    token: string,
  ): Promise<SubscriptionRateLimitResult> {
    return this.store.consume({
      ipAddress,
      token,
      ipLimit: this.ipLimit,
      tokenLimit: this.tokenLimit,
      windowMs: this.windowSeconds * 1_000,
    });
  }

  policy(): string {
    return `${Math.min(this.ipLimit, this.tokenLimit)};w=${this.windowSeconds}`;
  }
}

@Injectable()
export class SubscriptionRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: SubscriptionRateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const token =
      typeof request.params.token === 'string' ? request.params.token : '';
    const ipAddress =
      request.ip || request.socket.remoteAddress || 'unknown-source';

    let result: SubscriptionRateLimitResult;
    try {
      result = await this.limiter.consume(ipAddress, token);
    } catch {
      response.setHeader('Retry-After', '5');
      throw new ApiException(
        'SUBSCRIPTION_UNAVAILABLE',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    response.setHeader('RateLimit-Limit', result.limit.toString());
    response.setHeader('RateLimit-Remaining', result.remaining.toString());
    response.setHeader('RateLimit-Reset', result.resetSeconds.toString());
    response.setHeader('RateLimit-Policy', this.limiter.policy());
    response.setHeader('X-RateLimit-Limit', result.limit.toString());
    response.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    response.setHeader(
      'X-RateLimit-Reset',
      (Math.floor(Date.now() / 1_000) + result.resetSeconds).toString(),
    );

    if (!result.allowed) {
      response.setHeader('Retry-After', result.resetSeconds.toString());
      throw new ApiException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

export function subscriptionTokenFingerprint(token: string): string {
  return sha256(token);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
