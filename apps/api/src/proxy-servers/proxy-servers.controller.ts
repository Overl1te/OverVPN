import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type {
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
  createProxyServerSchema,
  idSchema,
  proxyDnsCheckRequestSchema,
  proxyServerListQuerySchema,
  proxyServerWizardSchema,
  updateProxyServerSchema,
} from '@overvpn/shared/schemas';
import { Roles } from '../common/authorization';
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
