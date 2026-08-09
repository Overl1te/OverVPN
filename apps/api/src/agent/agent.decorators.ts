import {
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { ApiException } from '../common/api-error';
import type { ProxyServer } from '../generated/prisma/client';
import type { AgentAuthenticatedRequest } from './agent.guards';

export const CurrentProxyServer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ProxyServer => {
    const request = context
      .switchToHttp()
      .getRequest<AgentAuthenticatedRequest>();
    if (!request.proxyServer) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }
    return request.proxyServer;
  },
);
