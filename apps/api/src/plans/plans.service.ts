import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  CreatePlan,
  PlanListQuery,
  PlanResult,
  UpdatePlan,
} from '@overvpn/shared/schemas';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import { CoreChangeDispatcher } from '../core/core-change-dispatcher';
import type { Plan, Prisma } from '../generated/prisma/client';
import { PlanAssignmentSyncService } from '../inbounds/plan-assignment-sync.service';
import { PrismaService } from '../infrastructure/infrastructure.module';

type PlanWithRelations = Plan & {
  planInbounds: Array<{ inboundId: string }>;
  _count: { users: number };
};

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coreChanges: CoreChangeDispatcher,
    private readonly planAssignments: PlanAssignmentSyncService,
  ) {}

  async list(query: PlanListQuery): Promise<{
    items: PlanResult[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const where: Prisma.PlanWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [total, plans] = await this.prisma.$transaction([
      this.prisma.plan.count({ where }),
      this.prisma.plan.findMany({
        where,
        include: {
          planInbounds: {
            select: { inboundId: true },
            orderBy: [{ priority: 'asc' }, { inboundId: 'asc' }],
          },
          _count: { select: { users: { where: { deletedAt: null } } } },
        },
        orderBy: [{ name: query.sortOrder }, { id: query.sortOrder }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: plans.map((plan) => this.toResult(plan)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async get(id: string): Promise<PlanResult> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        planInbounds: {
          select: { inboundId: true },
          orderBy: [{ priority: 'asc' }, { inboundId: 'asc' }],
        },
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    });
    if (!plan) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toResult(plan);
  }

  async create(
    input: CreatePlan,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<PlanResult> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await this.validateInbounds(tx, input.inboundIds);
        const plan = await tx.plan.create({
          data: {
            name: input.name,
            description: input.description,
            defaultDataLimitBytes: this.toBigInt(input.defaultDataLimitBytes),
            defaultExpiryDays: input.defaultExpiryDays,
            defaultDeviceLimit: input.defaultDeviceLimit,
            defaultIpLimit: input.defaultIpLimit,
            defaultSpeedLimitBps: this.toBigInt(input.defaultSpeedLimitBps),
            defaultResetStrategy: input.defaultResetStrategy,
            subscriptionTitleTemplate: input.subscriptionTitleTemplate ?? null,
            subscriptionAnnounce: input.subscriptionAnnounce ?? null,
            subscriptionSupportUrl: input.subscriptionSupportUrl ?? null,
            subscriptionWebPageUrl: input.subscriptionWebPageUrl ?? null,
            planInbounds: {
              create: input.inboundIds.map((inboundId, priority) => ({
                inboundId,
                priority,
              })),
            },
          },
        });
        await this.coreChanges.recordPending(
          {
            actorAdminId: actor.id,
            resourceType: 'plan',
            resourceId: plan.id,
            operation: 'create',
          },
          tx,
        );
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'PLAN_CREATE',
            resourceType: 'plan',
            resourceId: plan.id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            after: { ...plan, inboundIds: input.inboundIds },
          },
          tx,
        );
        return plan.id;
      });
      return this.get(id);
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'PLAN_CREATE',
        resourceType: 'plan',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { error: this.errorName(error), input },
      });
      throw this.mapMutationError(error);
    }
  }

  async update(
    id: string,
    input: UpdatePlan,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<PlanResult> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.plan.findUnique({
          where: { id },
          include: { planInbounds: true },
        });
        if (!before) {
          throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
        }
        if (input.inboundIds) {
          await this.validateInbounds(tx, input.inboundIds);
        }
        const plan = await tx.plan.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description,
            defaultDataLimitBytes:
              input.defaultDataLimitBytes === undefined
                ? undefined
                : this.toBigInt(input.defaultDataLimitBytes),
            defaultExpiryDays: input.defaultExpiryDays,
            defaultDeviceLimit: input.defaultDeviceLimit,
            defaultIpLimit: input.defaultIpLimit,
            defaultSpeedLimitBps:
              input.defaultSpeedLimitBps === undefined
                ? undefined
                : this.toBigInt(input.defaultSpeedLimitBps),
            defaultResetStrategy: input.defaultResetStrategy,
            subscriptionTitleTemplate: input.subscriptionTitleTemplate,
            subscriptionAnnounce: input.subscriptionAnnounce,
            subscriptionSupportUrl: input.subscriptionSupportUrl,
            subscriptionWebPageUrl: input.subscriptionWebPageUrl,
          },
        });
        if (input.inboundIds) {
          await tx.planInbound.deleteMany({ where: { planId: id } });
          if (input.inboundIds.length > 0) {
            await tx.planInbound.createMany({
              data: input.inboundIds.map((inboundId, priority) => ({
                planId: id,
                inboundId,
                priority,
              })),
            });
          }
          await this.planAssignments.syncAllUsersOnPlan(
            tx,
            id,
            input.inboundIds,
          );
        }
        await this.coreChanges.recordPending(
          {
            actorAdminId: actor.id,
            resourceType: 'plan',
            resourceId: id,
            operation: 'update',
          },
          tx,
        );
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'PLAN_UPDATE',
            resourceType: 'plan',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before,
            after: {
              ...plan,
              inboundIds:
                input.inboundIds ??
                before.planInbounds.map((item) => item.inboundId),
            },
          },
          tx,
        );
      });
      return this.get(id);
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'PLAN_UPDATE',
        resourceType: 'plan',
        resourceId: id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { error: this.errorName(error), input },
      });
      throw this.mapMutationError(error);
    }
  }

  async archive(
    id: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<PlanResult> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.plan.findUnique({ where: { id } });
        if (!before) {
          throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
        }
        const after = await tx.plan.update({
          where: { id },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });
        await this.coreChanges.recordPending(
          {
            actorAdminId: actor.id,
            resourceType: 'plan',
            resourceId: id,
            operation: 'archive',
          },
          tx,
        );
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'PLAN_ARCHIVE',
            resourceType: 'plan',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before,
            after,
          },
          tx,
        );
      });
      return this.get(id);
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'PLAN_ARCHIVE',
        resourceType: 'plan',
        resourceId: id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { error: this.errorName(error) },
      });
      throw this.mapMutationError(error);
    }
  }

  async remove(
    id: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.plan.findUnique({
          where: { id },
          include: {
            planInbounds: true,
            _count: { select: { users: { where: { deletedAt: null } } } },
          },
        });
        if (!before) {
          throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
        }
        if (before._count.users > 0) {
          throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
            reason: 'plan_has_users',
            userCount: before._count.users,
          });
        }
        await tx.plan.delete({ where: { id } });
        await this.coreChanges.recordPending(
          {
            actorAdminId: actor.id,
            resourceType: 'plan',
            resourceId: id,
            operation: 'delete',
          },
          tx,
        );
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'PLAN_DELETE',
            resourceType: 'plan',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before,
          },
          tx,
        );
      });
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'PLAN_DELETE',
        resourceType: 'plan',
        resourceId: id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { error: this.errorName(error) },
      });
      throw this.mapMutationError(error);
    }
  }

  private async validateInbounds(
    tx: Prisma.TransactionClient,
    inboundIds: string[],
  ): Promise<void> {
    if (inboundIds.length === 0) {
      return;
    }
    const found = await tx.inbound.findMany({
      where: { id: { in: inboundIds } },
      select: { id: true },
    });
    if (found.length !== inboundIds.length) {
      const foundIds = new Set(found.map((inbound) => inbound.id));
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
        resource: 'inbound',
        missingIds: inboundIds.filter((id) => !foundIds.has(id)),
      });
    }
  }

  private toResult(plan: PlanWithRelations): PlanResult {
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      defaultDataLimitBytes: plan.defaultDataLimitBytes?.toString() ?? null,
      defaultExpiryDays: plan.defaultExpiryDays,
      defaultDeviceLimit: plan.defaultDeviceLimit,
      defaultIpLimit: plan.defaultIpLimit,
      defaultSpeedLimitBps: plan.defaultSpeedLimitBps?.toString() ?? null,
      defaultResetStrategy: plan.defaultResetStrategy,
      subscriptionTitleTemplate: plan.subscriptionTitleTemplate,
      subscriptionAnnounce: plan.subscriptionAnnounce,
      subscriptionSupportUrl: plan.subscriptionSupportUrl,
      subscriptionWebPageUrl: plan.subscriptionWebPageUrl,
      inboundIds: plan.planInbounds.map((item) => item.inboundId),
      userCount: plan._count.users,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      archivedAt: plan.archivedAt?.toISOString() ?? null,
    };
  }

  private toBigInt(
    value: string | null | undefined,
  ): bigint | null | undefined {
    return value === undefined
      ? undefined
      : value === null
        ? null
        : BigInt(value);
  }

  private mapMutationError(error: unknown): unknown {
    if (error instanceof ApiException) {
      return error;
    }
    if (error && typeof error === 'object') {
      const code = (error as { code?: unknown }).code;
      if (code === 'P2002') {
        return new ApiException('CONFLICT', HttpStatus.CONFLICT, {
          reason: 'unique_constraint',
        });
      }
      if (code === 'P2003') {
        return new ApiException('CONFLICT', HttpStatus.CONFLICT, {
          reason: 'referenced_resource',
        });
      }
    }
    return error;
  }

  private errorName(error: unknown): string {
    if (error instanceof ApiException) {
      return error.code;
    }
    return error instanceof Error ? error.name : 'unknown';
  }
}
