import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infrastructure/infrastructure.module';

type CoreApplyClient = Pick<PrismaService, 'coreApplyRecord'>;

export interface PendingCoreChange {
  actorAdminId: string;
  resourceType: 'user' | 'plan';
  resourceId: string;
  operation: string;
  metadata?: Record<string, string | number | boolean | null>;
}

@Injectable()
export abstract class CoreChangeDispatcher {
  abstract recordPending(
    change: PendingCoreChange,
    client?: CoreApplyClient,
  ): Promise<void>;
}

@Injectable()
export class DurableCoreChangeDispatcher extends CoreChangeDispatcher {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async recordPending(
    change: PendingCoreChange,
    client: CoreApplyClient = this.prisma,
  ): Promise<void> {
    await client.coreApplyRecord.create({
      data: {
        status: 'PENDING',
        trigger: 'MANUAL',
        initiatedByAdminId: change.actorAdminId,
        resourceType: change.resourceType,
        resourceId: change.resourceId,
        operation: change.operation,
        metadata: change.metadata,
      },
    });
  }
}
