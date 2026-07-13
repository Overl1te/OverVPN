import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoreEngine } from '@overvpn/shared/constants';
import type {
  GlobalUsage,
  OnlineSessionListQuery,
  OnlineSessionListResponse,
  SystemDashboard,
  SystemHealth,
  UsageDateRangeQuery,
} from '@overvpn/shared/schemas';
import { localizeThroughputReason } from '../core/core-user-messages';
import type { AppEnvironment } from '../config/environment';
import {
  CoreProvider,
  type AggregatedCoreHealthResult,
  type CoreHealthResult,
} from '../core/core-provider';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';
import {
  WorkerHealthService,
  type WorkerHealthResult,
} from '../workers/worker-health.service';

@Injectable()
export class SystemService {
  private readonly sessionTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: CoreProvider,
    private readonly workerHealth: WorkerHealthService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.sessionTimeoutMs = config.get('ONLINE_SESSION_TIMEOUT_MS', {
      infer: true,
    });
  }

  async listOnlineSessions(
    query: OnlineSessionListQuery,
  ): Promise<OnlineSessionListResponse> {
    const where: Prisma.OnlineSessionWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.inboundId ? { inboundId: query.inboundId } : {}),
      ...(query.ip
        ? { ipAddress: { contains: query.ip, mode: 'insensitive' } }
        : {}),
      ...(query.state === 'active'
        ? { disconnectedAt: null }
        : query.state === 'history'
          ? { disconnectedAt: { not: null } }
          : {}),
    };
    const [total, sessions] = await this.prisma.$transaction([
      this.prisma.onlineSession.count({ where }),
      this.prisma.onlineSession.findMany({
        where,
        include: {
          user: { select: { username: true } },
          inbound: { select: { tag: true } },
        },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: sessions.map((session) => ({
        id: session.id,
        sessionKey: session.sessionKey,
        userId: session.userId,
        username: session.user.username,
        inboundId: session.inboundId,
        inboundTag: session.inbound.tag,
        ipAddress: session.ipAddress,
        deviceId: session.deviceId,
        connectedAt: session.connectedAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        disconnectedAt: session.disconnectedAt?.toISOString() ?? null,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async globalUsage(query: UsageDateRangeQuery): Promise<GlobalUsage> {
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T00:00:00.000Z`);
    const rows = await this.prisma.usageDaily.findMany({
      where: { day: { gte: from, lte: to } },
      select: { day: true, uploadBytes: true, downloadBytes: true },
      orderBy: { day: 'asc' },
    });
    const byDay = new Map<
      string,
      { uploadBytes: bigint; downloadBytes: bigint }
    >();
    for (const row of rows) {
      const day = row.day.toISOString().slice(0, 10);
      const value = byDay.get(day) ?? {
        uploadBytes: 0n,
        downloadBytes: 0n,
      };
      value.uploadBytes += row.uploadBytes;
      value.downloadBytes += row.downloadBytes;
      byDay.set(day, value);
    }
    let uploadBytes = 0n;
    let downloadBytes = 0n;
    const series = [];
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
      uploadBytes += value.uploadBytes;
      downloadBytes += value.downloadBytes;
      series.push({
        day,
        uploadBytes: value.uploadBytes.toString(),
        downloadBytes: value.downloadBytes.toString(),
        totalBytes: (value.uploadBytes + value.downloadBytes).toString(),
      });
    }
    return {
      from: query.from,
      to: query.to,
      uploadBytes: uploadBytes.toString(),
      downloadBytes: downloadBytes.toString(),
      totalBytes: (uploadBytes + downloadBytes).toString(),
      series,
    };
  }

  async dashboard(query: UsageDateRangeQuery): Promise<SystemDashboard> {
    const activeCutoff = new Date(Date.now() - this.sessionTimeoutMs);
    const [
      statusGroups,
      totalUsers,
      totals,
      activeOnline,
      usage,
      core,
      workers,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.aggregate({
        where: { deletedAt: null },
        _sum: { usedUploadBytes: true, usedDownloadBytes: true },
      }),
      this.prisma.onlineSession.count({
        where: {
          disconnectedAt: null,
          lastSeenAt: { gte: activeCutoff },
        },
      }),
      this.globalUsage(query),
      this.core.health(),
      this.workerHealth.getAll(),
    ]);
    const counts = {
      ACTIVE: 0,
      DISABLED: 0,
      EXPIRED: 0,
      LIMITED: 0,
    };
    for (const group of statusGroups) {
      counts[group.status] = group._count._all;
    }
    const uploadBytes = totals._sum.usedUploadBytes ?? 0n;
    const downloadBytes = totals._sum.usedDownloadBytes ?? 0n;
    return {
      generatedAt: new Date().toISOString(),
      users: {
        total: totalUsers,
        byStatus: counts,
      },
      online: { active: activeOnline },
      traffic: {
        current: {
          uploadBytes: uploadBytes.toString(),
          downloadBytes: downloadBytes.toString(),
          totalBytes: (uploadBytes + downloadBytes).toString(),
        },
        period: usage,
        throughput: throughputFromWorkers(workers),
      },
      core: toCoreHealthPayload(core),
      workers,
    };
  }

  async healthDetails(): Promise<SystemHealth> {
    const [core, workers] = await Promise.all([
      this.core.health(),
      this.workerHealth.getAll(),
    ]);
    const degradedWorkers = workers.filter((worker) =>
      ['DEGRADED', 'FAILED', 'STALE', 'UNAVAILABLE'].includes(worker.state),
    );
    return {
      status: core.healthy && degradedWorkers.length === 0 ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      core: toCoreHealthPayload(core),
      workers,
    };
  }
}

function toCoreHealthPayload(
  core: CoreHealthResult | AggregatedCoreHealthResult,
): SystemHealth['core'] {
  const engines =
    'engines' in core && core.engines
      ? (Object.fromEntries(
          Object.entries(core.engines).map(([engine, health]) => [
            engine as CoreEngine,
            {
              healthy: health.healthy,
              version: health.version,
              latencyMs: health.latencyMs,
              checkedAt: health.checkedAt.toISOString(),
              error: health.error,
              errorRu: health.errorRu,
            },
          ]),
        ) as NonNullable<SystemHealth['core']['engines']>)
      : undefined;
  return {
    healthy: core.healthy,
    version: core.version,
    latencyMs: core.latencyMs,
    checkedAt: core.checkedAt.toISOString(),
    error: core.error,
    errorRu: core.errorRu,
    ...(engines ? { engines } : {}),
  };
}

function throughputFromWorkers(workers: WorkerHealthResult[]) {
  const traffic = workers.find((worker) => worker.name === 'traffic-collector');
  const upload = traffic?.details.uploadBytesPerSecond;
  const download = traffic?.details.downloadBytesPerSecond;
  const capturedAt = traffic?.details.capturedAt;
  const available =
    traffic !== undefined &&
    !['FAILED', 'STALE', 'UNAVAILABLE', 'DISABLED', 'NOT_RUN'].includes(
      traffic.state,
    ) &&
    traffic.details.throughputAvailable === true &&
    typeof upload === 'string' &&
    typeof download === 'string' &&
    typeof capturedAt === 'string';
  if (!available) {
    const localized = localizeThroughputReason(
      traffic?.name,
      traffic?.state,
      traffic?.error,
    );
    return {
      available: false as const,
      reason: localized.en,
      reasonRu: localized.ru,
      lastSuccessfulAt: traffic?.lastSuccessAt ?? null,
    };
  }
  return {
    available: true as const,
    capturedAt,
    uploadBytesPerSecond: upload,
    downloadBytesPerSecond: download,
    totalBytesPerSecond: (BigInt(upload) + BigInt(download)).toString(),
  };
}
