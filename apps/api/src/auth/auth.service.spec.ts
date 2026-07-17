import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generate } from 'otplib';
import type { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import {
  hashOpaqueToken,
  PasswordService,
  SecretEncryptionService,
  TotpService,
} from './auth-crypto';
import { AuthService } from './auth.service';

const environment: AppEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: ['http://localhost:5173'],
  LOG_LEVEL: 'silent',
  TRUST_PROXY: false,
  SWAGGER_ENABLED: false,
  JWT_ACCESS_SECRET: 'jwt-test-key-which-is-longer-than-thirty-two-bytes',
  JWT_ACCESS_TTL_SECONDS: 300,
  JWT_ISSUER: 'overvpn-test',
  JWT_AUDIENCE: 'overvpn-test-admin',
  REFRESH_TOKEN_TTL_SECONDS: 3_600,
  SECRETS_MASTER_KEY: '22'.repeat(32),
  TOTP_ISSUER: 'OverVPN Test',
  AUTH_COOKIE_NAME: 'test_refresh',
  AUTH_COOKIE_SECURE: false,
  AUTH_COOKIE_SAME_SITE: 'strict',
  AUTH_COOKIE_PATH: '/api/admin/auth',
  LOGIN_THROTTLE_LIMIT: 5,
  LOGIN_THROTTLE_TTL_MS: 60_000,
  SUB_PUBLIC_BASE_URL: 'http://localhost:3000',
  SUB_PROFILE_UPDATE_INTERVAL_HOURS: 6,
  SUB_RATE_LIMIT_IP_LIMIT: 60,
  SUB_RATE_LIMIT_TOKEN_LIMIT: 120,
  SUB_RATE_LIMIT_WINDOW_SECONDS: 60,
  SING_BOX_BINARY_PATH: 'sing-box',
  SING_BOX_CONFIG_PATH: '/tmp/sing-box/config.json',
  SING_BOX_LAST_KNOWN_GOOD_PATH: '/tmp/sing-box/config.lkg.json',
  SING_BOX_RELOAD_REQUEST_PATH: '/tmp/sing-box/reload/request',
  SING_BOX_RELOAD_ACK_PATH: '/tmp/sing-box/reload/ack',
  SING_BOX_CLASH_API_URL: 'http://127.0.0.1:9090',
  SING_BOX_CLASH_API_LISTEN: '127.0.0.1:9090',
  SING_BOX_CLASH_API_SECRET: 'test-clash-secret-which-is-at-least-32-bytes',
  SING_BOX_V2RAY_API_LISTEN: '127.0.0.1:8080',
  SING_BOX_V2RAY_API_ADDRESS: '127.0.0.1:8080',
  SING_BOX_PROCESS_TIMEOUT_MS: 15_000,
  SING_BOX_RELOAD_TIMEOUT_MS: 20_000,
  SING_BOX_HEALTH_TIMEOUT_MS: 5_000,
  XRAY_BINARY_PATH: 'xray',
  XRAY_CONFIG_PATH: '/var/lib/xray/config.json',
  XRAY_LAST_KNOWN_GOOD_PATH: '/var/lib/xray/config.last-known-good.json',
  XRAY_RELOAD_REQUEST_PATH: '/var/lib/overvpn/xray-reload/request',
  XRAY_RELOAD_ACK_PATH: '/var/lib/overvpn/xray-reload/ack',
  XRAY_STATS_ADDRESS: '127.0.0.1:10085',
  XRAY_API_LISTEN: '127.0.0.1:10085',
  XRAY_LISTEN_PORT: 8443,
  XRAY_GRPC_PORT: 8446,
  XRAY_TCP_TLS_PORT: 8447,
  XRAY_PROCESS_TIMEOUT_MS: 15_000,
  XRAY_RELOAD_TIMEOUT_MS: 20_000,
  XRAY_HEALTH_TIMEOUT_MS: 5_000,
  MTPROXY_ENABLED: true,
  MTPROXY_CONFIG_PATH: '/tmp/mtproxy/config.json',
  MTPROXY_LAST_KNOWN_GOOD_PATH: '/tmp/mtproxy/config.lkg.json',
  MTPROXY_RELOAD_REQUEST_PATH: '/tmp/mtproxy/reload/request',
  MTPROXY_RELOAD_ACK_PATH: '/tmp/mtproxy/reload/ack',
  MTPROXY_PID_PATH: '/tmp/mtproxy/reload/mtproxy.pid',
  MTPROXY_HEARTBEAT_PATH: '/tmp/mtproxy/reload/heartbeat',
  MTPROXY_HEARTBEAT_MAX_AGE_SECONDS: 15,
  MTPROXY_RUNTIME_STATS_PATH: '/tmp/mtproxy/reload/runtime-stats.json',
  MTPROXY_RUNTIME_STATS_MAX_AGE_SECONDS: 30,
  MTPROXY_API_PORT_BASE: 19_000,
  MTPROXY_PORT_MIN: 10_001,
  MTPROXY_PORT_MAX: 10_016,
  MTPROXY_PROCESS_TIMEOUT_MS: 15_000,
  MTPROXY_RELOAD_TIMEOUT_MS: 20_000,
  MTPROXY_HEALTH_TIMEOUT_MS: 5_000,
  SING_BOX_UDP_PORT: 443,
  SING_BOX_TCP_PORT: 4443,
  SING_BOX_TROJAN_PORT: 8444,
  SING_BOX_SS_PORT: 8445,
  SING_BOX_ACME_HTTP_PORT: 80,
  SING_BOX_ACME_TLS_PORT: 443,
  CORE_APPLY_LOCK_TTL_MS: 60_000,
  WORKERS_ENABLED: false,
  WORKER_LOCK_TTL_MS: 60_000,
  TRAFFIC_COLLECTION_INTERVAL_MS: 15_000,
  TRAFFIC_AGGREGATION_INTERVAL_MS: 60_000,
  TRAFFIC_AGGREGATION_BATCH_SIZE: 1_000,
  TRAFFIC_LEDGER_RETENTION_DAYS: 90,
  ONLINE_COLLECTION_INTERVAL_MS: 15_000,
  ONLINE_SWEEP_INTERVAL_MS: 30_000,
  ONLINE_SESSION_TIMEOUT_MS: 90_000,
  ONLINE_SESSION_RETENTION_DAYS: 30,
  HOST_PROC: '/proc',
  ENFORCEMENT_INTERVAL_MS: 30_000,
  IDENTITY_LOOKBACK_MS: 1_800_000,
  IDENTITY_LIMIT_HOLD_MS: 900_000,
  UPDATE_CHECK_ENABLED: true,
  UPDATE_CHECK_INTERVAL_MS: 21_600_000,
  UPDATE_CHECK_REPO: 'Overl1te/OverVPN',
  UPDATE_CHECK_REF: 'master',
  UPDATE_CHECK_TIMEOUT_MS: 10_000,
  TELEGRAM_ENABLED: false,
  TELEGRAM_TIMEOUT_MS: 5_000,
  BACKUP_DIR: '/var/lib/overvpn/backups',
  BACKUP_RETENTION_DAYS: 30,
  BACKUP_ENCRYPT: true,
  BACKUP_PROCESS_TIMEOUT_MS: 600_000,
};

