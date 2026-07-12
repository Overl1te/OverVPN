import { Controller, Get, Patch, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import type { UpdateSystemSettings } from '@overvpn/shared/schemas';
import { updateSystemSettingsSchema } from '@overvpn/shared/schemas';
import {
  CurrentAdmin,
  getRequestMetadata,
  Roles,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody } from '../common/zod-validation';
import { SettingsService } from './settings.service';

class SystemSettingsReadOnlyDto {
  @ApiProperty()
  corsOriginsCount!: number;
  @ApiProperty()
  workersEnabled!: boolean;
  @ApiProperty()
  backupDir!: string;
  @ApiProperty()
  backupRetentionDays!: number;
  @ApiProperty()
  backupEncrypt!: boolean;
  @ApiProperty({ enum: ['development', 'test', 'production'] })
  nodeEnv!: string;
  @ApiProperty()
  swaggerEnabled!: boolean;
  @ApiProperty()
  subPublicBaseUrlEnv!: string;
  @ApiProperty()
  telegramEnvConfigured!: boolean;
}

class SystemSettingsDto {
  @ApiPropertyOptional({ nullable: true })
  panelUrl!: string | null;
  @ApiProperty()
  subPublicBaseUrl!: string;
  @ApiProperty()
  profileUpdateIntervalHours!: number;
  @ApiProperty()
  notifyTelegramEnabled!: boolean;
  @ApiProperty({
    description:
      'Whether a Telegram bot token is configured (never returns the token)',
  })
  telegramBotTokenConfigured!: boolean;
  @ApiProperty()
  telegramChatIdConfigured!: boolean;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } })
  featureFlags!: Record<string, boolean>;
  @ApiProperty()
  revision!: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  updatedAt!: string | null;
  @ApiProperty({ type: SystemSettingsReadOnlyDto })
  readOnly!: SystemSettingsReadOnlyDto;
}

class UpdateSystemSettingsDto {
  @ApiPropertyOptional({ nullable: true })
  panelUrl?: string | null;
  @ApiPropertyOptional()
  subPublicBaseUrl?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 168 })
  profileUpdateIntervalHours?: number;
  @ApiPropertyOptional()
  notifyTelegramEnabled?: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Write-only. Null clears the stored token. Never returned by GET.',
  })
  telegramBotToken?: string | null;
  @ApiPropertyOptional({ nullable: true })
  telegramChatId?: string | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  featureFlags?: Record<string, boolean>;
}

@ApiTags('admin settings')
@ApiBearerAuth()
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOkResponse({ type: SystemSettingsDto })
  get() {
    return this.settings.get();
  }

  @Patch()
  @Roles('OWNER', 'ADMIN')
  @ApiBody({ type: UpdateSystemSettingsDto })
  @ApiOkResponse({ type: SystemSettingsDto })
  update(
    @ZodBody(updateSystemSettingsSchema) input: UpdateSystemSettings,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settings.update(input, actor, getRequestMetadata(request));
  }
}
