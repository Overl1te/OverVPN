import { PrismaPg } from '@prisma/adapter-pg';
import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type RedisOptions } from 'ioredis';
import type { AppEnvironment } from '../config/environment';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly serviceLogger = new Logger(PrismaService.name);

  constructor(config: ConfigService<AppEnvironment, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
    });
    const log =
      config.get('NODE_ENV', { infer: true }) === 'development'
        ? (['warn', 'error'] as const)
        : (['error'] as const);

    super({ adapter, log: [...log] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.serviceLogger.log('PostgreSQL connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService<AppEnvironment, true>) {
    const options: RedisOptions = {
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      commandTimeout: 5_000,
      connectionName: 'overvpn-api',
      retryStrategy: (attempt) =>
        attempt > 5 ? null : Math.min(attempt * 200, 2_000),
    };

    this.client = new Redis(config.get('REDIS_URL', { infer: true }), options);
    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis client error: ${error.message}`, error.stack);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    const response = await this.client.ping();
    if (response !== 'PONG') {
      throw new Error('Redis did not return PONG during startup');
    }
    this.logger.log('Redis connection established');
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }

    try {
      await this.client.quit();
    } catch {
      this.client.disconnect(false);
    }
  }
}

@Global()
@Module({
  providers: [PrismaService, RedisService],
  exports: [PrismaService, RedisService],
})
export class InfrastructureModule {}
