import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ERROR_MESSAGES, type AdminRole } from '@overvpn/shared/constants';
import type {
  AdminSummary,
  AuthenticatedSession,
  LoginRequest,
  LoginResponse,
  TotpDisableRequest,
  TotpEnableRequest,
  TotpEnableResponse,
} from '@overvpn/shared/schemas';
import { AuditService } from '../audit/audit.service';
import type { RequestMetadata } from '../common/authorization';
import type { AuthenticatedAdmin } from '../common/authorization';
import { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';
import { PrismaService } from '../infrastructure/infrastructure.module';
import {
  createOpaqueToken,
  hashOpaqueToken,
  PasswordService,
  SecretEncryptionService,
  TotpService,
} from './auth-crypto';

type AdminRecord = {
  id: string;
  username: string;
  passwordHash: string;
  role: AdminRole;
  locale: 'EN' | 'RU';
  active: boolean;
  pendingTotpSecretEncrypted: string | null;
  totpSecretEncrypted: string | null;
  lastLoginAt: Date | null;
};

export interface AuthResult {
  response: LoginResponse | AuthenticatedSession;
  refreshToken?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly encryption: SecretEncryptionService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
  ) {}

  async login(
    input: LoginRequest,
    metadata: RequestMetadata,
  ): Promise<AuthResult> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { username: input.username },
    });
    const passwordValid = await this.passwords.verify(
      admin?.passwordHash ?? null,
      input.password,
    );

    if (!admin || !passwordValid) {
      await this.audit.recordFailureSafely({
        actorAdminId: admin?.id,
        action: 'ADMIN_LOGIN',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'invalid_credentials', username: input.username },
      });
      throw new ApiException(
        'AUTH_INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!admin.active) {
      await this.audit.recordFailureSafely({
        actorAdminId: admin.id,
        action: 'ADMIN_LOGIN',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'account_inactive' },
      });
      throw new ApiException('AUTH_ACCOUNT_INACTIVE', HttpStatus.UNAUTHORIZED);
    }

    if (admin.totpSecretEncrypted) {
      if (!input.totpCode) {
        return {
          response: {
            status: 'TOTP_REQUIRED',
            code: 'AUTH_TOTP_REQUIRED',
            message: ERROR_MESSAGES.AUTH_TOTP_REQUIRED.en,
            messageRu: ERROR_MESSAGES.AUTH_TOTP_REQUIRED.ru,
          },
        };
      }
      const secret = this.encryption.decrypt(admin.totpSecretEncrypted);
      if (!(await this.totp.verify(secret, input.totpCode))) {
        await this.audit.recordFailureSafely({
          actorAdminId: admin.id,
          action: 'ADMIN_LOGIN',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          metadata: { reason: 'invalid_totp' },
        });
        throw new ApiException('AUTH_TOTP_INVALID', HttpStatus.UNAUTHORIZED);
      }
    }

    const refreshToken = createOpaqueToken();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: now },
      });
      await tx.refreshToken.create({
        data: {
          adminUserId: admin.id,
          tokenHash: hashOpaqueToken(refreshToken),
          familyId: randomUUID(),
          expiresAt: this.refreshExpiry(now),
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      });
      await this.audit.record(
        {
          actorAdminId: admin.id,
          action: 'ADMIN_LOGIN',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          metadata: {
            method: admin.totpSecretEncrypted ? 'password_totp' : 'password',
          },
        },
        tx,
      );
    });

    const currentAdmin = { ...admin, lastLoginAt: now };
    return {
      refreshToken,
      response: await this.createSession(
        currentAdmin,
        input.returnRefreshToken ? refreshToken : undefined,
      ),
    };
  }

  async refresh(
    refreshToken: string,
    returnRefreshToken: boolean,
    metadata: RequestMetadata,
  ): Promise<AuthResult> {
    const nextToken = createOpaqueToken();
    const tokenHash = hashOpaqueToken(refreshToken);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { adminUser: true },
      });
      if (!current) {
        return { kind: 'invalid' as const };
      }

      if (current.revokedAt || current.replacedByTokenId) {
        await tx.refreshToken.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'reuse_detected' },
        });
        await this.audit.record(
          {
            actorAdminId: current.adminUserId,
            action: 'ADMIN_REFRESH',
            outcome: 'FAILURE',
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            metadata: { reason: 'reuse_detected' },
          },
          tx,
        );
        return { kind: 'reuse' as const };
      }
      if (current.expiresAt <= now) {
        await tx.refreshToken.update({
          where: { id: current.id },
          data: { revokedAt: now, revocationReason: 'expired' },
        });
        return { kind: 'invalid' as const, actorAdminId: current.adminUserId };
      }
      if (!current.adminUser.active) {
        await tx.refreshToken.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'account_inactive' },
        });
        return { kind: 'inactive' as const, actorAdminId: current.adminUserId };
      }

      const claimed = await tx.refreshToken.updateMany({
        where: {
          id: current.id,
          revokedAt: null,
          replacedByTokenId: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now, revocationReason: 'rotated' },
      });
      if (claimed.count !== 1) {
        await tx.refreshToken.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'reuse_detected' },
        });
        return { kind: 'reuse' as const };
      }

      const replacement = await tx.refreshToken.create({
        data: {
          adminUserId: current.adminUserId,
          tokenHash: hashOpaqueToken(nextToken),
          familyId: current.familyId,
          expiresAt: this.refreshExpiry(now),
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      });
      await tx.refreshToken.update({
        where: { id: current.id },
        data: { replacedByTokenId: replacement.id },
      });
      await this.audit.record(
        {
          actorAdminId: current.adminUserId,
          action: 'ADMIN_REFRESH',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
        },
        tx,
      );
      return { kind: 'success' as const, admin: current.adminUser };
    });

    if (result.kind === 'reuse') {
      throw new ApiException('AUTH_REFRESH_REUSED', HttpStatus.UNAUTHORIZED);
    }
    if (result.kind === 'inactive') {
      throw new ApiException('AUTH_ACCOUNT_INACTIVE', HttpStatus.UNAUTHORIZED);
    }
    if (result.kind === 'invalid') {
      await this.audit.recordFailureSafely({
        actorAdminId: result.actorAdminId,
        action: 'ADMIN_REFRESH',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'invalid_or_expired' },
      });
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }

    return {
      refreshToken: nextToken,
      response: await this.createSession(
        result.admin,
        returnRefreshToken ? nextToken : undefined,
      ),
    };
  }

  async logout(
    admin: AuthenticatedAdmin,
    refreshToken: string | undefined,
    metadata: RequestMetadata,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (refreshToken) {
        const stored = await tx.refreshToken.findUnique({
          where: { tokenHash: hashOpaqueToken(refreshToken) },
        });
        if (stored?.adminUserId === admin.id) {
          await tx.refreshToken.updateMany({
            where: { familyId: stored.familyId, revokedAt: null },
            data: { revokedAt: now, revocationReason: 'logout' },
          });
        }
      } else {
        await tx.refreshToken.updateMany({
          where: { adminUserId: admin.id, revokedAt: null },
          data: { revokedAt: now, revocationReason: 'logout' },
        });
      }
      await this.audit.record(
        {
          actorAdminId: admin.id,
          action: 'ADMIN_LOGOUT',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
        },
        tx,
      );
    });
  }

  async enableTotp(
    admin: AuthenticatedAdmin,
    input: TotpEnableRequest,
    metadata: RequestMetadata,
  ): Promise<TotpEnableResponse> {
    const record = await this.requireAdmin(admin.id);
    try {
      await this.requirePassword(record, input.currentPassword);
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: record.id,
        action: 'ADMIN_TOTP_ENABLE',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'invalid_password' },
      });
      throw error;
    }
    if (record.totpSecretEncrypted) {
      if (!input.currentTotpCode) {
        await this.audit.recordFailureSafely({
          actorAdminId: record.id,
          action: 'ADMIN_TOTP_ENABLE',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          metadata: { reason: 'totp_required' },
        });
        throw new ApiException('AUTH_TOTP_REQUIRED', HttpStatus.UNAUTHORIZED);
      }
      const currentSecret = this.encryption.decrypt(record.totpSecretEncrypted);
      if (!(await this.totp.verify(currentSecret, input.currentTotpCode))) {
        await this.audit.recordFailureSafely({
          actorAdminId: record.id,
          action: 'ADMIN_TOTP_ENABLE',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          metadata: { reason: 'invalid_totp' },
        });
        throw new ApiException('AUTH_TOTP_INVALID', HttpStatus.UNAUTHORIZED);
      }
    }

    const setup = this.totp.create(record.username);
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: record.id },
        data: {
          pendingTotpSecretEncrypted: this.encryption.encrypt(setup.secret),
        },
      });
      await this.audit.record(
        {
          actorAdminId: record.id,
          action: 'ADMIN_TOTP_ENABLE',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          metadata: { state: 'pending_confirmation' },
        },
        tx,
      );
    });
    return setup;
  }

  async confirmTotp(
    admin: AuthenticatedAdmin,
    code: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const record = await this.requireAdmin(admin.id);
    if (!record.pendingTotpSecretEncrypted) {
      await this.audit.recordFailureSafely({
        actorAdminId: record.id,
        action: 'ADMIN_TOTP_CONFIRM',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'totp_setup_not_pending' },
      });
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'totp_setup_not_pending',
      });
    }
    const secret = this.encryption.decrypt(record.pendingTotpSecretEncrypted);
    if (!(await this.totp.verify(secret, code))) {
      await this.audit.recordFailureSafely({
        actorAdminId: record.id,
        action: 'ADMIN_TOTP_CONFIRM',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'invalid_totp' },
      });
      throw new ApiException('AUTH_TOTP_INVALID', HttpStatus.UNAUTHORIZED);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: record.id },
        data: {
          totpSecretEncrypted: record.pendingTotpSecretEncrypted,
          pendingTotpSecretEncrypted: null,
        },
      });
      await this.audit.record(
        {
          actorAdminId: record.id,
          action: 'ADMIN_TOTP_CONFIRM',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
        },
        tx,
      );
    });
  }

  async disableTotp(
    admin: AuthenticatedAdmin,
    input: TotpDisableRequest,
    metadata: RequestMetadata,
  ): Promise<void> {
    const record = await this.requireAdmin(admin.id);
    try {
      await this.requirePassword(record, input.currentPassword);
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: record.id,
        action: 'ADMIN_TOTP_DISABLE',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'invalid_password' },
      });
      throw error;
    }
    if (!record.totpSecretEncrypted) {
      await this.audit.recordFailureSafely({
        actorAdminId: record.id,
        action: 'ADMIN_TOTP_DISABLE',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'totp_not_enabled' },
      });
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'totp_not_enabled',
      });
    }
    const secret = this.encryption.decrypt(record.totpSecretEncrypted);
    if (!(await this.totp.verify(secret, input.totpCode))) {
      await this.audit.recordFailureSafely({
        actorAdminId: record.id,
        action: 'ADMIN_TOTP_DISABLE',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { reason: 'invalid_totp' },
      });
      throw new ApiException('AUTH_TOTP_INVALID', HttpStatus.UNAUTHORIZED);
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: record.id },
        data: {
          totpSecretEncrypted: null,
          pendingTotpSecretEncrypted: null,
        },
      });
      await tx.refreshToken.updateMany({
        where: { adminUserId: record.id, revokedAt: null },
        data: { revokedAt: now, revocationReason: 'totp_disabled' },
      });
      await this.audit.record(
        {
          actorAdminId: record.id,
          action: 'ADMIN_TOTP_DISABLE',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
        },
        tx,
      );
    });
  }

  me(admin: AuthenticatedAdmin): AdminSummary {
    return {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      locale: admin.locale,
      active: admin.active,
      totpEnabled: admin.totpEnabled,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    };
  }

  private async requireAdmin(id: string): Promise<AdminRecord> {
    const record = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!record?.active) {
      throw new ApiException('AUTH_ACCOUNT_INACTIVE', HttpStatus.UNAUTHORIZED);
    }
    return record;
  }

  private async requirePassword(
    admin: AdminRecord,
    password: string,
  ): Promise<void> {
    if (!(await this.passwords.verify(admin.passwordHash, password))) {
      throw new ApiException(
        'AUTH_INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private async createSession(
    admin: Pick<
      AdminRecord,
      | 'id'
      | 'username'
      | 'role'
      | 'locale'
      | 'active'
      | 'totpSecretEncrypted'
      | 'lastLoginAt'
    >,
    refreshToken?: string,
  ): Promise<AuthenticatedSession> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });
    const accessToken = await this.jwt.signAsync(
      {
        username: admin.username,
        role: admin.role,
        type: 'access',
      },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        subject: admin.id,
        issuer: this.config.get('JWT_ISSUER', { infer: true }),
        audience: this.config.get('JWT_AUDIENCE', { infer: true }),
        expiresIn,
      },
    );
    return {
      status: 'AUTHENTICATED',
      accessToken,
      accessTokenExpiresInSeconds: expiresIn,
      ...(refreshToken ? { refreshToken } : {}),
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        locale: admin.locale === 'RU' ? 'ru' : 'en',
        active: admin.active,
        totpEnabled: admin.totpSecretEncrypted !== null,
        lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      },
    };
  }

  private refreshExpiry(from: Date): Date {
    return new Date(
      from.getTime() +
        this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }) * 1_000,
    );
  }
}
