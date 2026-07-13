import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  BulkUserAction,
  UserStatusReason,
} from '@overvpn/shared/constants';
import type {
  BulkUserActionRequest,
  CreateUser,
  UpdateUser,
  UsageDateRangeQuery,
  UserListQuery,
  UserResult,
  UserUsageSummary,
} from '@overvpn/shared/schemas';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import { CoreChangeDispatcher } from '../core/core-change-dispatcher';
import type { Plan, Prisma, User } from '../generated/prisma/client';
import { PlanAssignmentSyncService } from '../inbounds/plan-assignment-sync.service';
import { PrismaService } from '../infrastructure/infrastructure.module';
import {
  calculateNextResetAt,
  createSubscriptionToken,
  normalizeUserStatus,
} from './user-domain';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coreChanges: CoreChangeDispatcher,
    private readonly planAssignments: PlanAssignmentSyncService,
  ) {}

  async list(query: UserListQuery): Promise<{
    items: UserResult[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                username: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                identity: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: users.map((user) => this.toResult(user)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async get(id: string): Promise<UserResult> {
    return this.toResult(await this.requireUser(id));
  }

  async create(
    input: CreateUser,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<UserResult> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const plan = await this.resolvePlan(tx, input.planId);
          const now = new Date();
          const expireAt = this.resolveExpiry(
            input.expireAt,
            plan?.defaultExpiryDays,
            now,
          );
          const dataLimitBytes = this.resolveBigInt(
            input.dataLimitBytes,
            plan?.defaultDataLimitBytes,
          );
          const resetStrategy =
            input.resetStrategy ?? plan?.defaultResetStrategy ?? 'NO_RESET';
          const state = {
            expireAt,
            dataLimitBytes,
            usedUploadBytes: 0n,
            usedDownloadBytes: 0n,
          };
          const normalized = normalizeUserStatus(
            state,
            input.status,
            input.statusReason,
            now,
          );
          const user = await tx.user.create({
            data: {
              identity: input.identity ?? input.username,
              username: input.username,
              status: normalized.status,
              statusReason: normalized.statusReason,
              note: input.note,
              tags: [...new Set(input.tags)],
              expireAt,
              dataLimitBytes,
              usedUploadBytes: 0n,
              usedDownloadBytes: 0n,
              resetStrategy,
              nextResetAt:
                input.nextResetAt === undefined
                  ? calculateNextResetAt(resetStrategy, now)
                  : this.toDate(input.nextResetAt),
              deviceLimit:
                input.deviceLimit === undefined
                  ? (plan?.defaultDeviceLimit ?? null)
                  : input.deviceLimit,
              ipLimit:
                input.ipLimit === undefined
                  ? (plan?.defaultIpLimit ?? null)
                  : input.ipLimit,
              speedLimitBps: this.resolveBigInt(
                input.speedLimitBps,
                plan?.defaultSpeedLimitBps,
              ),
              subToken: createSubscriptionToken(),
              planId: plan?.id ?? null,
              needsApply: true,
              disabledAt: normalized.disabledAt,
            },
          });
          await this.coreChanges.recordPending(
            {
              actorAdminId: actor.id,
              resourceType: 'user',
              resourceId: user.id,
              operation: 'create',
            },
            tx,
          );
          await this.audit.record(
            {
              actorAdminId: actor.id,
              action: 'USER_CREATE',
              resourceType: 'user',
              resourceId: user.id,
              requestId: metadata.requestId,
              ipAddress: metadata.ipAddress,
              after: user,
            },
            tx,
          );
          if (plan) {
            const inboundIds = await this.planAssignments.planInboundIds(
              tx,
              plan.id,
            );
            await this.planAssignments.syncUserToInboundIds(
              tx,
              user.id,
              inboundIds,
            );
          }
          return user;
        });
        return this.toResult(created);
      } catch (error: unknown) {
        if (this.isSubTokenCollision(error) && attempt < 4) {
          continue;
        }
        await this.audit.recordFailureSafely({
          actorAdminId: actor.id,
          action: 'USER_CREATE',
          resourceType: 'user',
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          metadata: { error: this.errorName(error), input },
        });
        throw this.mapMutationError(error);
      }
    }
    throw new ApiException('INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async update(
    id: string,
    input: UpdateUser,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<UserResult> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const before = await tx.user.findFirst({
          where: { id, deletedAt: null },
        });
        if (!before) {
          throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
        }
        const plan =
          input.planId === undefined
            ? undefined
            : await this.resolvePlan(tx, input.planId);
        const now = new Date();
        const applyingPlan = input.planId !== undefined && plan;
        const expireAt =
          input.expireAt !== undefined
            ? this.toDate(input.expireAt)
            : applyingPlan
              ? this.resolveExpiry(undefined, plan.defaultExpiryDays, now)
              : before.expireAt;
        const dataLimitBytes =
          input.dataLimitBytes !== undefined
            ? this.toBigInt(input.dataLimitBytes)
            : applyingPlan
              ? plan.defaultDataLimitBytes
              : before.dataLimitBytes;
        const resetStrategy =
          input.resetStrategy ??
          (applyingPlan ? plan.defaultResetStrategy : before.resetStrategy);
        const state = {
          expireAt,
          dataLimitBytes,
          usedUploadBytes: before.usedUploadBytes,
          usedDownloadBytes: before.usedDownloadBytes,
        };
        const normalized = normalizeUserStatus(
          state,
          input.status ?? before.status,
          (input.statusReason ??
            before.statusReason) as UserStatusReason | null,
          now,
        );
        const user = await tx.user.update({
          where: { id },
          data: {
            identity: input.identity,
            username: input.username,
            status: normalized.status,
            statusReason: normalized.statusReason,
            note: input.note,
            tags: input.tags ? [...new Set(input.tags)] : undefined,
            planId: input.planId,
            expireAt,
            dataLimitBytes,
            resetStrategy,
            nextResetAt:
              input.nextResetAt !== undefined
                ? this.toDate(input.nextResetAt)
                : input.resetStrategy !== undefined || applyingPlan
                  ? calculateNextResetAt(resetStrategy, now)
                  : before.nextResetAt,
            deviceLimit:
              input.deviceLimit !== undefined
                ? input.deviceLimit
                : applyingPlan
                  ? plan.defaultDeviceLimit
                  : before.deviceLimit,
            ipLimit:
              input.ipLimit !== undefined
                ? input.ipLimit
                : applyingPlan
                  ? plan.defaultIpLimit
                  : before.ipLimit,
            speedLimitBps:
              input.speedLimitBps !== undefined
                ? this.toBigInt(input.speedLimitBps)
                : applyingPlan
                  ? plan.defaultSpeedLimitBps
                  : before.speedLimitBps,
            disabledAt: normalized.disabledAt,
            needsApply: true,
            revision: { increment: 1 },
          },
        });
        await this.coreChanges.recordPending(
          {
            actorAdminId: actor.id,
            resourceType: 'user',
            resourceId: id,
            operation: 'update',
          },
          tx,
        );
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'USER_UPDATE',
            resourceType: 'user',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before,
            after: user,
          },
          tx,
        );
        if (input.planId !== undefined) {
          if (plan) {
            const inboundIds = await this.planAssignments.planInboundIds(
              tx,
              plan.id,
            );
            await this.planAssignments.syncUserToInboundIds(tx, id, inboundIds);
          } else {
            await this.planAssignments.syncUserToInboundIds(tx, id, []);
          }
        }
        return user;
      });
      return this.toResult(updated);
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'USER_UPDATE',
        resourceType: 'user',
        resourceId: id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { error: this.errorName(error), input },
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
        const before = await tx.user.findFirst({
          where: { id, deletedAt: null },
        });
        if (!before) {
          throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
        }
        const now = new Date();
        const after = await tx.user.update({
          where: { id },
          data: {
            deletedAt: now,
            disabledAt: now,
            status: 'DISABLED',
            statusReason: 'manual',
            needsApply: true,
            revision: { increment: 1 },
          },
        });
        await this.coreChanges.recordPending(
          {
            actorAdminId: actor.id,
            resourceType: 'user',
            resourceId: id,
            operation: 'delete',
          },
          tx,
        );
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'USER_DELETE',
            resourceType: 'user',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before,
            after,
          },
          tx,
        );
      });
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'USER_DELETE',
        resourceType: 'user',
        resourceId: id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { error: this.errorName(error) },
      });
      throw this.mapMutationError(error);
    }
  }

  async rotateSubscription(
    id: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<UserResult> {
    let finalError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const updated = await this.prisma.$transaction(async (tx) => {
          const before = await tx.user.findFirst({
            where: { id, deletedAt: null },
          });
          if (!before) {
            throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
          }
          const after = await tx.user.update({
            where: { id },
            data: { subToken: createSubscriptionToken() },
          });
          await this.audit.record(
            {
              actorAdminId: actor.id,
              action: 'USER_ROTATE_SUB',
              resourceType: 'user',
              resourceId: id,
              requestId: metadata.requestId,
              ipAddress: metadata.ipAddress,
              before,
              after,
            },
            tx,
          );
          return after;
        });
        return this.toResult(updated);
      } catch (error: unknown) {
        finalError = error;
        if (this.isSubTokenCollision(error) && attempt < 4) {
          continue;
        }
        break;
      }
    }

    await this.audit.recordFailureSafely({
      actorAdminId: actor.id,
      action: 'USER_ROTATE_SUB',
      resourceType: 'user',
      resourceId: id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      metadata: { error: this.errorName(finalError) },
    });
    if (this.isSubTokenCollision(finalError)) {
      throw new ApiException(
        'INTERNAL_ERROR',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    throw this.mapMutationError(finalError);
  }

  async bulk(
    input: BulkUserActionRequest,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<{
    action: BulkUserAction;
    affected: number;
    users: UserResult[];
  }> {
    const ids = [...new Set(input.userIds)];
    const action = this.auditAction(input.action);
    try {
      let users: User[] | undefined;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          users = await this.prisma.$transaction(async (tx) => {
            const before = await tx.user.findMany({
              where: { id: { in: ids }, deletedAt: null },
              orderBy: { id: 'asc' },
            });
            if (before.length !== ids.length) {
              const found = new Set(before.map((user) => user.id));
              throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
                missingIds: ids.filter((id) => !found.has(id)),
              });
            }
            const plan =
              input.action === 'set-plan'
                ? await this.resolvePlan(tx, input.planId)
                : null;
            const now = new Date();
            const updated: User[] = [];
            for (const user of before) {
              const rotationToken =
                input.action === 'rotate-sub'
                  ? createSubscriptionToken()
                  : undefined;
              const data = this.bulkUpdate(
                input,
                user,
                plan,
                now,
                rotationToken,
              );
              const changes =
                input.action === 'rotate-sub'
                  ? data
                  : {
                      ...data,
                      needsApply: true,
                      revision: { increment: 1 },
                    };
              const changed = await tx.user.update({
                where: { id: user.id },
                data: changes,
              });
              updated.push(changed);
              if (input.action === 'set-plan') {
                if (plan) {
                  const inboundIds = await this.planAssignments.planInboundIds(
                    tx,
                    plan.id,
                  );
                  await this.planAssignments.syncUserToInboundIds(
                    tx,
                    user.id,
                    inboundIds,
                  );
                } else {
                  await this.planAssignments.syncUserToInboundIds(
                    tx,
                    user.id,
                    [],
                  );
                }
              }
              if (input.action !== 'rotate-sub') {
                await this.coreChanges.recordPending(
                  {
                    actorAdminId: actor.id,
                    resourceType: 'user',
                    resourceId: user.id,
                    operation: input.action,
                  },
                  tx,
                );
              }
            }
            await this.audit.record(
              {
                actorAdminId: actor.id,
                action,
                resourceType: 'user_bulk',
                resourceId: ids.join(','),
                requestId: metadata.requestId,
                ipAddress: metadata.ipAddress,
                before,
                after: updated,
                metadata: { action: input.action, affected: updated.length },
              },
              tx,
            );
            return updated;
          });
          break;
        } catch (error: unknown) {
          if (
            input.action === 'rotate-sub' &&
            this.isSubTokenCollision(error) &&
            attempt < 4
          ) {
            continue;
          }
          throw error;
        }
      }
      if (!users) {
        throw new ApiException(
          'INTERNAL_ERROR',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      return {
        action: input.action,
        affected: users.length,
        users: users.map((user) => this.toResult(user)),
      };
    } catch (error: unknown) {
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action,
        resourceType: 'user_bulk',
        resourceId: ids.join(','),
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { error: this.errorName(error), input },
      });
      throw this.mapMutationError(error);
    }
  }

  async resetTraffic(
    id: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<UserResult> {
    const result = await this.bulk(
      { action: 'reset-traffic', userIds: [id] },
      actor,
      metadata,
    );
    const user = result.users[0];
    if (!user) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  async usage(
    id: string,
    query: UsageDateRangeQuery,
  ): Promise<UserUsageSummary> {
    const user = await this.requireUser(id);
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T00:00:00.000Z`);
    const rows = await this.prisma.usageDaily.findMany({
      where: { userId: id, day: { gte: from, lte: to } },
      select: { day: true, uploadBytes: true, downloadBytes: true },
      orderBy: { day: 'asc' },
    });
    const byDay = new Map<
      string,
      { uploadBytes: bigint; downloadBytes: bigint }
    >();
    for (const row of rows) {
      const day = row.day.toISOString().slice(0, 10);
      const current = byDay.get(day) ?? {
        uploadBytes: 0n,
        downloadBytes: 0n,
      };
      current.uploadBytes += row.uploadBytes;
      current.downloadBytes += row.downloadBytes;
      byDay.set(day, current);
    }
    const series: UserUsageSummary['series'] = [];
    let periodUploadBytes = 0n;
    let periodDownloadBytes = 0n;
    for (
      let cursor = from;
      cursor <= to;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const day = cursor.toISOString().slice(0, 10);
      const value = byDay.get(day) ?? {
        uploadBytes: 0n,
        downloadBytes: 0n,
      };
      periodUploadBytes += value.uploadBytes;
      periodDownloadBytes += value.downloadBytes;
      series.push({
        day,
        uploadBytes: value.uploadBytes.toString(),
        downloadBytes: value.downloadBytes.toString(),
        totalBytes: (value.uploadBytes + value.downloadBytes).toString(),
      });
    }
    const today = new Date();
    const todayKey = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
    let daily = byDay.get(todayKey);
    if (!daily) {
      const dailyAggregate = await this.prisma.usageDaily.aggregate({
        where: {
          userId: id,
          day: new Date(`${todayKey}T00:00:00.000Z`),
        },
        _sum: { uploadBytes: true, downloadBytes: true },
      });
      daily = {
        uploadBytes: dailyAggregate._sum.uploadBytes ?? 0n,
        downloadBytes: dailyAggregate._sum.downloadBytes ?? 0n,
      };
    }
    const total = user.usedUploadBytes + user.usedDownloadBytes;
    const remaining =
      user.dataLimitBytes === null
        ? null
        : user.dataLimitBytes > total
          ? user.dataLimitBytes - total
          : 0n;
    return {
      from: query.from,
      to: query.to,
      usedUploadBytes: user.usedUploadBytes.toString(),
      usedDownloadBytes: user.usedDownloadBytes.toString(),
      usedTotalBytes: total.toString(),
      dataLimitBytes: user.dataLimitBytes?.toString() ?? null,
      remainingBytes: remaining?.toString() ?? null,
      dailyUploadBytes: daily.uploadBytes.toString(),
      dailyDownloadBytes: daily.downloadBytes.toString(),
      periodUploadBytes: periodUploadBytes.toString(),
      periodDownloadBytes: periodDownloadBytes.toString(),
      periodTotalBytes: (periodUploadBytes + periodDownloadBytes).toString(),
      series,
    };
  }

  async recentSessions(id: string): Promise<
    Array<{
      id: string;
      sessionKey: string;
      inboundId: string;
      ipAddress: string | null;
      deviceId: string | null;
      connectedAt: string;
      lastSeenAt: string;
      disconnectedAt: string | null;
    }>
  > {
    await this.requireUser(id);
    const sessions = await this.prisma.onlineSession.findMany({
      where: { userId: id },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return sessions.map((session) => ({
      id: session.id,
      sessionKey: session.sessionKey,
      inboundId: session.inboundId,
      ipAddress: session.ipAddress,
      deviceId: session.deviceId,
      connectedAt: session.connectedAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      disconnectedAt: session.disconnectedAt?.toISOString() ?? null,
    }));
  }

  private bulkUpdate(
    input: BulkUserActionRequest,
    user: User,
    plan: Plan | null,
    now: Date,
    rotationToken?: string,
  ): Prisma.UserUpdateInput {
    if (input.action === 'disable') {
      return {
        status: 'DISABLED',
        statusReason: 'manual',
        disabledAt: now,
      };
    }
    if (input.action === 'enable') {
      return normalizeUserStatus(user, 'ACTIVE', null, now);
    }
    if (input.action === 'reset-traffic') {
      return {
        usedUploadBytes: 0n,
        usedDownloadBytes: 0n,
        accountingEpoch: { increment: 1 },
        trafficResetAt: now,
        nextResetAt: calculateNextResetAt(user.resetStrategy, now),
        ...normalizeUserStatus(
          { ...user, usedUploadBytes: 0n, usedDownloadBytes: 0n },
          user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
          user.statusReason as UserStatusReason | null,
          now,
        ),
      };
    }
    if (input.action === 'extend') {
      const base = user.expireAt && user.expireAt > now ? user.expireAt : now;
      const expireAt = new Date(
        base.getTime() + input.days * 24 * 60 * 60 * 1_000,
      );
      return {
        expireAt,
        ...normalizeUserStatus(
          { ...user, expireAt },
          user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
          user.statusReason as UserStatusReason | null,
          now,
        ),
      };
    }
    if (input.action === 'set-plan') {
      if (!plan) {
        return { plan: { disconnect: true } };
      }
      const expireAt = this.resolveExpiry(
        undefined,
        plan.defaultExpiryDays,
        now,
      );
      const resetStrategy = plan.defaultResetStrategy;
      return {
        plan: { connect: { id: plan.id } },
        dataLimitBytes: plan.defaultDataLimitBytes,
        expireAt,
        deviceLimit: plan.defaultDeviceLimit,
        ipLimit: plan.defaultIpLimit,
        speedLimitBps: plan.defaultSpeedLimitBps,
        resetStrategy,
        nextResetAt: calculateNextResetAt(resetStrategy, now),
        ...normalizeUserStatus(
          { ...user, dataLimitBytes: plan.defaultDataLimitBytes, expireAt },
          user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
          user.statusReason as UserStatusReason | null,
          now,
        ),
      };
    }
    return { subToken: rotationToken ?? createSubscriptionToken() };
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  private async resolvePlan(
    client: Prisma.TransactionClient,
    planId: string | null | undefined,
  ): Promise<Plan | null> {
    if (!planId) {
      return null;
    }
    const plan = await client.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
        resource: 'plan',
        id: planId,
      });
    }
    if (plan.status !== 'ACTIVE') {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'plan_archived',
        id: planId,
      });
    }
    return plan;
  }

  private resolveExpiry(
    input: string | null | undefined,
    defaultDays: number | null | undefined,
    now: Date,
  ): Date | null {
    if (input !== undefined) {
      return this.toDate(input);
    }
    return defaultDays
      ? new Date(now.getTime() + defaultDays * 24 * 60 * 60 * 1_000)
      : null;
  }

  private resolveBigInt(
    input: string | null | undefined,
    fallback: bigint | null | undefined,
  ): bigint | null {
    return input === undefined ? (fallback ?? null) : this.toBigInt(input);
  }

  private toDate(value: string | null): Date | null {
    return value === null ? null : new Date(value);
  }

  private toBigInt(value: string | null): bigint | null {
    return value === null ? null : BigInt(value);
  }

  private toResult(user: User): UserResult {
    return {
      id: user.id,
      identity: user.identity,
      username: user.username,
      status: user.status,
      statusReason: user.statusReason as UserStatusReason | null,
      note: user.note,
      tags: user.tags,
      expireAt: user.expireAt?.toISOString() ?? null,
      dataLimitBytes: user.dataLimitBytes?.toString() ?? null,
      usedUploadBytes: user.usedUploadBytes.toString(),
      usedDownloadBytes: user.usedDownloadBytes.toString(),
      accountingEpoch: user.accountingEpoch,
      trafficResetAt: user.trafficResetAt?.toISOString() ?? null,
      resetStrategy: user.resetStrategy,
      nextResetAt: user.nextResetAt?.toISOString() ?? null,
      deviceLimit: user.deviceLimit,
      ipLimit: user.ipLimit,
      speedLimitBps: user.speedLimitBps?.toString() ?? null,
      subToken: user.subToken,
      planId: user.planId,
      needsApply: user.needsApply,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      deletedAt: user.deletedAt?.toISOString() ?? null,
    };
  }

  private auditAction(action: BulkUserAction) {
    const actions = {
      disable: 'USER_DISABLE',
      enable: 'USER_ENABLE',
      'reset-traffic': 'USER_RESET_TRAFFIC',
      extend: 'USER_EXTEND',
      'set-plan': 'USER_SET_PLAN',
      'rotate-sub': 'USER_ROTATE_SUB',
    } as const;
    return actions[action];
  }

  private isSubTokenCollision(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const candidate = error as { code?: unknown; meta?: unknown };
    return (
      candidate.code === 'P2002' &&
      JSON.stringify(candidate.meta).includes('subToken')
    );
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
    if (error instanceof Error) {
      return error.name;
    }
    return 'unknown';
  }
}
