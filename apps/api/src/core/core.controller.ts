import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ConfigApplyRequest,
  CoreApplyListQuery,
} from '@overvpn/shared/schemas';
import {
  configApplyRequestSchema,
  coreApplyListQuerySchema,
  idSchema,
} from '@overvpn/shared/schemas';
import {
  CurrentAdmin,
  getRequestMetadata,
  Roles,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation';
import { CoreApplyService } from './core-apply.service';
import { CoreProvider } from './core-provider';

@ApiTags('admin core config')
@ApiBearerAuth()
@Controller('admin/config')
export class CoreController {
  constructor(
    private readonly applies: CoreApplyService,
    private readonly provider: CoreProvider,
  ) {}

  @Get('preview')
  @ApiOperation({
    summary: 'Render and validate a redacted desired sing-box configuration',
  })
  preview() {
    return this.applies.preview();
  }

  @Roles('OWNER', 'ADMIN')
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      additionalProperties: false,
      properties: {
        reason: { type: 'string', minLength: 3, maxLength: 1000 },
      },
    },
  })
  apply(
    @ZodBody(configApplyRequestSchema) input: ConfigApplyRequest,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.applies.apply(
      actor,
      input,
      'MANUAL',
      getRequestMetadata(request),
    );
  }

  @Get('apply')
  history(@ZodQuery(coreApplyListQuerySchema) query: CoreApplyListQuery) {
    return this.applies.list(query);
  }

  @Get('apply/:id')
  getApply(@ZodParam('id', idSchema) id: string) {
    return this.applies.get(id);
  }

  @Get('runtime/health')
  runtimeHealth() {
    return this.provider.health();
  }

  @Get('runtime/connections')
  onlineClients() {
    return this.provider.getOnlineClients();
  }

  @Get('runtime/traffic')
  traffic() {
    return this.provider.getTrafficSnapshot();
  }
}
