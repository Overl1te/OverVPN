import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import type { AppEnvironment } from '../config/environment';
import type { User } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import type { SubscriptionProfileBuilder } from './subscription-profile';
import { SubscriptionsService } from './subscriptions.service';
import { UsersService } from '../users/users.service';

const OLD_TOKEN = Buffer.alloc(32, 3).toString('base64url');

describe('subscription token rotation', () => {
  const actor = {
    id: 'a0f6395d-0739-473d-b0e5-3f9bdc69a173',
    username: 'admin',
    role: 'ADMIN' as const,
    locale: 'en' as const,
    active: true,
    totpEnabled: false,
    lastLoginAt: null,
  };
  const metadata = {
    requestId: '01ae5a83-68fc-4376-94e9-4a8abfa2aa4e',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };

  it('invalidates the old URL immediately, enables the new URL, and audits without core apply', async () => {
    const user = storedUser();
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
      recordFailureSafely: jest.fn().mockResolvedValue(undefined),
    };
    const core = { recordPending: jest.fn().mockResolvedValue(undefined) };
    const prisma = createPrisma(user);
    const users = new UsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      core,
      {
        planInboundIds: jest.fn().mockResolvedValue([]),
        syncUserToInboundIds: jest.fn().mockResolvedValue(undefined),
        syncAllUsersOnPlan: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
    const subscriptions = new SubscriptionsService(
      prisma as unknown as PrismaService,
      profileBuilder(),
      config(),
    );

    await expect(subscriptions.profile(OLD_TOKEN)).resolves.toMatchObject({
      kind: 'ready',
    });

    const rotated = await users.rotateSubscription(user.id, actor, metadata);
    const newToken = rotated.subToken;

    await expect(subscriptions.profile(OLD_TOKEN)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_NOT_FOUND',
    });
    await expect(subscriptions.profile(newToken)).resolves.toMatchObject({
      kind: 'ready',
    });
    expect(newToken).not.toBe(OLD_TOKEN);
    expect(newToken).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
    expect(rotated).toMatchObject({
      needsApply: false,
    });
    expect(user.revision).toBe(7);
    expect(core.recordPending).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_ROTATE_SUB',
        resourceType: 'user',
        resourceId: user.id,
      }),
      expect.anything(),
    );
  });

  it('retries a unique-token collision transactionally', async () => {
    const user = storedUser();
    let updates = 0;
    const prisma = createPrisma(user, () => {
      updates += 1;
      if (updates === 1) {
        return Promise.reject(
          Object.assign(new Error('simulated subscription token collision'), {
            code: 'P2002',
            meta: { target: ['subToken'] },
          }),
        );
      }
      return undefined;
    });
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
      recordFailureSafely: jest.fn().mockResolvedValue(undefined),
    };
    const users = new UsersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      { recordPending: jest.fn() },
      {
        planInboundIds: jest.fn().mockResolvedValue([]),
        syncUserToInboundIds: jest.fn().mockResolvedValue(undefined),
        syncAllUsersOnPlan: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    const result = await users.rotateSubscription(user.id, actor, metadata);

    expect(updates).toBe(2);
    expect(result.subToken).not.toBe(OLD_TOKEN);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.recordFailureSafely).not.toHaveBeenCalled();
  });
});

function createPrisma(
  user: User,
  beforeUpdate?: () => Promise<never> | undefined,
): RotationPrismaMock {
  const prisma: RotationPrismaMock = {
    user: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ ...user })),
      findUnique: jest.fn(({ where }: { where: { subToken: string } }) =>
        Promise.resolve(
          where.subToken === user.subToken
            ? {
                id: user.id,
                identity: user.identity,
                username: user.username,
                status: user.status,
                statusReason: user.statusReason,
                expireAt: user.expireAt,
                dataLimitBytes: user.dataLimitBytes,
                usedUploadBytes: user.usedUploadBytes,
                usedDownloadBytes: user.usedDownloadBytes,
                deletedAt: user.deletedAt,
                inboundAssignments: [],
              }
            : null,
        ),
      ),
      update: jest.fn(async ({ data }: { data: { subToken?: string } }) => {
        const rejected = beforeUpdate?.();
        if (rejected) {
          await rejected;
        }
        if (data.subToken) {
          user.subToken = data.subToken;
        }
        user.updatedAt = new Date();
        return { ...user };
      }),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(
      async (operation: (tx: RotationPrismaMock) => Promise<unknown>) =>
        await operation(prisma),
    ),
  };
  return prisma;
}

interface RotationPrismaMock {
  user: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

function profileBuilder(): SubscriptionProfileBuilder {
  return {
    build: jest.fn(() => ({
      title: 'OverVPN - alice',
      identity: 'alice',
      username: 'alice',
      endpoints: [
        {
          protocol: 'HYSTERIA2',
          tag: 'hy2-edge',
          displayName: 'alice - edge',
          server: 'vpn.example.com',
          port: 443,
          password: 'required-client-password',
          tls: {
            serverName: 'vpn.example.com',
            insecure: false,
            alpn: ['h3'],
          },
          obfs: null,
          bandwidth: { upMbps: 100, downMbps: 100 },
        },
      ],
    })),
  } as unknown as SubscriptionProfileBuilder;
}

function config(): ConfigService<AppEnvironment, true> {
  return {
    get: (key: keyof AppEnvironment) => {
      if (key === 'SUB_PUBLIC_BASE_URL') return 'https://vpn.example.com';
      if (key === 'SUB_PROFILE_UPDATE_INTERVAL_HOURS') return 6;
      throw new Error(`Unexpected config key ${key}`);
    },
  } as unknown as ConfigService<AppEnvironment, true>;
}

function storedUser(): User {
  return {
    id: 'b39a23c8-a0cc-49ca-8c2e-d2aad2814383',
    identity: 'alice',
    username: 'alice',
    status: 'ACTIVE',
    statusReason: null,
    note: null,
    tags: [],
    expireAt: null,
    dataLimitBytes: null,
    usedUploadBytes: 10n,
    usedDownloadBytes: 20n,
    accountingEpoch: 0,
    trafficResetAt: null,
    resetStrategy: 'NO_RESET',
    nextResetAt: null,
    deviceLimit: null,
    ipLimit: null,
    speedLimitBps: null,
    subToken: OLD_TOKEN,
    planId: null,
    needsApply: false,
    revision: 7,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    disabledAt: null,
    deletedAt: null,
  };
}
