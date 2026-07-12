import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole } from '@overvpn/shared/constants';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import type { AppEnvironment } from '../config/environment';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { ApiException } from './api-error';

export const IS_PUBLIC_KEY = 'overvpn:is-public';
export const ROLES_KEY = 'overvpn:roles';
export const READONLY_MUTATION_KEY = 'overvpn:readonly-mutation';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
export const AllowReadonlyMutation = () =>
  SetMetadata(READONLY_MUTATION_KEY, true);

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  role: AdminRole;
  locale: 'en' | 'ru';
  active: boolean;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
}

export type AuthenticatedRequest = Request & {
  id?: string;
  admin?: AuthenticatedAdmin;
};

interface AccessTokenClaims {
  sub: string;
  username: string;
  role: AdminRole;
  type: 'access';
}

@Injectable()
export class JwtAuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearerToken(request);
    if (!token) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        issuer: this.config.get('JWT_ISSUER', { infer: true }),
        audience: this.config.get('JWT_AUDIENCE', { infer: true }),
      });
    } catch {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }

    if (claims.type !== 'access' || !claims.sub) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        username: true,
        role: true,
        locale: true,
        active: true,
        totpSecretEncrypted: true,
        lastLoginAt: true,
      },
    });

    if (!admin?.active) {
      throw new ApiException('AUTH_ACCOUNT_INACTIVE', HttpStatus.UNAUTHORIZED);
    }

    request.admin = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      locale: admin.locale === 'RU' ? 'ru' : 'en',
      active: admin.active,
      totpEnabled: admin.totpSecretEncrypted !== null,
      lastLoginAt: admin.lastLoginAt,
    };
    return true;
  }

  private bearerToken(request: Request): string | undefined {
    const authorization = request.headers.authorization;
    if (!authorization) {
      return undefined;
    }
    const [scheme, token, extra] = authorization.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token && !extra
      ? token
      : undefined;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const admin = request.admin;
    if (!admin) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }

    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles && !requiredRoles.includes(admin.role)) {
      throw new ApiException('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    const readonlyMutationAllowed =
      this.reflector.getAllAndOverride<boolean>(READONLY_MUTATION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (admin.role === 'READONLY' && isMutation && !readonlyMutationAllowed) {
      throw new ApiException('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAdmin => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.admin) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }
    return request.admin;
  },
);

export interface RequestMetadata {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export function getRequestMetadata(
  request: AuthenticatedRequest,
): RequestMetadata {
  const forwarded = request.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0]?.trim();
  return {
    requestId:
      request.id ?? request.headers['x-request-id']?.toString() ?? null,
    ipAddress:
      forwardedIp ?? request.ip ?? request.socket.remoteAddress ?? null,
    userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
  };
}
