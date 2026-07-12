import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuditListQuery } from '@overvpn/shared/schemas';
import { auditListQuerySchema } from '@overvpn/shared/schemas';
import { ZodQuery } from '../common/zod-validation';
import { AuditService } from './audit.service';

class AuditLogDto {
  @ApiProperty({
    type: String,
    description: 'BIGINT identifier represented as a decimal string.',
  })
  id!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  actorAdminId!: string | null;
  @ApiPropertyOptional({ nullable: true })
  actorUsername!: string | null;
  @ApiProperty()
  action!: string;
  @ApiProperty({ enum: ['SUCCESS', 'FAILURE'] })
  outcome!: string;
  @ApiPropertyOptional({ nullable: true })
  resourceType!: string | null;
  @ApiPropertyOptional({ nullable: true })
  resourceId!: string | null;
  @ApiPropertyOptional({ nullable: true })
  requestId!: string | null;
  @ApiPropertyOptional({ nullable: true })
  ipAddress!: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true })
  details!: unknown;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

class AuditListDto {
  @ApiProperty({ type: [AuditLogDto] })
  items!: AuditLogDto[];
  @ApiProperty({
    example: { page: 1, pageSize: 25, total: 100, totalPages: 4 },
  })
  pagination!: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

@ApiTags('admin audit')
@ApiBearerAuth()
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'actorAdminId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'resourceType', required: false })
  @ApiQuery({ name: 'resourceId', required: false })
  @ApiQuery({
    name: 'outcome',
    required: false,
    enum: ['SUCCESS', 'FAILURE'],
  })
  @ApiQuery({ name: 'from', required: false, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, format: 'date-time' })
  @ApiOkResponse({ type: AuditListDto })
  list(@ZodQuery(auditListQuerySchema) query: AuditListQuery) {
    return this.audit.list(query);
  }
}
