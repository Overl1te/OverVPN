import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedAdmin } from '../common/authorization';
import type { AppEnvironment } from '../config/environment';
import type { Plan, User } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import { UsersService } from './users.service';

describe('UsersService bulk actions', () => {
  const actor: AuthenticatedAdmin = {
    id: 'a0f6395d-0739-473d-b0e5-3f9bdc69a173',
    username: 'admin',
    role: 'ADMIN',
    locale: 'en',
    active: true,
    totpEnabled: false,
    lastLoginAt: null,
  };
  const metadata = {
    requestId: '01ae5a83-68fc-4376-94e9-4a8abfa2aa4e',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };
  let user: User;
  let plan: Plan;
  let service: UsersService;
  let core: { recordPending: jest.Mock };
  let audit: { record: jest.Mock; recordFailureSafely: jest.Mock };

  beforeEach(() => {
    user = {
      id: 'b39a23c8-a0cc-49ca-8c2e-d2aad2814383',
      identity: 'alice',
      username: 'alice',
      status: 'LIMITED',
      statusReason: 'quota',
      note: null,
      tags: [],
      expireAt: null,
      dataLimitBytes: 100n,
      usedUploadBytes: 40n,
      usedDownloadBytes: 60n,
      accountingEpoch: 0,
      trafficResetAt: null,
      resetStrategy: 'MONTHLY',
      nextResetAt: null,
      deviceLimit: 1,
      ipLimit: 1,
      identityLimitHoldUntil: null,
      speedLimitBps: null,
      subToken: 'old-subscription-token',
      planId: null,
      needsApply: false,
      revision: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      disabledAt: null,
      deletedAt: null,
    };
    plan = {
      id: '233ce9df-e4ab-46b5-9988-f021ecac6536',
      name: 'Pro',
      description: null,
      status: 'ACTIVE',
      defaultDataLimitBytes: 1_000n,
      defaultExpiryDays: 30,
      defaultDeviceLimit: 3,
      defaultIpLimit: 2,
      defaultSpeedLimitBps: 50_000_000n,
      defaultResetStrategy: 'MONTHLY',
      subscriptionTitleTemplate: null,
      subscriptionAnnounce: null,
      subscriptionSupportUrl: null,
      subscriptionWebPageUrl: null,
      happProviderId: null,
      subscriptionSubInfoText: null,
      subscriptionSubInfoColor: null,
      subscriptionSubInfoButtonText: null,
      subscriptionSubInfoButtonLink: null,
      subscriptionSubExpireEnabled: false,
      subscriptionSubExpireButtonLink: null,
      subscriptionFallbackUrlTemplate: null,
      subscriptionColorProfile: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
    const userDelegate = {
      findMany: jest.fn(() =>
        Promise.resolve([{ ...user, tags: [...user.tags] }]),
      ),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(
        ({
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const { plan: relation, ...scalars } = data;
          for (const [key, value] of Object.entries(scalars)) {
            if (
              value &&
              typeof value === 'object' &&
              'increment' in value &&
              typeof value.increment === 'number'
            ) {
              const current = user[key as keyof User];
              if (typeof current === 'number') {
                (user as unknown as Record<string, unknown>)[key] =
                  current + value.increment;
              }
            } else {
              (user as unknown as Record<string, unknown>)[key] = value;
            }
          }
          user.updatedAt = new Date();
          if (relation && typeof relation === 'object') {
            const value = relation as {
              connect?: { id: string };
              disconnect?: boolean;
            };
            user.planId = value.connect?.id ?? null;
          }
          return Promise.resolve({ ...user, tags: [...user.tags] });
        },
      ),
    };
    const planDelegate = {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === plan.id ? plan : null),
      ),
    };
    type UserPrismaMock = {
      user: typeof userDelegate;
      plan: typeof planDelegate;
      coreApplyRecord: { create: jest.Mock };
      auditLog: { create: jest.Mock };
      $transaction: (
        operation: (tx: UserPrismaMock) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    const prismaMock: UserPrismaMock = {
      user: userDelegate,
      plan: planDelegate,
      coreApplyRecord: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(
        async (operation: (tx: UserPrismaMock) => Promise<unknown>) =>
          await operation(prismaMock),
      ),
    };
    core = { recordPending: jest.fn().mockResolvedValue(undefined) };
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
      recordFailureSafely: jest.fn().mockResolvedValue(undefined),
    };
    const configValues = {
      IDENTITY_LOOKBACK_MS: 1_800_000,
      ONLINE_SESSION_TIMEOUT_MS: 90_000,
    } satisfies Partial<AppEnvironment>;
    const config = {
      get: (key: keyof AppEnvironment) =>
        configValues[key as keyof typeof configValues],
    } as ConfigService<AppEnvironment, true>;
    service = new UsersService(
      prismaMock as unknown as PrismaService,
      audit as unknown as AuditService,
      core,
      {
        planInboundIds: jest.fn().mockResolvedValue([]),
        syncUserToInboundIds: jest.fn().mockResolvedValue(undefined),
        syncAllUsersOnPlan: jest.fn().mockResolvedValue(undefined),
      } as never,
      config,
    );
  });

  it('resets traffic and deterministically removes a quota limitation', async () => {
    const result = await service.bulk(
      { action: 'reset-traffic', userIds: [user.id] },
      actor,
      metadata,
    );

    expect(result.affected).toBe(1);
    expect(result.users[0]).toMatchObject({
      status: 'ACTIVE',
      statusReason: null,
      usedUploadBytes: '0',
      usedDownloadBytes: '0',
      accountingEpoch: 1,
      needsApply: true,
    });
    expect(core.recordPending).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'reset-traffic' }),
      expect.anything(),
    );
  });

  it('handles disable, enable, extend, plan assignment, and token rotation', async () => {
    await service.bulk(
      { action: 'reset-traffic', userIds: [user.id] },
      actor,
      metadata,
    );
    await service.bulk(
      { action: 'disable', userIds: [user.id] },
      actor,
      metadata,
    );
    expect(user).toMatchObject({ status: 'DISABLED', statusReason: 'manual' });

    await service.bulk(
      { action: 'enable', userIds: [user.id] },
      actor,
      metadata,
    );
    expect(user).toMatchObject({ status: 'ACTIVE', statusReason: null });

    user.expireAt = new Date('2020-01-01T00:00:00.000Z');
    await service.bulk(
      { action: 'extend', userIds: [user.id], days: 7 },
      actor,
      metadata,
    );
    expect(user.status).toBe('ACTIVE');
    expect(user.expireAt.getTime()).toBeGreaterThan(Date.now());

    await service.bulk(
      { action: 'set-plan', userIds: [user.id], planId: plan.id },
      actor,
      metadata,
    );
    expect(user).toMatchObject({
      planId: plan.id,
      dataLimitBytes: 1_000n,
      deviceLimit: 3,
      ipLimit: null,
      speedLimitBps: 50_000_000n,
    });

    const previousToken = user.subToken;
    await service.bulk(
      { action: 'rotate-sub', userIds: [user.id] },
      actor,
      metadata,
    );
    expect(user.subToken).not.toBe(previousToken);
    expect(user.subToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(audit.record).toHaveBeenCalledTimes(6);
  });

  it('rotates bulk subscription tokens without scheduling a core apply', async () => {
    user.needsApply = false;
    user.revision = 9;
    const previousToken = user.subToken;

    const result = await service.bulk(
      { action: 'rotate-sub', userIds: [user.id] },
      actor,
      metadata,
    );

    expect(result.users[0]?.subToken).not.toBe(previousToken);
    expect(result.users[0]).toMatchObject({
      needsApply: false,
    });
    expect(user.revision).toBe(9);
    expect(core.recordPending).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_ROTATE_SUB' }),
      expect.anything(),
    );
  });
});
