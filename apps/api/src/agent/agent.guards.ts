import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { hashOpaqueToken } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import type { ProxyServer } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';

export type AgentAuthenticatedRequest = Request & {
  proxyServer?: ProxyServer;
};

@Injectable()
export class InstallTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AgentAuthenticatedRequest>();
    const nodeId = pathNodeId(request);
    const token = bearerToken(request);
    if (!token) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED, {
        reason: 'install_token_required',
      });
    }

    const proxyServer = await this.prisma.proxyServer.findFirst({
      where: {
        id: nodeId,
        installTokenHash: hashOpaqueToken(token),
        installTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!proxyServer) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED, {
        reason: 'install_token_invalid',
      });
    }
    if (proxyServer.status === 'DISABLED') {
      throw new ApiException('FORBIDDEN', HttpStatus.FORBIDDEN, {
        reason: 'proxy_server_disabled',
      });
    }

    request.proxyServer = proxyServer;
    return true;
  }
}

@Injectable()
export class NodeTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AgentAuthenticatedRequest>();
    const nodeId = pathNodeId(request);
    const token = bearerToken(request);
    if (!token) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED, {
        reason: 'node_token_required',
      });
    }

    const proxyServer = await this.prisma.proxyServer.findFirst({
      where: {
        id: nodeId,
        nodeTokenHash: hashOpaqueToken(token),
      },
    });
    if (!proxyServer) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED, {
        reason: 'node_token_invalid',
      });
    }
    if (proxyServer.status === 'DISABLED') {
      throw new ApiException('FORBIDDEN', HttpStatus.FORBIDDEN, {
        reason: 'proxy_server_disabled',
      });
    }

    request.proxyServer = proxyServer;
    return true;
  }
}

function pathNodeId(request: Request): string {
  const raw = request.params?.id;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ApiException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
      reason: 'proxy_server_id_required',
    });
  }
  return raw;
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return undefined;
  }
  const [scheme, token, extra] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token && !extra
    ? token
    : undefined;
}
