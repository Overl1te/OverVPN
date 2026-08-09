import { Injectable, Logger } from '@nestjs/common';
import type { AuditListQuery } from '@overvpn/shared/schemas';
import type {
  AuditAction,
  AuditOutcome,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';

const sensitiveKeyPattern =
  /password|authorization|cookie|credential|secret|token|totp|private.?key|mac.?key|certificatepem|keypem/i;

export function redactAuditData(value: unknown): Prisma.InputJsonValue {
  return normalize(value) as Prisma.InputJsonValue;
}

function normalize(value: unknown, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        normalize(nestedValue, nestedKey),
      ]),
    );
  }
  if (
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value)
  ) {
    return value;
  }
  return value === undefined ? null : `[unsupported:${typeof value}]`;
}

export interface AuditEvent {
  actorAdminId?: string | null;
  action: AuditAction;
  outcome?: AuditOutcome;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

type AuditClient = Pick<PrismaService, 'auditLog'>;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    event: AuditEvent,
    client: AuditClient = this.prisma,
  ): Promise<void> {
    const details = redactAuditData({
      ...(event.before === undefined ? {} : { before: event.before }),
      ...(event.after === undefined ? {} : { after: event.after }),
      ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    });
    await client.auditLog.create({
      data: {
        actorAdminId: event.actorAdminId ?? null,
        action: event.action,
        outcome: event.outcome ?? 'SUCCESS',
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        requestId: event.requestId ?? null,
        ipAddress: event.ipAddress ?? null,
        details,
      },
    });
    this.logger.log({
      msg: 'Audit event',
      action: event.action,
      outcome: event.outcome ?? 'SUCCESS',
      actorAdminId: event.actorAdminId ?? null,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      requestId: event.requestId ?? null,
      ipAddress: event.ipAddress ?? null,
      details,
    });
  }

  async recordFailureSafely(event: AuditEvent): Promise<void> {
    try {
      await this.record({ ...event, outcome: 'FAILURE' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to persist failure audit event: ${message}`);
    }
  }

  async recordSafely(event: AuditEvent): Promise<void> {
    try {
      await this.record(event);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to persist audit event: ${message}`);
    }
  }

  async list(query: AuditListQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorAdminId ? { actorAdminId: query.actorAdminId } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [total, entries] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          actorAdmin: {
            select: { username: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: entries.map((entry) => ({
        id: entry.id.toString(),
        actorAdminId: entry.actorAdminId,
        actorUsername: entry.actorAdmin?.username ?? null,
        action: entry.action,
        outcome: entry.outcome,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        requestId: entry.requestId,
        ipAddress: entry.ipAddress,
        details: entry.details,
        createdAt: entry.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }
}
