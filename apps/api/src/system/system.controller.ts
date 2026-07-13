import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type {
  OnlineSessionListQuery,
  UsageDateRangeQuery,
} from '@overvpn/shared/schemas';
import {
  onlineSessionListQuerySchema,
  usageDateRangeQuerySchema,
} from '@overvpn/shared/schemas';
import { ZodQuery } from '../common/zod-validation';
import { SystemService } from './system.service';

class PaginationDto {
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  total!: number;
  @ApiProperty()
  totalPages!: number;
}

class AdminOnlineSessionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  sessionKey!: string;
  @ApiProperty({ format: 'uuid' })
  userId!: string;
  @ApiProperty()
  username!: string;
  @ApiProperty({ format: 'uuid' })
  inboundId!: string;
  @ApiProperty()
  inboundTag!: string;
  @ApiPropertyOptional({ nullable: true })
  ipAddress!: string | null;
  @ApiPropertyOptional({ nullable: true })
  deviceId!: string | null;
  @ApiProperty({ format: 'date-time' })
  connectedAt!: string;
  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  disconnectedAt!: string | null;
}

class OnlineSessionListDto {
  @ApiProperty({ type: [AdminOnlineSessionDto] })
  items!: AdminOnlineSessionDto[];
  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

class UsagePointDto {
  @ApiProperty({ format: 'date' })
  day!: string;
  @ApiProperty({ type: String })
  uploadBytes!: string;
  @ApiProperty({ type: String })
  downloadBytes!: string;
  @ApiProperty({ type: String })
  totalBytes!: string;
}

class GlobalUsageDto {
  @ApiProperty({ format: 'date' })
  from!: string;
  @ApiProperty({ format: 'date' })
  to!: string;
  @ApiProperty({ type: String })
  uploadBytes!: string;
  @ApiProperty({ type: String })
  downloadBytes!: string;
  @ApiProperty({ type: String })
  totalBytes!: string;
  @ApiProperty({ type: [UsagePointDto], maxItems: 366 })
  series!: UsagePointDto[];
}

class CoreHealthDto {
  @ApiProperty()
  healthy!: boolean;
  @ApiPropertyOptional({ nullable: true })
  version!: string | null;
  @ApiProperty({ minimum: 0 })
  latencyMs!: number;
  @ApiProperty({ format: 'date-time' })
  checkedAt!: string;
  @ApiPropertyOptional({ nullable: true })
  error!: string | null;
  @ApiPropertyOptional({ nullable: true })
  errorRu!: string | null;
}

class WorkerHealthDto {
  @ApiProperty()
  name!: string;
  @ApiProperty({
    enum: [
      'NOT_RUN',
      'RUNNING',
      'HEALTHY',
      'DEGRADED',
      'FAILED',
      'DISABLED',
      'STALE',
      'UNAVAILABLE',
    ],
  })
  state!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastStartedAt!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastFinishedAt!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastSuccessAt!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastFailureAt!: string | null;
  @ApiPropertyOptional({ nullable: true })
  error!: string | null;
  @ApiPropertyOptional({ nullable: true })
  durationMs!: number | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  details!: Record<string, unknown>;
  @ApiProperty()
  staleAfterMs!: number;
}

class SystemHealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status!: string;
  @ApiProperty({ format: 'date-time' })
  checkedAt!: string;
  @ApiProperty({ type: CoreHealthDto })
  core!: CoreHealthDto;
  @ApiProperty({ type: [WorkerHealthDto] })
  workers!: WorkerHealthDto[];
}

class StatusCountsDto {
  @ApiProperty()
  ACTIVE!: number;
  @ApiProperty()
  DISABLED!: number;
  @ApiProperty()
  EXPIRED!: number;
  @ApiProperty()
  LIMITED!: number;
}

class DashboardUsersDto {
  @ApiProperty()
  total!: number;
  @ApiProperty({ type: StatusCountsDto })
  byStatus!: StatusCountsDto;
}

class DashboardOnlineDto {
  @ApiProperty()
  active!: number;
}

class TrafficTotalsDto {
  @ApiProperty({ type: String })
  uploadBytes!: string;
  @ApiProperty({ type: String })
  downloadBytes!: string;
  @ApiProperty({ type: String })
  totalBytes!: string;
}

class DashboardTrafficDto {
  @ApiProperty({ type: TrafficTotalsDto })
  current!: TrafficTotalsDto;
  @ApiProperty({ type: GlobalUsageDto })
  period!: GlobalUsageDto;
  @ApiProperty({
    oneOf: [
      {
        type: 'object',
        required: [
          'available',
          'capturedAt',
          'uploadBytesPerSecond',
          'downloadBytesPerSecond',
          'totalBytesPerSecond',
        ],
        properties: {
          available: { type: 'boolean', enum: [true] },
          capturedAt: { type: 'string', format: 'date-time' },
          uploadBytesPerSecond: { type: 'string' },
          downloadBytesPerSecond: { type: 'string' },
          totalBytesPerSecond: { type: 'string' },
        },
      },
      {
        type: 'object',
        required: ['available', 'reason', 'lastSuccessfulAt'],
        properties: {
          available: { type: 'boolean', enum: [false] },
          reason: { type: 'string' },
          lastSuccessfulAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
        },
      },
    ],
  })
  throughput!: Record<string, unknown>;
}

class SystemDashboardDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
  @ApiProperty({ type: DashboardUsersDto })
  users!: DashboardUsersDto;
  @ApiProperty({ type: DashboardOnlineDto })
  online!: DashboardOnlineDto;
  @ApiProperty({ type: DashboardTrafficDto })
  traffic!: DashboardTrafficDto;
  @ApiProperty({ type: CoreHealthDto })
  core!: CoreHealthDto;
  @ApiProperty({ type: [WorkerHealthDto] })
  workers!: WorkerHealthDto[];
}

@ApiTags('admin online sessions')
@ApiBearerAuth()
@Controller('admin/online-sessions')
export class OnlineSessionsController {
  constructor(private readonly system: SystemService) {}

  @Get()
  @ApiQuery({ name: 'page', required: false, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'userId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'inboundId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'ip', required: false, maxLength: 64 })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['active', 'history', 'all'],
  })
  @ApiOkResponse({ type: OnlineSessionListDto })
  list(@ZodQuery(onlineSessionListQuerySchema) query: OnlineSessionListQuery) {
    return this.system.listOnlineSessions(query);
  }
}

@ApiTags('admin system')
@ApiBearerAuth()
@Controller('admin/system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('dashboard')
  @ApiQuery({ name: 'from', required: false, format: 'date' })
  @ApiQuery({ name: 'to', required: false, format: 'date' })
  @ApiOkResponse({ type: SystemDashboardDto })
  dashboard(@ZodQuery(usageDateRangeQuerySchema) query: UsageDateRangeQuery) {
    return this.system.dashboard(query);
  }

  @Get('usage')
  @ApiQuery({ name: 'from', required: false, format: 'date' })
  @ApiQuery({ name: 'to', required: false, format: 'date' })
  @ApiOkResponse({ type: GlobalUsageDto })
  usage(@ZodQuery(usageDateRangeQuerySchema) query: UsageDateRangeQuery) {
    return this.system.globalUsage(query);
  }

  @Get('health')
  @ApiOkResponse({ type: SystemHealthDto })
  health() {
    return this.system.healthDetails();
  }
}