type StoredToken = {
  id: string;
  adminUserId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
  replacedByTokenId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

describe('AuthService', () => {
  const metadata = {
    requestId: '2be0a62e-23bd-4e8c-b3ec-927f310647d2',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };
  let admin: {
    id: string;
    username: string;
    passwordHash: string;
    role: 'OWNER';
    locale: 'EN';
    active: boolean;
    pendingTotpSecretEncrypted: string | null;
    totpSecretEncrypted: string | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  let tokens: StoredToken[];
  let prisma: PrismaService;
  let audit: jest.Mocked<Pick<AuditService, 'record' | 'recordFailureSafely'>>;
  let service: AuthService;
  let jwt: JwtService;
  let encryption: SecretEncryptionService;

  beforeEach(async () => {
    const passwords = new PasswordService();
    admin = {
      id: randomUUID(),
      username: 'owner',
      passwordHash: await passwords.hash('test-password-long-enough'),
      role: 'OWNER',
      locale: 'EN',
      active: true,
      pendingTotpSecretEncrypted: null,
      totpSecretEncrypted: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    tokens = [];
    const tokenDelegate = {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const token: StoredToken = {
          id: randomUUID(),
          adminUserId: data.adminUserId as string,
          tokenHash: data.tokenHash as string,
          familyId: data.familyId as string,
          expiresAt: data.expiresAt as Date,
          revokedAt: null,
          revocationReason: null,
          replacedByTokenId: null,
          ipAddress: (data.ipAddress as string | null) ?? null,
          userAgent: (data.userAgent as string | null) ?? null,
        };
        tokens.push(token);
        return Promise.resolve(token);
      }),
      findUnique: jest.fn(
        ({
          where,
          include,
        }: {
          where: { tokenHash?: string; id?: string };
          include?: unknown;
        }) => {
          const token = tokens.find(
            (item) =>
              item.tokenHash === where.tokenHash || item.id === where.id,
          );
          return Promise.resolve(
            token && include
              ? { ...token, adminUser: { ...admin } }
              : (token ?? null),
          );
        },
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<StoredToken>;
        }) => {
          const token = tokens.find((item) => item.id === where.id)!;
          Object.assign(token, data);
          return Promise.resolve(token);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<StoredToken>;
        }) => {
          let count = 0;
          for (const token of tokens) {
            const matches =
              (where.id === undefined || token.id === where.id) &&
              (where.familyId === undefined ||
                token.familyId === where.familyId) &&
              (where.adminUserId === undefined ||
                token.adminUserId === where.adminUserId) &&
              (where.revokedAt !== null || token.revokedAt === null) &&
              (where.replacedByTokenId !== null ||
                token.replacedByTokenId === null) &&
              (!where.expiresAt ||
                token.expiresAt > (where.expiresAt as { gt: Date }).gt);
            if (matches) {
              Object.assign(token, data);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    };
    const adminDelegate = {
      findUnique: jest.fn(
        ({ where }: { where: { id?: string; username?: string } }) =>
          Promise.resolve(
            where.id === admin.id || where.username === admin.username
              ? { ...admin }
              : null,
          ),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<typeof admin>;
        }) => {
          expect(where.id).toBe(admin.id);
          Object.assign(admin, data);
          return Promise.resolve({ ...admin });
        },
      ),
    };
    type AuthPrismaMock = {
      adminUser: typeof adminDelegate;
      refreshToken: typeof tokenDelegate;
      $transaction: (
        operation: (tx: AuthPrismaMock) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    const prismaMock: AuthPrismaMock = {
      adminUser: adminDelegate,
      refreshToken: tokenDelegate,
      $transaction: jest.fn(
        async (operation: (tx: AuthPrismaMock) => Promise<unknown>) =>
          await operation(prismaMock),
      ),
    };
    prisma = prismaMock as unknown as PrismaService;
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
      recordFailureSafely: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: (key: keyof AppEnvironment) => environment[key],
    } as ConfigService<AppEnvironment, true>;
    jwt = new JwtService();
    encryption = new SecretEncryptionService(config);
    service = new AuthService(
      prisma,
      config,
      jwt,
      passwords,
      encryption,
      new TotpService(config),
      audit as unknown as AuditService,
    );
  });

  it('authenticates with a password, updates last login, and signs a JWT', async () => {
    const result = await service.login(
      {
        username: 'owner',
        password: 'test-password-long-enough',
        returnRefreshToken: true,
      },
      metadata,
    );

    expect(result.response.status).toBe('AUTHENTICATED');
    if (result.response.status !== 'AUTHENTICATED') {
      throw new Error('Expected an authenticated response');
    }
    const claims = await jwt.verifyAsync<{
      sub: string;
      role: string;
      type: string;
    }>(result.response.accessToken, {
      secret: environment.JWT_ACCESS_SECRET,
      issuer: environment.JWT_ISSUER,
      audience: environment.JWT_AUDIENCE,
    });
    expect(claims).toMatchObject({
      sub: admin.id,
      role: 'OWNER',
      type: 'access',
    });
    expect(admin.lastLoginAt).toBeInstanceOf(Date);
    expect(result.refreshToken).toBeDefined();
    expect(tokens[0]?.tokenHash).toBe(hashOpaqueToken(result.refreshToken!));
    expect(tokens[0]?.tokenHash).not.toBe(result.refreshToken);
  });

  it('rotates refresh tokens, revokes a reused family, and revokes logout', async () => {
    const login = await service.login(
      {
        username: 'owner',
        password: 'test-password-long-enough',
        returnRefreshToken: true,
      },
      metadata,
    );
    const firstToken = login.refreshToken!;
    const refreshed = await service.refresh(firstToken, true, metadata);
    const secondToken = refreshed.refreshToken!;

    expect(secondToken).not.toBe(firstToken);
    expect(tokens[0]?.revokedAt).toBeInstanceOf(Date);
    expect(tokens[0]?.revocationReason).toBe('rotated');
    expect(tokens[0]?.replacedByTokenId).toBe(tokens[1]?.id);
    await expect(
      service.refresh(firstToken, true, metadata),
    ).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSED',
    });
    const reusedFamily = tokens.filter(
      (token) => token.familyId === tokens[0]?.familyId,
    );
    expect(reusedFamily.every((token) => token.revokedAt instanceof Date)).toBe(
      true,
    );

    const nextLogin = await service.login(
      {
        username: 'owner',
        password: 'test-password-long-enough',
        returnRefreshToken: true,
      },
      metadata,
    );
    const logoutToken = nextLogin.refreshToken!;
    await service.logout(
      {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        locale: 'en',
        active: true,
        totpEnabled: false,
        lastLoginAt: admin.lastLoginAt,
      },
      logoutToken,
      metadata,
    );
    const storedLogoutToken = tokens.find(
      (token) => token.tokenHash === hashOpaqueToken(logoutToken),
    );
    expect(storedLogoutToken?.revokedAt).toBeInstanceOf(Date);
    expect(storedLogoutToken?.revocationReason).toBe('logout');
    await expect(
      service.refresh(logoutToken, true, metadata),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it('requires confirmation before enabling TOTP and can disable it securely', async () => {
    const setup = await service.enableTotp(
      {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        locale: 'en',
        active: true,
        totpEnabled: false,
        lastLoginAt: null,
      },
      { currentPassword: 'test-password-long-enough' },
      metadata,
    );
    expect(admin.totpSecretEncrypted).toBeNull();
    expect(admin.pendingTotpSecretEncrypted).not.toBeNull();
    expect(encryption.decrypt(admin.pendingTotpSecretEncrypted!)).toBe(
      setup.secret,
    );

    const code = await generate({ secret: setup.secret });
    await service.confirmTotp(
      {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        locale: 'en',
        active: true,
        totpEnabled: false,
        lastLoginAt: null,
      },
      code,
      metadata,
    );
    expect(admin.pendingTotpSecretEncrypted).toBeNull();
    expect(admin.totpSecretEncrypted).not.toBeNull();

    const challenge = await service.login(
      {
        username: 'owner',
        password: 'test-password-long-enough',
        returnRefreshToken: false,
      },
      metadata,
    );
    expect(challenge.response.status).toBe('TOTP_REQUIRED');
    const authenticated = await service.login(
      {
        username: 'owner',
        password: 'test-password-long-enough',
        totpCode: code,
        returnRefreshToken: false,
      },
      metadata,
    );
    expect(authenticated.response.status).toBe('AUTHENTICATED');

    await service.disableTotp(
      {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        locale: 'en',
        active: true,
        totpEnabled: true,
        lastLoginAt: admin.lastLoginAt,
      },
      {
        currentPassword: 'test-password-long-enough',
        totpCode: code,
      },
      metadata,
    );
    expect(admin.totpSecretEncrypted).toBeNull();
  });
});
