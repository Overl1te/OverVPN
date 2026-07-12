import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type {
  BackupListQuery,
  CreateBackupRequest,
  RestoreBackupRequest,
} from '@overvpn/shared/schemas';
import {
  backupListQuerySchema,
  createBackupRequestSchema,
  idSchema,
  restoreBackupRequestSchema,
} from '@overvpn/shared/schemas';
import {
  CurrentAdmin,
  getRequestMetadata,
  Roles,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation';
import { BackupsService } from './backups.service';

class CreateBackupDto {
  @ApiProperty({ enum: ['DATABASE', 'CORE_CONFIG', 'FULL'] })
  kind!: 'DATABASE' | 'CORE_CONFIG' | 'FULL';
}

class RestoreBackupDto {
  @ApiProperty({ enum: [true], description: 'Must be exactly true' })
  confirm!: true;
  @ApiPropertyOptional({ maxLength: 1000 })
  note?: string;
}

class BackupArtifactDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: ['DATABASE', 'CORE_CONFIG', 'FULL'] })
  kind!: string;
  @ApiProperty({
    enum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DELETED'],
  })
  status!: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  sizeBytes!: string | null;
  @ApiPropertyOptional({ nullable: true })
  checksum!: string | null;
  @ApiProperty()
  encrypted!: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true })
  meta!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  expiresAt!: string | null;
}

class BackupListDto {
  @ApiProperty({ type: [BackupArtifactDto] })
  items!: BackupArtifactDto[];
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

@ApiTags('admin backups')
@ApiBearerAuth()
@Controller('admin/backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'kind',
    required: false,
    enum: ['DATABASE', 'CORE_CONFIG', 'FULL'],
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DELETED'],
  })
  @ApiOkResponse({ type: BackupListDto })
  list(@ZodQuery(backupListQuerySchema) query: BackupListQuery) {
    return this.backups.list(query);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiBody({ type: CreateBackupDto })
  @ApiCreatedResponse({ type: BackupArtifactDto })
  create(
    @ZodBody(createBackupRequestSchema) input: CreateBackupRequest,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.backups.create(input, actor, getRequestMetadata(request));
  }

  @Get(':id')
  @ApiOkResponse({ type: BackupArtifactDto })
  get(@ZodParam('id', idSchema) id: string) {
    return this.backups.get(id);
  }

  @Get(':id/download')
  @Roles('OWNER', 'ADMIN')
  @ApiProduces('application/octet-stream')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'Raw backup artifact bytes (possibly AES-GCM encrypted)',
  })
  async download(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    const file = await this.backups.download(
      id,
      actor,
      getRequestMetadata(request),
    );
    return new StreamableFile(file.stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${file.filename}"`,
      length: Number(file.sizeBytes),
    });
  }

  @Post(':id/restore')
  @Roles('OWNER')
  @ApiBody({ type: RestoreBackupDto })
  @ApiOkResponse({ type: BackupArtifactDto })
  restore(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(restoreBackupRequestSchema) input: RestoreBackupRequest,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.backups.restore(id, input, actor, getRequestMetadata(request));
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BackupArtifactDto })
  remove(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.backups.softDelete(id, actor, getRequestMetadata(request));
  }
}
