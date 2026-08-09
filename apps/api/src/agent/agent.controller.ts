import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  AgentApplyResult,
  AgentDesiredState,
  AgentHeartbeatRequest,
  AgentRegisterRequest,
  AgentRegisterResponse,
  AgentStatsRequest,
} from '@overvpn/shared/schemas';
import {
  agentApplyResultSchema,
  agentHeartbeatRequestSchema,
  agentRegisterRequestSchema,
  agentStatsRequestSchema,
  idSchema,
} from '@overvpn/shared/schemas';
import { Public } from '../common/authorization';
import { ZodBody, ZodParam } from '../common/zod-validation';
import type { ProxyServer } from '../generated/prisma/client';
import { CurrentProxyServer } from './agent.decorators';
import { InstallTokenGuard, NodeTokenGuard } from './agent.guards';
import { AgentService } from './agent.service';

@ApiTags('agent')
@Public()
@Controller('agent/nodes/:id')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InstallTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Register proxy agent and issue node token' })
  register(
    @ZodParam('id', idSchema) _id: string,
    @CurrentProxyServer() proxyServer: ProxyServer,
    @ZodBody(agentRegisterRequestSchema) body: AgentRegisterRequest,
  ): Promise<AgentRegisterResponse> {
    return this.agent.register(proxyServer, body);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(NodeTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Proxy agent heartbeat' })
  heartbeat(
    @ZodParam('id', idSchema) _id: string,
    @CurrentProxyServer() proxyServer: ProxyServer,
    @ZodBody(agentHeartbeatRequestSchema) body: AgentHeartbeatRequest,
  ) {
    return this.agent.heartbeat(proxyServer, body);
  }

  @Post('stats')
  @HttpCode(HttpStatus.OK)
  @UseGuards(NodeTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Proxy agent stats push' })
  stats(
    @ZodParam('id', idSchema) _id: string,
    @CurrentProxyServer() proxyServer: ProxyServer,
    @ZodBody(agentStatsRequestSchema) body: AgentStatsRequest,
  ) {
    return this.agent.stats(proxyServer, body);
  }

  @Get('desired')
  @UseGuards(NodeTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Desired core state for this proxy node' })
  desired(
    @ZodParam('id', idSchema) _id: string,
    @CurrentProxyServer() proxyServer: ProxyServer,
  ): Promise<AgentDesiredState> {
    return this.agent.desired(proxyServer);
  }

  @Post('apply-result')
  @HttpCode(HttpStatus.OK)
  @UseGuards(NodeTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Report apply outcome from proxy agent' })
  applyResult(
    @ZodParam('id', idSchema) _id: string,
    @CurrentProxyServer() proxyServer: ProxyServer,
    @ZodBody(agentApplyResultSchema) body: AgentApplyResult,
  ) {
    return this.agent.applyResult(proxyServer, body);
  }
}
