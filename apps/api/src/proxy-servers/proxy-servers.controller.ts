import {
  Controller,
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
  ProxyInstallCommandResponse,
  ProxyServerListQuery,
  ProxyServerSummary,
  ProxyServerWizard,
  UpdateProxyServer,
} from '@overvpn/shared/schemas';
import {
  createProxyServerSchema,
  idSchema,
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
