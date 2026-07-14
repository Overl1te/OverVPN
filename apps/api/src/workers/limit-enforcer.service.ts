import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserStatus } from '@overvpn/shared/constants';
import { AuditService } from '../audit/audit.service';
import type { AppEnvironment } from '../config/environment';
import { CoreApplyService } from '../core/core-apply.service';
import { RedisDistributedLock } from '../core/distributed-lock';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { TelegramNotificationService } from '../notifications/telegram-notification.service';
import {
  countIdentitiesByUser,
  evaluateEnforcedStatus,
  nextIdentityLimitHoldUntil,
  nextResetAfterEnforcement,
} from './limit-enforcement';
import { WorkerHealthService } from './worker-health.service';

const LOCK_KEY = 'overvpn:workers:limit-enforcer:lock';
const WORKER_NAME = 'limit-enforcer' as const;

interface StatusTransition {
  userId: string;
  username: string;
  previousStatus: UserStatus;
  status: UserStatus;
  reason: string | null;
}

export type EnforcementResult =
  | { acquired: false }
  | {
      acquired: true;
      status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
      evaluated: number;
      statusChanges: number;
      resets: number;
      applyStatus: string | null;
    };

@Injectable()
export class LimitEnforcerService {
  private readonly logger = new Logger(LimitEnforcerService.name);
  private readonly enabled: boolean;
  private readonly lockTtlMs: number;
  private readonly sessionTimeoutMs: number;
  private readonly identityHoldMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: RedisDistributedLock,
    private readonly health: WorkerHealthService,
    private readonly audit: AuditService,
    private readonly coreApply: CoreApplyService,
    private readonly notifications: TelegramNotificationService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.lockTtlMs = config.get('WORKER_LOCK_TTL_MS', { infer: true });
    this.sessionTimeoutMs = config.get('ONLINE_SESSION_TIMEOUT_MS', {
      infer: true,
    });
    this.identityHoldMs = config.get('IDENTITY_LIMIT_HOLD_MS', { infer: true });
  }

  async runOnce(now = new Date()): Promise<EnforcementResult> {
    if (!this.enabled) {
      return { acquired: false };
    }
    const startedAt = new Date();
    try {
      const attempted = await this.lock.tryWithLock(
        LOCK_KEY,
        this.lockTtlMs,
        async (assertOwned) => {
          await this.health.markRunning(WORKER_NAME, startedAt);
          const onlineCutoff = new Date(now.getTime() - this.sessionTimeoutMs);
          const outcome = await this.prisma.$transaction(
            async (tx) => {
              const [users, sessions] = await Promise.all([
                tx.user.findMany({
                  where: { deletedAt: null },
                  orderBy: { id: 'asc' },
                }),
                tx.onlineSession.findMany({
                  where: {
                    disconnectedAt: null,
                    lastSeenAt: { gte: onlineCutoff },
                  },
                  select: {
                    userId: true,
                    deviceId: true,
                    ipAddress: true,
                  },
                }),
              ]);
              const identities = countIdentitiesByUser(sessions);

              const transitions: StatusTransition[] = [];
              let resets = 0;
              let scheduleRepairs = 0;
              for (const user of users) {
                const due =
                  user.resetStrategy !== 'NO_RESET' &&
                  user.nextResetAt !== null &&
                  user.nextResetAt <= now;
                const shouldRepairSchedule =
                  (user.resetStrategy === 'NO_RESET' &&
                    user.nextResetAt !== null) ||
                  (user.resetStrategy !== 'NO_RESET' &&
                    user.nextResetAt === null);
                const usedUploadBytes = due ? 0n : user.usedUploadBytes;
                const usedDownloadBytes = due ? 0n : user.usedDownloadBytes;
                const active = identities.get(user.id);
                const activeDevices = active?.devices.size ?? 0;
                const overDeviceLimit =
                  user.deviceLimit !== null &&
                  activeDevices > user.deviceLimit;
                const enforced = evaluateEnforcedStatus(
                  {
                    ...user,
                    usedUploadBytes,
                    usedDownloadBytes,
                  },
                  {
                    devices: activeDevices,
                  },
                  now,
                );
                const nextHoldUntil = nextIdentityLimitHoldUntil(
                  enforced,
                  overDeviceLimit,
                  this.identityHoldMs,
                  now,
                  user.identityLimitHoldUntil,
                );
                const holdChanged =
                  (nextHoldUntil?.getTime() ?? null) !==
                  (user.identityLimitHoldUntil?.getTime() ?? null);
                const statusChanged =
                  enforced.status !== user.status ||
                  enforced.statusReason !== user.statusReason;
                if (
                  !due &&
                  !shouldRepairSchedule &&
                  !statusChanged &&
                  !holdChanged
                ) {
                  continue;
                }

                const data: Prisma.UserUpdateInput = {};
                if (due) {
                  data.usedUploadBytes = 0n;
                  data.usedDownloadBytes = 0n;
                  data.accountingEpoch = { increment: 1 };
                  data.trafficResetAt = now;
                  data.nextResetAt = nextResetAfterEnforcement(
                    user.resetStrategy,
                    now,
                  );
                } else if (shouldRepairSchedule) {
                  data.nextResetAt = nextResetAfterEnforcement(
                    user.resetStrategy,
                    now,
                  );
                }
                if (statusChanged) {
                  data.status = enforced.status;
                  data.statusReason = enforced.statusReason;
                  data.disabledAt =
                    enforced.status === 'DISABLED' ? user.disabledAt : null;
                  data.revision = { increment: 1 };
                  data.needsApply = true;
                }
                if (holdChanged) {
                  data.identityLimitHoldUntil = nextHoldUntil;
                }
                const updated = await tx.user.update({
                  where: { id: user.id },
                  data,
                });
                if (due) {
                  resets += 1;
                  await this.audit.record(
                    {
                      actorAdminId: null,
                      action: 'SYSTEM_TRAFFIC_RESET',
                      resourceType: 'user',
                      resourceId: user.id,
                      before: {
                        usedUploadBytes: user.usedUploadBytes,
                        usedDownloadBytes: user.usedDownloadBytes,
                        accountingEpoch: user.accountingEpoch,
                        nextResetAt: user.nextResetAt,
                      },
                      after: {
                        usedUploadBytes: updated.usedUploadBytes,
                        usedDownloadBytes: updated.usedDownloadBytes,
                        accountingEpoch: updated.accountingEpoch,
                        trafficResetAt: updated.trafficResetAt,
                        nextResetAt: updated.nextResetAt,
                      },
                      metadata: {
                        strategy: user.resetStrategy,
                        trigger: 'scheduled',
                      },
                    },
                    tx,
                  );
                } else if (shouldRepairSchedule) {
                  scheduleRepairs += 1;
                }
                if (statusChanged) {
                  transitions.push({
                    userId: user.id,
                    username: user.username,
                    previousStatus: user.status,
                    status: enforced.status,
                    reason: enforced.statusReason,
                  });
                  await this.audit.record(
                    {
                      actorAdminId: null,
                      action: 'SYSTEM_USER_STATUS_CHANGE',
                      resourceType: 'user',
                      resourceId: user.id,
                      before: {
                        status: user.status,
                        statusReason: user.statusReason,
                        identityLimitHoldUntil: user.identityLimitHoldUntil,
                      },
                      after: {
                        status: enforced.status,
                        statusReason: enforced.statusReason,
                        identityLimitHoldUntil: nextHoldUntil,
                      },
                      metadata: {
                        trigger: 'enforcement',
                        activeDevices,
                        identityHoldMs: this.identityHoldMs,
                      },
                    },
                    tx,
                  );
                }
              }
              const pendingApply = await tx.user.count({
                where: { needsApply: true },
              });
              await assertOwned.verify();
              return {
                evaluated: users.length,
                transitions,
                resets,
                scheduleRepairs,
                pendingApply,
              };
            },
            { isolationLevel: 'Serializable' },
          );

          let applyStatus: string | null = null;
          let applyError: string | null = null;
          if (outcome.pendingApply > 0) {
            await assertOwned.verify();
            const applied = await this.coreApply.applySystem(
              'Automated enforcement reconciliation',
              'ENFORCEMENT',
            );
            assertOwned();
            applyStatus = applied.status;
            applyError = applied.error;
          }
          await Promise.all(
            outcome.transitions
              .filter(
                (transition) =>
                  transition.status === 'EXPIRED' ||
                  transition.status === 'LIMITED',
              )
              .map((transition) =>
                this.notifications.notifyUserTransition(transition),
              ),
          );
          const details = {
            evaluatedUsers: outcome.evaluated,
            statusChanges: outcome.transitions.length,
            scheduledResets: outcome.resets,
            repairedSchedules: outcome.scheduleRepairs,
            pendingApplyUsers: outcome.pendingApply,
            applyStatus,
          };
          if (applyStatus && applyStatus !== 'SUCCEEDED') {
            await this.health.markDegraded(
              WORKER_NAME,
              startedAt,
              `Core apply did not succeed: ${applyError ?? applyStatus}`,
              details,
            );
            return {
              acquired: true,
              status: 'DEGRADED' as const,
              evaluated: outcome.evaluated,
              statusChanges: outcome.transitions.length,
              resets: outcome.resets,
              applyStatus,
            };
          }
          await this.health.markSuccess(WORKER_NAME, startedAt, details);
          return {
            acquired: true,
            status: 'HEALTHY' as const,
            evaluated: outcome.evaluated,
            statusChanges: outcome.transitions.length,
            resets: outcome.resets,
            applyStatus,
          };
        },
      );
      return attempted.acquired ? attempted.value : { acquired: false };
    } catch (error: unknown) {
      await this.health.markFailure(WORKER_NAME, startedAt, error);
      this.logger.error(`Limit enforcement failed: ${errorMessage(error)}`);
      return {
        acquired: true,
        status: 'FAILED',
        evaluated: 0,
        statusChanges: 0,
        resets: 0,
        applyStatus: null,
      };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
