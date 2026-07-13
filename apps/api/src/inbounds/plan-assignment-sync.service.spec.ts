import type { ConfigService } from '@nestjs/config';
import type { SecretEncryptionService } from '../auth/auth-crypto';
import type { Prisma } from '../generated/prisma/client';
import { PlanAssignmentSyncService } from './plan-assignment-sync.service';

describe('PlanAssignmentSyncService', () => {
  const encryption = {
    encrypt: jest.fn((value: string) => `v1:${value}`),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'SING_BOX_CONFIG_PATH' ? '/tmp/sing-box.json' : '/tmp/xray.json',
    ),
  };

  it('creates missing assignments and disables extras for a user', async () => {
    const keepId = '11111111-1111-4111-8111-111111111111';
    const dropId = '22222222-2222-4222-8222-222222222222';
    const userId = '33333333-3333-4333-8333-333333333333';
    const assignmentUpdates: unknown[] = [];
    const assignmentCreates: unknown[] = [];
    const tx = {
      userInboundAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            userId,
            inboundId: dropId,
            status: 'ACTIVE',
          },
        ]),
        update: jest.fn((args: unknown) => {
          assignmentUpdates.push(args);
          return Promise.resolve(args);
        }),
        create: jest.fn((args: unknown) => {
          assignmentCreates.push(args);
          return Promise.resolve(args);
        }),
      },
      inbound: {
        findUnique: jest.fn().mockResolvedValue({
          id: keepId,
          protocol: 'HYSTERIA2',
          engine: 'SING_BOX',
        }),
        update: jest.fn().mockResolvedValue({ engine: 'SING_BOX' }),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
      },
      coreState: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const service = new PlanAssignmentSyncService(
      encryption as unknown as SecretEncryptionService,
      config as unknown as ConfigService,
    );

    await service.syncUserToInboundIds(
      tx as unknown as Prisma.TransactionClient,
      userId,
      [keepId],
    );

    expect(assignmentUpdates[0]).toMatchObject({
      where: { id: 'a1' },
      data: { status: 'DISABLED' },
    });
    expect(assignmentCreates).toHaveLength(1);
    expect(assignmentCreates[0]).toMatchObject({
      data: {
        inboundId: keepId,
        userId,
        status: 'ACTIVE',
      },
    });
    expect(encryption.encrypt).toHaveBeenCalled();
    expect(tx.coreState.upsert).toHaveBeenCalled();
  });

  it('loads plan inbound ids in priority order', async () => {
    const tx = {
      planInbound: {
        findMany: jest.fn().mockResolvedValue([
          { inboundId: 'b' },
          { inboundId: 'a' },
        ]),
      },
    };
    const service = new PlanAssignmentSyncService(
      encryption as unknown as SecretEncryptionService,
      config as unknown as ConfigService,
    );
    await expect(
      service.planInboundIds(tx as unknown as Prisma.TransactionClient, 'plan'),
    ).resolves.toEqual(['b', 'a']);
  });
});
