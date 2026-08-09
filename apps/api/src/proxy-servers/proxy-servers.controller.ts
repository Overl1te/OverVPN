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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type {
  ConfigApplyRequest,
  CoreApplyListQuery,
  CreateProxyServer,
  ProxyDeleteResponse,
  ProxyDnsCheckRequest,
  ProxyDnsCheckResponse,
  ProxyInstallCommandResponse,
  ProxyServerListQuery,
  ProxyServerSummary,
  ProxyServerWizard,
  UpdateProxyServer,
} from '@overvpn/shared/schemas';
import {
  configApplyRequestSchema,
  coreApplyListQuerySchema,
  createProxyServerSchema,
  idSchema,
  proxyDnsCheckRequestSchema,
  proxyServerListQuerySchema,
  proxyServerWizardSchema,
  updateProxyServerSchema,
} from '@overvpn/shared/schemas';
import {
  CurrentAdmin,
  getRequestMetadata,
  Roles,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation';
import { ProxyServersService } from './proxy-servers.service';

@ApiTags('admin/proxy-servers')
@ApiBearerAuth()
@Roles('OWNER', 'ADMIN')
@Controller('admin/proxy-servers')
export class ProxyServersController {
  constructor(private readonly proxyServers: ProxyServersService) {}

  @Get()
  @ApiOkResponse({ description: 'List proxy servers' })
  @Roles('OWNER', 'ADMIN', 'READONLY')
  list(@ZodQuery(proxyServerListQuerySchema) query: ProxyServerListQuery) {
    return this.proxyServers.list(query);
  }

  @Post('dns-check')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Soft DNS check for wizard domain/IP' })
  dnsCheck(
    @ZodBody(proxyDnsCheckRequestSchema) body: ProxyDnsCheckRequest,
  ): Promise<ProxyDnsCheckResponse> {
    return this.proxyServers.checkDns(body);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Get proxy server' })
  @Roles('OWNER', 'ADMIN', 'READONLY')
  get(@ZodParam('id', idSchema) id: string): Promise<ProxyServerSummary> {
    return this.proxyServers.get(id);
  }

  @Get(':id/config/preview')
  @ApiOkResponse({ description: 'Preview desired core config for this proxy' })
  @Roles('OWNER', 'ADMIN', 'READONLY')
  previewConfig(@ZodParam('id', idSchema) id: string) {
    return this.proxyServers.previewConfig(id);
  }

  @Post(':id/config/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Apply core config to this proxy node' })
  applyConfig(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(configApplyRequestSchema) body: ConfigApplyRequest,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.proxyServers.applyConfig(
      id,
      body,
      actor,
      getRequestMetadata(request),
    );
  }

  @Get(':id/config/apply')
  @ApiOkResponse({ description: 'List core apply history for this proxy' })
  @Roles('OWNER', 'ADMIN', 'READONLY')
  listConfigApplies(
    @ZodParam('id', idSchema) id: string,
    @ZodQuery(coreApplyListQuerySchema) query: CoreApplyListQuery,
  ) {
    return this.proxyServers.listConfigApplies(id, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Create proxy server' })
  create(
    @ZodBody(createProxyServerSchema) body: CreateProxyServer,
  ): Promise<ProxyServerSummary> {
    return this.proxyServers.create(body);
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'Update proxy server' })
  update(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(updateProxyServerSchema) body: UpdateProxyServer,
  ): Promise<ProxyServerSummary> {
    return this.proxyServers.update(id, body);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Disable proxy server' })
  disable(@ZodParam('id', idSchema) id: string): Promise<ProxyServerSummary> {
    return this.proxyServers.disable(id);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Enable proxy server (PENDING until heartbeat)',
  })
  enable(@ZodParam('id', idSchema) id: string): Promise<ProxyServerSummary> {
    return this.proxyServers.enable(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Delete proxy server and its inbounds' })
  remove(@ZodParam('id', idSchema) id: string): Promise<ProxyDeleteResponse> {
    return this.proxyServers.delete(id);
  }

  @Post(':id/install-command')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Issue install command + one-time token' })
  installCommand(
    @ZodParam('id', idSchema) id: string,
  ): Promise<ProxyInstallCommandResponse> {
    return this.proxyServers.createInstallCommand(id);
  }

  @Post(':id/wizard')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Apply proxy server wizard settings' })
  wizard(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(proxyServerWizardSchema) body: ProxyServerWizard,
  ): Promise<ProxyServerSummary> {
    return this.proxyServers.applyWizard(id, body);
  }
}
