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
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import type {
  CreatePlan,
  PlanListQuery,
  PlanResult,
  UpdatePlan,
} from '@overvpn/shared/schemas';
import {
  createPlanSchema,
  idSchema,
  planListQuerySchema,
  updatePlanSchema,
} from '@overvpn/shared/schemas';
import {
  CurrentAdmin,
  getRequestMetadata,
  Roles,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation';
import { PlansService } from './plans.service';

class CreatePlanDto {
  @ApiProperty({ maxLength: 100 })
  name!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 4000 })
  description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  defaultDataLimitBytes?: string | null;
  @ApiPropertyOptional({ minimum: 1, maximum: 3650, nullable: true })
  defaultExpiryDays?: number | null;
  @ApiPropertyOptional({ minimum: 1, nullable: true })
  defaultDeviceLimit?: number | null;
  @ApiPropertyOptional({ minimum: 1, nullable: true })
  defaultIpLimit?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  defaultSpeedLimitBps?: string | null;
  @ApiPropertyOptional({
    enum: ['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'],
  })
  defaultResetStrategy?: string;
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 128 })
  inboundIds?: string[];
}

class UpdatePlanDto extends PartialType(CreatePlanDto) {}

class PlanDto implements PlanResult {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiPropertyOptional({ nullable: true })
  description!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] })
  status!: 'ACTIVE' | 'ARCHIVED';
  @ApiPropertyOptional({ type: String, nullable: true })
  defaultDataLimitBytes!: string | null;
  @ApiPropertyOptional({ nullable: true })
  defaultExpiryDays!: number | null;
  @ApiPropertyOptional({ nullable: true })
  defaultDeviceLimit!: number | null;
  @ApiPropertyOptional({ nullable: true })
  defaultIpLimit!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  defaultSpeedLimitBps!: string | null;
  @ApiProperty({ enum: ['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'] })
  defaultResetStrategy!: 'NO_RESET' | 'DAILY' | 'MONTHLY' | 'YEARLY';
  @ApiProperty({ type: [String], format: 'uuid' })
  inboundIds!: string[];
  @ApiProperty()
  userCount!: number;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  archivedAt!: string | null;
}

class PlanListDto {
  @ApiProperty({ type: [PlanDto] })
  items!: PlanDto[];
  @ApiProperty({
    example: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
  })
  pagination!: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

@ApiTags('admin plans')
@ApiBearerAuth()
@Controller('admin/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'ARCHIVED'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: PlanListDto })
  list(@ZodQuery(planListQuerySchema) query: PlanListQuery) {
    return this.plans.list(query);
  }

  @Post()
  @ApiBody({ type: CreatePlanDto })
  @ApiCreatedResponse({ type: PlanDto })
  create(
    @ZodBody(createPlanSchema) input: CreatePlan,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.plans.create(input, actor, getRequestMetadata(request));
  }

  @Get(':id')
  @ApiOkResponse({ type: PlanDto })
  get(@ZodParam('id', idSchema) id: string) {
    return this.plans.get(id);
  }

  @Patch(':id')
  @ApiBody({ type: UpdatePlanDto })
  @ApiOkResponse({ type: PlanDto })
  update(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(updatePlanSchema) input: UpdatePlan,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.plans.update(id, input, actor, getRequestMetadata(request));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlanDto })
  archive(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.plans.archive(id, actor, getRequestMetadata(request));
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
    return this.plans.remove(id, actor, getRequestMetadata(request));
  }
}
