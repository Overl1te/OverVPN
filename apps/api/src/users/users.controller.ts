import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import type {
  BulkUserActionRequest,
  CreateUser,
  UpdateUser,
  UsageDateRangeQuery,
  UserListQuery,
  UserResult,
} from '@overvpn/shared/schemas';
import {
  bulkUserActionSchema,
  createUserSchema,
  idSchema,
  updateUserSchema,
  usageDateRangeQuerySchema,
  userListQuerySchema,
} from '@overvpn/shared/schemas';
import {
  CurrentAdmin,
  getRequestMetadata,
  Roles,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation';
import { UsersService } from './users.service';

class CreateUserDto {
  @ApiPropertyOptional({ maxLength: 128 })
  identity?: string;
  @ApiProperty({ example: 'alice' })
  username!: string;
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'],
    default: 'ACTIVE',
  })
  status?: string;
  @ApiPropertyOptional({
    enum: ['manual', 'expired', 'quota', 'device', 'ip'],
    nullable: true,
  })
  statusReason?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 4000 })
  note?: string | null;
  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  tags?: string[];
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  planId?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  expireAt?: string | null;
  @ApiPropertyOptional({
    type: String,
    pattern: '^(0|[1-9]\\d*)$',
    nullable: true,
  })
  dataLimitBytes?: string | null;
  @ApiPropertyOptional({
    enum: ['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'],
  })
  resetStrategy?: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  nextResetAt?: string | null;
  @ApiPropertyOptional({ minimum: 1, nullable: true })
  deviceLimit?: number | null;
  @ApiPropertyOptional({ minimum: 1, nullable: true })
  ipLimit?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  speedLimitBps?: string | null;
}

class UpdateUserDto extends PartialType(CreateUserDto) {}

class BulkUserActionDto {
  @ApiProperty({
    enum: [
      'disable',
      'enable',
      'reset-traffic',
      'extend',
      'set-plan',
      'rotate-sub',
    ],
  })
  action!: string;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 500 })
  userIds!: string[];
  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  days?: number;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  planId?: string | null;
}

class UserDto implements UserResult {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  identity!: string;
  @ApiProperty()
  username!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'] })
  status!: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'LIMITED';
  @ApiPropertyOptional({ nullable: true })
  statusReason!: 'manual' | 'expired' | 'quota' | 'device' | 'ip' | null;
  @ApiPropertyOptional({ nullable: true })
  note!: string | null;
  @ApiProperty({ type: [String] })
  tags!: string[];
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  expireAt!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  dataLimitBytes!: string | null;
  @ApiProperty({ type: String })
  usedUploadBytes!: string;
  @ApiProperty({ type: String })
  usedDownloadBytes!: string;
  @ApiProperty({ minimum: 0 })
  accountingEpoch!: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  trafficResetAt!: string | null;
  @ApiProperty({ enum: ['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'] })
  resetStrategy!: 'NO_RESET' | 'DAILY' | 'MONTHLY' | 'YEARLY';
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  nextResetAt!: string | null;
  @ApiPropertyOptional({ nullable: true })
  deviceLimit!: number | null;
  @ApiPropertyOptional({ nullable: true })
  ipLimit!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  speedLimitBps!: string | null;
  @ApiProperty()
  subToken!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  planId!: string | null;
  @ApiProperty({
    description:
      'True until the Phase 2 core reconciler applies the durable pending change.',
  })
  needsApply!: boolean;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  deletedAt!: string | null;
}

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

class UserListDto {
  @ApiProperty({ type: [UserDto] })
  items!: UserDto[];
  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

class BulkUserResultDto {
  @ApiProperty()
  action!: string;
  @ApiProperty()
  affected!: number;
  @ApiProperty({ type: [UserDto] })
  users!: UserDto[];
}

class UserUsageDto {
  @ApiProperty({ format: 'date' })
  from!: string;
  @ApiProperty({ format: 'date' })
  to!: string;
  @ApiProperty({ type: String })
  usedUploadBytes!: string;
  @ApiProperty({ type: String })
  usedDownloadBytes!: string;
  @ApiProperty({ type: String })
  usedTotalBytes!: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  dataLimitBytes!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  remainingBytes!: string | null;
  @ApiProperty({ type: String })
  dailyUploadBytes!: string;
  @ApiProperty({ type: String })
  dailyDownloadBytes!: string;
  @ApiProperty({ type: String })
  periodUploadBytes!: string;
  @ApiProperty({ type: String })
  periodDownloadBytes!: string;
  @ApiProperty({ type: String })
  periodTotalBytes!: string;
  @ApiProperty({
    type: 'array',
    maxItems: 366,
    items: {
      type: 'object',
      required: ['day', 'uploadBytes', 'downloadBytes', 'totalBytes'],
      properties: {
        day: { type: 'string', format: 'date' },
        uploadBytes: { type: 'string' },
        downloadBytes: { type: 'string' },
        totalBytes: { type: 'string' },
      },
    },
  })
  series!: Array<{
    day: string;
    uploadBytes: string;
    downloadBytes: string;
    totalBytes: string;
  }>;
}

class OnlineSessionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  sessionKey!: string;
  @ApiProperty({ format: 'uuid' })
  inboundId!: string;
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

@ApiTags('admin users')
@ApiBearerAuth()
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, maximum: 100 })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'],
  })
  @ApiQuery({ name: 'tag', required: false })
  @ApiQuery({ name: 'planId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: [
      'username',
      'identity',
      'status',
      'expireAt',
      'createdAt',
      'updatedAt',
    ],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: UserListDto })
  list(@ZodQuery(userListQuerySchema) query: UserListQuery) {
    return this.users.list(query);
  }

  @Post()
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({ type: UserDto })
  create(
    @ZodBody(createUserSchema) input: CreateUser,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.create(input, actor, getRequestMetadata(request));
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply one transactional action to multiple users' })
  @ApiBody({ type: BulkUserActionDto })
  @ApiOkResponse({ type: BulkUserResultDto })
  bulk(
    @ZodBody(bulkUserActionSchema) input: BulkUserActionRequest,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.bulk(input, actor, getRequestMetadata(request));
  }

  @Post(':id/rotate-sub')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate one subscription URL without applying core configuration',
  })
  @ApiOkResponse({ type: UserDto })
  rotateSubscription(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.rotateSubscription(
      id,
      actor,
      getRequestMetadata(request),
    );
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/reset-traffic')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset traffic and advance the accounting epoch',
  })
  @ApiOkResponse({ type: UserDto })
  resetTraffic(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.resetTraffic(id, actor, getRequestMetadata(request));
  }

  @Get(':id')
  @ApiOkResponse({ type: UserDto })
  get(@ZodParam('id', idSchema) id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ type: UserDto })
  update(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(updateUserSchema) input: UpdateUser,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.update(id, input, actor, getRequestMetadata(request));
  }

  @Roles('OWNER')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  remove(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.remove(id, actor, getRequestMetadata(request));
  }

  @Get(':id/usage')
  @ApiQuery({ name: 'from', required: false, format: 'date' })
  @ApiQuery({ name: 'to', required: false, format: 'date' })
  @ApiOkResponse({ type: UserUsageDto })
  usage(
    @ZodParam('id', idSchema) id: string,
    @ZodQuery(usageDateRangeQuerySchema) query: UsageDateRangeQuery,
  ) {
    return this.users.usage(id, query);
  }

  @Get(':id/sessions')
  @ApiOkResponse({ type: [OnlineSessionDto] })
  sessions(@ZodParam('id', idSchema) id: string) {
    return this.users.recentSessions(id);
  }
}
