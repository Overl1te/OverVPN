import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ConfigApplyRequest,
  ConfigPreviewResult,
  CoreApplyListQuery,
  CoreApplyRecordResult,
  CoreApplySummary,
} from '@overvpn/shared/schemas';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import type { AppEnvironment } from '../config/environment';
import type {
  CoreApplyRecord,
  CoreApplyTrigger,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { TelegramNotificationService } from '../notifications/telegram-notification.service';
import { CoreFileSystem } from './core-adapters';
import {
  parseAndRedactJson,
  redactText,
  sha256,
  summarizeDiff,
  unifiedDiff,
} from './core-config-utils';
import { CoreProvider, type CoreDesiredState } from './core-provider';
import { CoreStateLoader } from './core-state.loader';
import { RedisDistributedLock } from './distributed-lock';

@Injectable()
export class CoreApplyService {
  private readonly configPath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: CoreProvider,
    private readonly stateLoader: CoreStateLoader,
    private readonly lock: RedisDistributedLock,
    private readonly fileSystem: CoreFileSystem,
    private readonly audit: AuditService,
    private readonly notifications: TelegramNotificationService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.configPath = config.get('SING_BOX_CONFIG_PATH', { infer: true });
  }

  async preview(): Promise<ConfigPreviewResult> {
    const state = await this.stateLoader.load();
    const rendered = this.provider.renderConfig(state);
    const validation = await this.provider.validate(rendered);
    const current = await this.currentRedacted();
    return {
      valid: validation.valid,
      hash: rendered.hash,
      previousHash: current.hash,
      config: rendered.redactedConfig,
      diff: unifiedDiff(
        current.canonical,
        rendered.redactedCanonical,
        'current-redacted.json',
        'desired-redacted.json',
      ),
      validationError: validation.error,
    };
  }

  async apply(
    actor: AuthenticatedAdmin | null,
    input: ConfigApplyRequest,
    trigger: CoreApplyTrigger,
    metadata: RequestMetadata,
  ): Promise<CoreApplySummary> {
    const startedAt = new Date();
    const initial = await this.prisma.coreApplyRecord.create({
      data: {
        status: 'APPLYING',
        trigger,
        reason: input.reason,
        initiatedByAdminId: actor?.id ?? null,
        startedAt,
      },
    });
    let secretValues: string[] = [];
    try {
      const result = await this.lock.withLock(async (assertOwned) => {
        const state = await this.stateLoader.load();
        const rendered = this.provider.renderConfig(state);
        secretValues = rendered.secretValues;
        const current = await this.currentRedacted();
        const diff = unifiedDiff(
          current.canonical,
          rendered.redactedCanonical,
          'current-redacted.json',
          'desired-redacted.json',
        );
        const diffSummary = summarizeDiff(diff);
        const currentState = await this.prisma.coreState.findUnique({
          where: { id: 'sing-box' },
        });
        const configRevision = (currentState?.appliedRevision ?? 0) + 1;
        await this.prisma.coreApplyRecord.update({
          where: { id: initial.id },
          data: {
            desiredHash: rendered.hash,
            configChecksum: rendered.hash,
            previousHash: current.hash,
            configRevision,
            configPath: current.path,
            diffSummary,
          },
        });

        const validation = await this.provider.validate(rendered);
        if (!validation.valid) {
          return this.finishFailure(
            initial.id,
            rendered.hash,
            current.hash,
            `sing-box validation failed: ${validation.error ?? 'unknown validation error'}`,
          );
        }
        assertOwned();
        const applied = await this.provider.apply(rendered);
        assertOwned();
        if (applied.status !== 'SUCCEEDED') {
          const record = await this.prisma.coreApplyRecord.update({
            where: { id: initial.id },
            data: {
              status: applied.status,
              desiredHash: applied.desiredHash,
              configChecksum: applied.desiredHash,
              previousHash: applied.previousHash,
              errorMessage: applied.error,
              rollbackOutcome: applied.rollbackOutcome,
              rollbackStartedAt: applied.rollbackStartedAt,
              rollbackCompletedAt: applied.rollbackCompletedAt,
              completedAt: applied.completedAt,
            },
          });
          return this.toSummary(record);
        }

        const completedAt = applied.completedAt;
        const record = await this.prisma.$transaction(async (tx) => {
          await this.markSnapshotApplied(tx, state);
          await tx.coreState.upsert({
            where: { id: 'sing-box' },
            create: {
              id: 'sing-box',
              desiredRevision: state.desiredRevision,
              appliedRevision: configRevision,
              appliedConfigHash: rendered.hash,
              configPath: current.path,
              lastApplyRecordId: initial.id,
              appliedAt: applied.appliedAt,
            },
            update: {
              appliedRevision: configRevision,
              appliedConfigHash: rendered.hash,
              configPath: current.path,
              lastApplyRecordId: initial.id,
              appliedAt: applied.appliedAt,
            },
          });
          await tx.coreApplyRecord.updateMany({
            where: {
              id: { not: initial.id },
              status: 'PENDING',
              createdAt: { lte: startedAt },
            },
            data: {
              status: 'SUCCEEDED',
              desiredHash: rendered.hash,
              configChecksum: rendered.hash,
              previousHash: current.hash,
              configRevision,
              configPath: current.path,
              appliedAt: applied.appliedAt,
              completedAt,
              metadata: {
                reconciledByApplyRecordId: initial.id,
              },
            },
          });
          return tx.coreApplyRecord.update({
            where: { id: initial.id },
            data: {
              status: 'SUCCEEDED',
              desiredHash: rendered.hash,
              configChecksum: rendered.hash,
              previousHash: applied.previousHash,
              configRevision,
              configPath: current.path,
              diffSummary,
              appliedAt: applied.appliedAt,
              completedAt,
              rollbackOutcome: 'NOT_REQUIRED',
            },
          });
        });
        return this.toSummary(record);
      });
      await this.recordApplyAudit(actor, metadata, input.reason, result);
      await this.notifyFailure(trigger, result);
      return result;
    } catch (error: unknown) {
      const message = redactText(errorMessage(error), secretValues);
      const failed = await this.prisma.coreApplyRecord.update({
        where: { id: initial.id },
        data: {
          status: 'FAILED',
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      const result = this.toSummary(failed);
      await this.recordApplyAudit(actor, metadata, input.reason, result);
      await this.notifyFailure(trigger, result);
      return result;
    }
  }

  applySystem(
    reason: string,
    trigger: CoreApplyTrigger = 'ENFORCEMENT',
  ): Promise<CoreApplySummary> {
    return this.apply(null, { reason }, trigger, {
      requestId: null,
      ipAddress: null,
      userAgent: 'system-worker',
    });
  }

  async list(query: CoreApplyListQuery): Promise<{
    items: CoreApplyRecordResult[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const where: Prisma.CoreApplyRecordWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger ? { trigger: query.trigger } : {}),
    };
    const [total, records] = await this.prisma.$transaction([
      this.prisma.coreApplyRecord.count({ where }),
      this.prisma.coreApplyRecord.findMany({
        where,
        include: {
          initiatedByAdmin: {
            select: { username: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: records.map((record) =>
        this.toRecordResult(record, record.initiatedByAdmin?.username ?? null),
      ),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async get(id: string): Promise<CoreApplyRecordResult> {
    const record = await this.prisma.coreApplyRecord.findUnique({
      where: { id },
      include: {
        initiatedByAdmin: {
          select: { username: true },
        },
      },
    });
    if (!record) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toRecordResult(
      record,
      record.initiatedByAdmin?.username ?? null,
    );
  }

  private async currentRedacted(): Promise<{
    hash: string | null;
    canonical: string;
    path: string;
  }> {
    const path = this.configPath;
    try {
      const bytes = await this.fileSystem.read(path);
      return {
        hash: sha256(bytes),
        canonical: parseAndRedactJson(bytes.toString('utf8')).canonical,
        path,
      };
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return {
          hash: null,
          canonical: '{}\n',
          path,
        };
      }
      throw error;
    }
  }

  private async finishFailure(
    id: string,
    desiredHash: string,
    previousHash: string | null,
    error: string,
  ): Promise<CoreApplySummary> {
    return this.toSummary(
      await this.prisma.coreApplyRecord.update({
        where: { id },
        data: {
          status: 'FAILED',
          desiredHash,
          configChecksum: desiredHash,
          previousHash,
          errorMessage: error,
          completedAt: new Date(),
          rollbackOutcome: 'NOT_REQUIRED',
        },
      }),
    );
  }

  private async markSnapshotApplied(
    tx: Prisma.TransactionClient,
    state: CoreDesiredState,
  ): Promise<void> {
    for (const inbound of state.inboundRevisions) {
      await tx.inbound.updateMany({
        where: {
          id: inbound.id,
          revision: inbound.revision,
        },
        data: { needsApply: false },
      });
    }
    for (const user of state.userRevisions) {
      await tx.user.updateMany({
        where: {
          id: user.id,
          revision: user.revision,
        },
        data: { needsApply: false },
      });
    }
  }

  private async recordApplyAudit(
    actor: AuthenticatedAdmin | null,
    metadata: RequestMetadata,
    reason: string,
    result: CoreApplySummary,
  ): Promise<void> {
    const event = {
      actorAdminId: actor?.id ?? null,
      action: 'CORE_APPLY' as const,
      outcome:
        result.status === 'SUCCEEDED'
          ? ('SUCCESS' as const)
          : ('FAILURE' as const),
      resourceType: 'core_config',
      resourceId: result.id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      metadata: {
        reason,
        status: result.status,
        desiredHash: result.desiredHash,
        previousHash: result.previousHash,
        error: result.error,
        rollbackOutcome: result.rollbackOutcome,
      },
    };
    if (event.outcome === 'FAILURE') {
      await this.audit.recordFailureSafely(event);
    } else {
      await this.audit.recordSafely(event);
    }
  }

  private async notifyFailure(
    trigger: CoreApplyTrigger,
    result: CoreApplySummary,
  ): Promise<void> {
    if (result.status === 'SUCCEEDED') {
      return;
    }
    await this.notifications.notifyApplyFailure({
      applyId: result.id,
      trigger,
      error: result.error,
    });
  }

  private toSummary(record: CoreApplyRecord): CoreApplySummary {
    return {
      id: record.id,
      status: record.status,
      desiredHash: record.desiredHash,
      previousHash: record.previousHash,
      error: record.errorMessage,
      rollbackOutcome: record.rollbackOutcome,
      startedAt: record.startedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
    };
  }

  private toRecordResult(
    record: CoreApplyRecord,
    actorUsername: string | null,
  ): CoreApplyRecordResult {
    return {
      id: record.id,
      status: record.status,
      trigger: record.trigger,
      actorAdminId: record.initiatedByAdminId,
      actorUsername,
      reason: record.reason,
      desiredHash: record.desiredHash,
      previousHash: record.previousHash,
      configRevision: record.configRevision,
      configPath: record.configPath,
      diffSummary: record.diffSummary,
      error: record.errorMessage,
      rollbackOutcome: record.rollbackOutcome,
      startedAt: record.startedAt?.toISOString() ?? null,
      appliedAt: record.appliedAt?.toISOString() ?? null,
      rollbackStartedAt: record.rollbackStartedAt?.toISOString() ?? null,
      rollbackCompletedAt: record.rollbackCompletedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
