import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { API_VERSION } from '@overvpn/shared/constants';
import {
  PrismaService,
  RedisService,
} from '../infrastructure/infrastructure.module';
import { Public } from '../common/authorization';

export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'api' })
  service!: 'api';

  @ApiProperty({ example: API_VERSION })
  version!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

export class DependencyCheckDto {
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';

  @ApiProperty({ example: 3, minimum: 0 })
  latencyMs!: number;
}

export class ReadinessChecksDto {
  @ApiProperty({ type: DependencyCheckDto })
  database!: DependencyCheckDto;

  @ApiProperty({ type: DependencyCheckDto })
  redis!: DependencyCheckDto;
}

export class ReadinessResponseDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  getLiveness(): LivenessResponseDto {
    return {
      status: 'ok',
      service: 'api',
      version: API_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResponseDto> {
    const [database, redis] = await Promise.all([
      this.checkDependency('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.checkDependency('redis', async () => {
        const response = await this.redis.ping();
        if (response !== 'PONG') {
          throw new Error('Unexpected Redis PING response');
        }
      }),
    ]);

    const response: ReadinessResponseDto = {
      status:
        database.status === 'up' && redis.status === 'up' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    };

    if (response.status === 'error') {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }

  private async checkDependency(
    name: 'database' | 'redis',
    operation: () => Promise<void>,
  ): Promise<DependencyCheckDto> {
    const startedAt = performance.now();

    try {
      await operation();
      return {
        status: 'up',
        latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown dependency error';
      this.logger.warn(`${name} readiness check failed: ${message}`);
      return {
        status: 'down',
        latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      };
    }
  }
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({ type: LivenessResponseDto })
  getLiveness(): LivenessResponseDto {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  getReadiness(): Promise<ReadinessResponseDto> {
    return this.healthService.getReadiness();
  }
}

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
