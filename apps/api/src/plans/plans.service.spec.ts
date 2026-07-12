import { createPlanSchema } from '@overvpn/shared/schemas';
import type { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import { PlansService } from './plans.service';

describe('plan validation', () => {
  it('rejects invalid limits and normalizes duplicate inbound IDs', () => {
    expect(
      createPlanSchema.safeParse({
        name: 'Broken',
        defaultDataLimitBytes: '-1',
      }).success,
    ).toBe(false);
    expect(
      createPlanSchema.safeParse({
        name: 'Broken',
        defaultDeviceLimit: 0,
      }).success,
    ).toBe(false);

    const inboundId = 'f7894700-7414-48a5-a80d-ad5eb9e8a166';
    const result = createPlanSchema.parse({
      name: 'Valid',
      inboundIds: [inboundId, inboundId],
    });
    expect(result.inboundIds).toEqual([inboundId]);
  });

  it('validates every inbound ID inside the create transaction', async () => {
    const existingId = 'f7894700-7414-48a5-a80d-ad5eb9e8a166';
    const missingId = '0cb849dc-ee15-409d-8ebd-a5c9a2854b55';
    const planCreate = jest.fn();
    const inboundDelegate = {
      findMany: jest.fn().mockResolvedValue([{ id: existingId }]),
    };
    const planDelegate = { create: planCreate };
    type PlanPrismaMock = {
      inbound: typeof inboundDelegate;
      plan: typeof planDelegate;
      $transaction: (
        operation: (tx: PlanPrismaMock) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    const prismaMock: PlanPrismaMock = {
      inbound: inboundDelegate,
      plan: planDelegate,
      $transaction: jest.fn(
        async (operation: (tx: PlanPrismaMock) => Promise<unknown>) =>
          await operation(prismaMock),
      ),
    };
    const audit = {
      record: jest.fn(),
      recordFailureSafely: jest.fn().mockResolvedValue(undefined),
    };
    const core = { recordPending: jest.fn() };
    const service = new PlansService(
      prismaMock as unknown as PrismaService,
      audit as unknown as AuditService,
      core,
    );

    await expect(
      service.create(
        {
          name: 'Plan',
          inboundIds: [existingId, missingId],
        },
        {
          id: 'a0f6395d-0739-473d-b0e5-3f9bdc69a173',
          username: 'admin',
          role: 'ADMIN',
          locale: 'en',
          active: true,
          totpEnabled: false,
          lastLoginAt: null,
        },
        {
          requestId: '01ae5a83-68fc-4376-94e9-4a8abfa2aa4e',
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        },
      ),
    ).rejects.toMatchObject<Partial<ApiException>>({
      code: 'NOT_FOUND',
      details: { resource: 'inbound', missingIds: [missingId] },
    });
    expect(planCreate).not.toHaveBeenCalled();
    expect(audit.recordFailureSafely).toHaveBeenCalled();
  });
});
