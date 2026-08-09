import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { CoreProvider } from '../core/core-provider';
import { RedisDistributedLock } from '../core/distributed-lock';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { parseNonnegativeInt64 } from './traffic-accounting';
import { WorkerHealthService } from './worker-health.service';

const LOCK_KEY = 'overvpn:workers:online-collector:lock';
const WORKER_NAME = 'online-collector' as const;

export type OnlineCollectionResult =
  | { acquired: false }
  | {
      acquired: true;
      status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
      observed: number;
      resolved: number;
      disconnected: number;
    };

@Injectable()
export class OnlineSessionCollectorService {
  private readonly logger = new Logger(OnlineSessionCollectorService.name);
  private readonly enabled: boolean;
  private readonly lockTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: CoreProvider,
    private readonly lock: RedisDistributedLock,
    private readonly health: WorkerHealthService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.lockTtlMs = config.get('WORKER_LOCK_TTL_MS', { infer: true });
  }

  async runOnce(): Promise<OnlineCollectionResult> {
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
          const snapshot = await this.provider.getOnlineClients();
          await assertOwned.verify();
          const result = await this.prisma.$transaction(
            async (tx) => {
              const userIds = [
                ...new Set(
                  snapshot.clients.flatMap((client) =>
                    client.panelUserId ? [client.panelUserId] : [],
                  ),
                ),
              ];
              const inboundTags = [
                ...new Set(
                  snapshot.clients.flatMap((client) =>
                    client.inboundTag ? [client.inboundTag] : [],
                  ),
                ),
              ];
              const xrayUserIdsNeedingFallback = [
                ...new Set(
                  snapshot.clients.flatMap((client) =>
                    client.engine === 'XRAY' &&
                    !client.inboundTag &&
                    client.panelUserId
                      ? [client.panelUserId]
                      : [],
                  ),
                ),
              ];
              const [users, inbounds, xrayAssignments] = await Promise.all([
                tx.user.findMany({
                  where: { id: { in: userIds }, deletedAt: null },
                  select: { id: true },
                }),
                tx.inbound.findMany({
                  where: { tag: { in: inboundTags } },
                  select: { id: true, tag: true },
                }),
                xrayUserIdsNeedingFallback.length > 0
                  ? tx.userInboundAssignment.findMany({
                      where: {
                        userId: { in: xrayUserIdsNeedingFallback },
                        status: 'ACTIVE',
                        inbound: {
                          engine: 'XRAY',
                          enabled: true,
                        },
                      },
                      select: {
                        userId: true,
                        inboundId: true,
                      },
                      orderBy: [{ userId: 'asc' }, { id: 'asc' }],
                    })
                  : Promise.resolve([]),
              ]);
              const knownUsers = new Set(users.map((user) => user.id));
              const inboundByTag = new Map(
                inbounds.map((inbound) => [inbound.tag, inbound.id]),
              );
              const xrayInboundByUser = new Map<string, string>();
              for (const assignment of xrayAssignments) {
                if (!xrayInboundByUser.has(assignment.userId)) {
                  xrayInboundByUser.set(
                    assignment.userId,
                    assignment.inboundId,
                  );
                }
              }
              const seenConnectionIds = snapshot.clients
                .map((client) => client.connectionId)
                .filter((id) => id.length > 0 && id.length <= 255);
              let resolved = 0;
              let unresolved = 0;
              let invalid = snapshot.clients.length - seenConnectionIds.length;

              for (const client of snapshot.clients) {
                if (
                  !client.connectionId ||
                  client.connectionId.length > 255 ||
                  !client.panelUserId ||
                  !knownUsers.has(client.panelUserId)
                ) {
                  unresolved += 1;
                  continue;
                }

                let inboundId: string | undefined;
                if (client.inboundTag) {
                  inboundId = inboundByTag.get(client.inboundTag);
                } else if (client.engine === 'XRAY') {
                  inboundId = xrayInboundByUser.get(client.panelUserId);
                }

                if (!inboundId) {
                  unresolved += 1;
                  continue;
                }
                const ipAddress =
                  client.ipAddress && client.ipAddress.length <= 64
                    ? client.ipAddress
                    : null;
                if (client.ipAddress && !ipAddress) {
                  invalid += 1;
                }
                const deviceId =
                  client.device && client.device.length <= 255
                    ? client.device
                    : ipAddress
                      ? `ip:${ipAddress}`
                      : null;
                const connectedAt =
                  client.connectedAt &&
                  client.connectedAt.getTime() <= snapshot.capturedAt.getTime()
                    ? client.connectedAt
                    : snapshot.capturedAt;
                const traffic = sessionTrafficFromClient(client);
                await tx.onlineSession.upsert({
                  where: { sessionKey: client.connectionId },
                  create: {
                    sessionKey: client.connectionId,
                    engine: client.engine,
                    userId: client.panelUserId,
                    inboundId,
                    ipAddress,
                    deviceId,
                    uploadBytes: traffic.uploadBytes,
                    downloadBytes: traffic.downloadBytes,
                    connectedAt,
                    lastSeenAt: snapshot.capturedAt,
                    disconnectedAt: null,
                  },
                  update: {
                    engine: client.engine,
                    userId: client.panelUserId,
                    inboundId,
                    ipAddress,
                    deviceId,
                    ...trafficUpdateFields(traffic),
                    lastSeenAt: snapshot.capturedAt,
                    disconnectedAt: null,
                  },
                });
                resolved += 1;
              }

              let disconnected = 0;
              if (!snapshot.partial) {
                const closed = await tx.onlineSession.updateMany({
                  where: {
                    disconnectedAt: null,
                    ...(seenConnectionIds.length > 0
                      ? { sessionKey: { notIn: seenConnectionIds } }
                      : {}),
                  },
                  data: { disconnectedAt: snapshot.capturedAt },
                });
                disconnected = closed.count;
              }
              await assertOwned.verify();
              return { resolved, unresolved, invalid, disconnected };
            },
            { isolationLevel: 'Serializable' },
          );

          const degraded =
            snapshot.partial ||
            snapshot.warnings.length > 0 ||
            result.unresolved > 0 ||
            result.invalid > 0;
          const details = {
            capturedAt: snapshot.capturedAt.toISOString(),
            providerPartial: snapshot.partial,
            observedClients: snapshot.clients.length,
            resolvedClients: result.resolved,
            unresolvedClients: result.unresolved,
            invalidClients: result.invalid,
            disconnectedSessions: result.disconnected,
            warnings: snapshot.warnings.slice(0, 20),
          };
          if (degraded) {
            await this.health.markDegraded(
              WORKER_NAME,
              startedAt,
              snapshot.warnings[0] ??
                'Some online clients could not be resolved safely',
              details,
            );
          } else {
            await this.health.markSuccess(WORKER_NAME, startedAt, details);
          }
          if (snapshot.clients.length > 0 || result.disconnected > 0) {
            this.logger.log({
              msg: 'Online sessions collected',
              status: degraded ? 'DEGRADED' : 'HEALTHY',
              observed: snapshot.clients.length,
              resolved: result.resolved,
              disconnected: result.disconnected,
              clients: snapshot.clients.slice(0, 50).map((client) => ({
                engine: client.engine,
                panelUserId: client.panelUserId,
                inboundTag: client.inboundTag,
                connectionId: client.connectionId,
              })),
              warnings: snapshot.warnings.slice(0, 10),
            });
          }
          return {
            acquired: true,
            status: degraded ? ('DEGRADED' as const) : ('HEALTHY' as const),
            observed: snapshot.clients.length,
            resolved: result.resolved,
            disconnected: result.disconnected,
          };
        },
      );
      return attempted.acquired ? attempted.value : { acquired: false };
    } catch (error: unknown) {
      await this.health.markFailure(WORKER_NAME, startedAt, error);
      this.logger.error(
        `Online session collection failed: ${errorMessage(error)}`,
      );
      return {
        acquired: true,
        status: 'FAILED',
        observed: 0,
        resolved: 0,
        disconnected: 0,
      };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parse core connection counters; null when the engine did not report them. */
export function sessionTrafficFromClient(client: {
  uploadBytes: string | null;
  downloadBytes: string | null;
}): { uploadBytes: bigint | null; downloadBytes: bigint | null } {
  return {
    uploadBytes: parseSessionBytes(client.uploadBytes),
    downloadBytes: parseSessionBytes(client.downloadBytes),
  };
}

/**
 * Only overwrite stored counters when the snapshot reported a value.
 * Avoids wiping known bytes with null on partial/xray snapshots.
 */
export function trafficUpdateFields(traffic: {
  uploadBytes: bigint | null;
  downloadBytes: bigint | null;
}): { uploadBytes?: bigint; downloadBytes?: bigint } {
  return {
    ...(traffic.uploadBytes !== null
      ? { uploadBytes: traffic.uploadBytes }
      : {}),
    ...(traffic.downloadBytes !== null
      ? { downloadBytes: traffic.downloadBytes }
      : {}),
  };
}

function parseSessionBytes(value: string | null): bigint | null {
  if (value == null || value === '') {
    return null;
  }
  return parseNonnegativeInt64(value);
}
