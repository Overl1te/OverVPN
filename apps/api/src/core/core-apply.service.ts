import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoreEngine } from '@overvpn/shared/constants';
import type {
  ConfigApplyRequest,
  ConfigPreviewEngine,
  ConfigPreviewResult,
  CoreApplyEngineResult,
  CoreApplyListQuery,
  CoreApplyRecordResult,
  CoreApplySummary,
} from '@overvpn/shared/schemas';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/api-error';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import { SupportIntegrityService } from '../common/support-integrity';
import type { AppEnvironment } from '../config/environment';
import type {
  CoreApplyRecord,
  CoreApplyStatus,
  CoreApplyTrigger,
  Prisma,
  ProxyServer,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { TelegramNotificationService } from '../notifications/telegram-notification.service';
import { NODE_TOKEN_SETTINGS_KEY } from '../proxy-servers/proxy-server-secrets';
import { CoreFileSystem } from './core-adapters';
import {
  parseAndRedactJson,
  redactText,
  sha256,
  summarizeDiff,
  unifiedDiff,
} from './core-config-utils';
import { CoreEngineRegistry } from './core-engine.registry';
import { coreStateId } from './core-ids';
import type {
  CoreDesiredState,
  EngineProvider,
  RenderedCoreConfig,
} from './core-provider';
import { CoreStateLoader } from './core-state.loader';
import { RedisDistributedLock } from './distributed-lock';
import { HttpAgentTransport } from './http-agent.transport';

type EngineApplyOutcome = CoreApplyEngineResult & {
  appliedAt: Date | null;
  completedAt: Date | null;
  configPath: string;
  configRevision: number | null;
  diffSummary: unknown;
  state: CoreDesiredState | null;
  rendered: RenderedCoreConfig | null;
};

export type CoreApplyOptions = {
  proxyServerId?: string;
};

@Injectable()
export class CoreApplyService {
  private readonly logger = new Logger(CoreApplyService.name);
  private readonly configPaths: Record<CoreEngine, string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CoreEngineRegistry,
    private readonly stateLoader: CoreStateLoader,
    private readonly lock: RedisDistributedLock,
    private readonly fileSystem: CoreFileSystem,
    private readonly audit: AuditService,
    private readonly notifications: TelegramNotificationService,
    private readonly supportIntegrity: SupportIntegrityService,
    private readonly agentTransport: HttpAgentTransport,
    private readonly encryption: SecretEncryptionService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.configPaths = {
      SING_BOX: config.get('SING_BOX_CONFIG_PATH', { infer: true }),
      XRAY: config.get('XRAY_CONFIG_PATH', { infer: true }),
      MTPROXY: config.get('MTPROXY_CONFIG_PATH', { infer: true }),
    };
  }

  configPathFor(engine: CoreEngine): string {
    return this.configPaths[engine];
  }

  async preview(proxyServerId?: string): Promise<ConfigPreviewResult> {
    const engines: Partial<Record<CoreEngine, ConfigPreviewEngine>> = {};
    for (const provider of this.registry.all()) {
      engines[provider.engine] = await this.previewEngine(
        provider,
        proxyServerId,
      );
    }
    const primary =
      engines.SING_BOX ??
      engines[this.registry.all()[0]?.engine ?? 'SING_BOX'] ??
      emptyPreview();
    return {
      ...primary,
      engines: engines,
    };
  }

  async apply(
    actor: AuthenticatedAdmin | null,
    input: ConfigApplyRequest,
    trigger: CoreApplyTrigger,
    metadata: RequestMetadata,
    options: CoreApplyOptions = {},
  ): Promise<CoreApplySummary> {
    this.supportIntegrity.assertIntact();
    if (options.proxyServerId) {
      const proxy = await this.prisma.proxyServer.findUnique({
        where: { id: options.proxyServerId },
      });
      if (!proxy) {
        throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
          reason: 'proxy_server_not_found',
        });
      }
      if (proxy.agentBaseUrl) {
        return this.applyViaAgent(actor, input, trigger, metadata, proxy);
      }
    }
    return this.applyLocal(actor, input, trigger, metadata, options);
  }

  /**
   * Best-effort push used by wizard / callers that must not fail the parent mutation.
   * Returns null when agentBaseUrl is unset (local volume path not invoked).
   */
  async pushToAgentBestEffort(
    proxyServerId: string,
    reason: string,
  ): Promise<CoreApplySummary | null> {
    const proxy = await this.prisma.proxyServer.findUnique({
      where: { id: proxyServerId },
    });
    if (!proxy?.agentBaseUrl) {
      this.logger.log({
        msg: 'Best-effort agent push skipped (no agentBaseUrl)',
        proxyServerId,
        reason,
      });
      return null;
    }
    this.logger.log({
      msg: 'Best-effort agent push starting',
      proxyServerId,
      reason,
      agentBaseUrl: proxy.agentBaseUrl,
    });
    try {
      const summary = await this.apply(
        null,
        { reason },
        'MUTATION',
        {
          requestId: null,
          ipAddress: null,
          userAgent: 'proxy-wizard',
        },
        { proxyServerId },
      );
      this.logger.log({
        msg: 'Best-effort agent push completed',
        proxyServerId,
        reason,
        status: summary.status,
        applyRecordId: summary.id,
      });
      return summary;
    } catch (error: unknown) {
      this.logger.warn({
        msg: 'Best-effort agent push failed',
        proxyServerId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async applyViaAgent(
    actor: AuthenticatedAdmin | null,
    input: ConfigApplyRequest,
    trigger: CoreApplyTrigger,
    metadata: RequestMetadata,
    proxy: ProxyServer,
  ): Promise<CoreApplySummary> {
    const startedAt = new Date();
    const nodeToken = decryptNodeToken(proxy.settings, this.encryption);
    if (!nodeToken || !proxy.agentBaseUrl) {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'proxy_node_token_missing',
        message:
          'Proxy server has agentBaseUrl but no stored node token; re-register the agent',
        messageRu:
          'У прокси задан agentBaseUrl, но нет node token — перерегистрируйте агент',
      });
    }

    const initial = await this.prisma.coreApplyRecord.create({
      data: {
        status: 'APPLYING',
        trigger,
        reason: input.reason,
        initiatedByAdminId: actor?.id ?? null,
        proxyServerId: proxy.id,
        startedAt,
      },
    });

    try {
      const desired = await this.buildAgentDesired(proxy);
      this.logger.log({
        msg: 'Core apply via agent starting',
        proxyServerId: proxy.id,
        agentBaseUrl: proxy.agentBaseUrl,
        applyRecordId: initial.id.toString(),
        revision: desired.revision,
        engines: desired.engines.map((engine) => ({
          engine: engine.engine,
          enabled: engine.enabled,
          configHash: engine.configHash ?? null,
        })),
        reason: input.reason,
        trigger,
      });
      const push = await this.agentTransport.postApply({
        agentBaseUrl: proxy.agentBaseUrl,
        nodeToken,
        body: desired,
      });
      const completedAt = new Date();
      const status: CoreApplyStatus = push.ok ? 'SUCCEEDED' : 'FAILED';
      this.logger.log({
        msg: 'Core apply via agent finished',
        proxyServerId: proxy.id,
        applyRecordId: initial.id.toString(),
        status,
        httpStatus: push.status,
        error: push.error,
        result: push.result,
      });
      const desiredHash =
        push.result?.configHash ??
        compositeHash(
          desired.engines.map((engine) => [
            engine.engine,
            engine.configHash ?? null,
          ]),
        );

      if (push.ok) {
        await this.prisma.$transaction(async (tx) => {
          for (const engine of desired.engines) {
            await tx.proxyCoreState.upsert({
              where: {
                proxyServerId_engine: {
                  proxyServerId: proxy.id,
                  engine: engine.engine,
                },
              },
              create: {
                proxyServerId: proxy.id,
                engine: engine.engine,
                desiredRevision: desired.revision,
                appliedRevision: desired.revision,
                appliedConfigHash: engine.configHash ?? null,
                configPath: this.configPaths[engine.engine],
                lastApplyRecordId: initial.id,
                appliedAt: completedAt,
              },
              update: {
                desiredRevision: desired.revision,
                appliedRevision: desired.revision,
                appliedConfigHash: engine.configHash ?? null,
                configPath: this.configPaths[engine.engine],
                lastApplyRecordId: initial.id,
                appliedAt: completedAt,
              },
            });
            await tx.inbound.updateMany({
              where: {
                proxyServerId: proxy.id,
                engine: engine.engine,
                needsApply: true,
              },
              data: { needsApply: false },
            });
          }
        });
      }

      const record = await this.prisma.coreApplyRecord.update({
        where: { id: initial.id },
        data: {
          status,
          desiredHash,
          configChecksum: desiredHash,
          configRevision: desired.revision,
          errorMessage: push.error,
          appliedAt: push.ok ? completedAt : null,
          completedAt,
          engineResults: Object.fromEntries(
            desired.engines.map((engine) => [
              engine.engine,
              {
                status: push.ok ? 'SUCCEEDED' : 'FAILED',
                hash: engine.configHash ?? null,
                previousHash: null,
                error: push.ok ? null : push.error,
                rollbackOutcome: 'NOT_REQUIRED',
              } satisfies CoreApplyEngineResult,
            ]),
          ),
        },
      });
      const result = this.toSummary(record);
      await this.recordApplyAudit(actor, metadata, input.reason, result);
      await this.notifyFailure(trigger, result);
      return result;
    } catch (error: unknown) {
      const message = errorMessage(error);
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

  private async buildAgentDesired(proxy: ProxyServer): Promise<{
    proxyServerId: string;
    revision: number;
    engines: Array<{
      engine: CoreEngine;
      enabled: boolean;
      config: unknown;
      configHash?: string;
    }>;
  }> {
    const enabled = asEngineList(proxy.enabledEngines);
    const providers = this.registry
      .all()
      .filter(
        (provider) => enabled.length === 0 || enabled.includes(provider.engine),
      );
    let revision = 0;
    const engines: Array<{
      engine: CoreEngine;
      enabled: boolean;
      config: unknown;
      configHash?: string;
    }> = [];
    for (const provider of providers) {
      const state = await this.stateLoader.load(provider.engine, {
        proxyServerId: proxy.id,
      });
      revision = Math.max(revision, state.desiredRevision);
      const rendered = provider.renderConfig(state);
      engines.push({
        engine: provider.engine,
        enabled: true,
        config: rendered.config,
        configHash: rendered.hash,
      });
    }
    return { proxyServerId: proxy.id, revision, engines };
  }

  private async applyLocal(
    actor: AuthenticatedAdmin | null,
    input: ConfigApplyRequest,
    trigger: CoreApplyTrigger,
    metadata: RequestMetadata,
    options: CoreApplyOptions,
  ): Promise<CoreApplySummary> {
    const startedAt = new Date();
    const initial = await this.prisma.coreApplyRecord.create({
      data: {
        status: 'APPLYING',
        trigger,
        reason: input.reason,
        initiatedByAdminId: actor?.id ?? null,
        proxyServerId: options.proxyServerId ?? null,
        startedAt,
      },
    });
    let secretValues: string[] = [];
    try {
      const result = await this.lock.withLock(async (assertOwned) => {
        const providers = this.registry.all();
        const engineResults: Partial<Record<CoreEngine, EngineApplyOutcome>> =
          {};

        for (const provider of providers) {
          assertOwned();
          const outcome = await this.applyEngine(
            provider,
            assertOwned,
            options.proxyServerId,
          );
          engineResults[provider.engine] = outcome;
          secretValues = [
            ...secretValues,
            ...(outcome.rendered?.secretValues ?? []),
          ];
        }

        const mappedResults = toStoredEngineResults(engineResults);
        // desiredHash is sha256 of sorted "ENGINE=hash" lines across all engines.
        const desiredHash = compositeHash(
          Object.entries(engineResults).map(([engine, outcome]) => [
            engine,
            outcome.rendered?.hash ?? outcome.hash,
          ]),
        );
        const previousHash = compositeHash(
          Object.entries(engineResults).map(([engine, outcome]) => [
            engine,
            outcome.previousHash,
          ]),
        );
        const primary =
          engineResults.SING_BOX ??
          engineResults[providers[0]?.engine ?? 'SING_BOX'];
        const status = aggregateApplyStatus(engineResults);
        const completedAt = new Date();
        const errorMessage = aggregateError(engineResults);
        const rollbackOutcome = aggregateRollback(engineResults);

        if (status === 'FAILED' || status === 'ROLLED_BACK') {
          const record = await this.prisma.coreApplyRecord.update({
            where: { id: initial.id },
            data: {
              status,
              desiredHash,
              configChecksum: desiredHash,
              previousHash,
              configRevision: primary?.configRevision ?? null,
              configPath: primary?.configPath ?? null,
              diffSummary:
                (primary?.diffSummary as Prisma.InputJsonValue) ?? undefined,
              errorMessage,
              rollbackOutcome,
              engineResults: mappedResults,
              completedAt,
            },
          });
          return this.toSummary(record);
        }

        const succeededEngines = Object.entries(engineResults).filter(
          ([, outcome]) => outcome.status === 'SUCCEEDED',
        );
        const allSucceeded = status === 'SUCCEEDED';

        const record = await this.prisma.$transaction(async (tx) => {
          for (const [engine, outcome] of succeededEngines) {
            if (
              !outcome.state ||
              !outcome.rendered ||
              outcome.configRevision === null
            ) {
              continue;
            }
            await this.markInboundRevisionsApplied(tx, outcome.state);
            await tx.coreState.upsert({
              where: { id: coreStateId(engine as CoreEngine) },
              create: {
                id: coreStateId(engine as CoreEngine),
                desiredRevision: outcome.state.desiredRevision,
                appliedRevision: outcome.configRevision,
                appliedConfigHash: outcome.rendered.hash,
                configPath: outcome.configPath,
                lastApplyRecordId: initial.id,
                appliedAt: outcome.appliedAt,
              },
              update: {
                appliedRevision: outcome.configRevision,
                appliedConfigHash: outcome.rendered.hash,
                configPath: outcome.configPath,
                lastApplyRecordId: initial.id,
                appliedAt: outcome.appliedAt,
              },
            });
            if (options.proxyServerId) {
              await tx.proxyCoreState.upsert({
                where: {
                  proxyServerId_engine: {
                    proxyServerId: options.proxyServerId,
                    engine: engine as CoreEngine,
                  },
                },
                create: {
                  proxyServerId: options.proxyServerId,
                  engine: engine as CoreEngine,
                  desiredRevision: outcome.state.desiredRevision,
                  appliedRevision: outcome.configRevision,
                  appliedConfigHash: outcome.rendered.hash,
                  configPath: outcome.configPath,
                  lastApplyRecordId: initial.id,
                  appliedAt: outcome.appliedAt,
                },
                update: {
                  appliedRevision: outcome.configRevision,
                  appliedConfigHash: outcome.rendered.hash,
                  configPath: outcome.configPath,
                  lastApplyRecordId: initial.id,
                  appliedAt: outcome.appliedAt,
                },
              });
            }
          }

          if (allSucceeded) {
            const userRevisions = uniqueUserRevisions(
              succeededEngines.map(([, outcome]) => outcome.state),
            );
            await this.markUserRevisionsApplied(tx, userRevisions);
            await tx.coreApplyRecord.updateMany({
              where: {
                id: { not: initial.id },
                status: 'PENDING',
                createdAt: { lte: startedAt },
              },
              data: {
                status: 'SUCCEEDED',
                desiredHash,
                configChecksum: desiredHash,
                previousHash,
                configRevision: primary?.configRevision ?? null,
                configPath: primary?.configPath ?? null,
                appliedAt: primary?.appliedAt ?? completedAt,
                completedAt,
                metadata: {
                  reconciledByApplyRecordId: initial.id,
                },
              },
            });
          }

          return tx.coreApplyRecord.update({
            where: { id: initial.id },
            data: {
              status,
              desiredHash,
              configChecksum: desiredHash,
              previousHash,
              configRevision: primary?.configRevision ?? null,
              configPath: primary?.configPath ?? null,
              diffSummary:
                (primary?.diffSummary as Prisma.InputJsonValue) ?? undefined,
              errorMessage,
              rollbackOutcome,
              engineResults: mappedResults,
              appliedAt: allSucceeded
                ? (primary?.appliedAt ?? completedAt)
                : (succeededEngines[0]?.[1].appliedAt ?? null),
              completedAt,
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
      ...(query.proxyServerId ? { proxyServerId: query.proxyServerId } : {}),
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

  private async previewEngine(
    provider: EngineProvider,
    proxyServerId?: string,
  ): Promise<ConfigPreviewEngine> {
    const state = await this.stateLoader.load(provider.engine, {
      proxyServerId,
    });
    const rendered = provider.renderConfig(state);
    const validation = await provider.validate(rendered);
    const current = proxyServerId
      ? await this.currentRedactedForProxy(provider.engine, proxyServerId)
      : await this.currentRedacted(provider.engine);
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

  private async applyEngine(
    provider: EngineProvider,
    assertOwned: () => void,
    proxyServerId?: string,
  ): Promise<EngineApplyOutcome> {
    const path = this.configPathFor(provider.engine);
    try {
      const state = await this.stateLoader.load(provider.engine, {
        proxyServerId,
      });
      const rendered = provider.renderConfig(state);
      const current = await this.currentRedacted(provider.engine);
      const diff = unifiedDiff(
        current.canonical,
        rendered.redactedCanonical,
        'current-redacted.json',
        'desired-redacted.json',
      );
      const diffSummary = summarizeDiff(diff);
      const currentState = proxyServerId
        ? await this.prisma.proxyCoreState.findUnique({
            where: {
              proxyServerId_engine: {
                proxyServerId,
                engine: provider.engine,
              },
            },
          })
        : await this.prisma.coreState.findUnique({
            where: { id: coreStateId(provider.engine) },
          });
      const configRevision = (currentState?.appliedRevision ?? 0) + 1;

      const validation = await provider.validate(rendered);
      if (!validation.valid) {
        return {
          status: 'FAILED',
          hash: rendered.hash,
          previousHash: current.hash,
          error: `${provider.engine} validation failed: ${validation.error ?? 'unknown validation error'}`,
          rollbackOutcome: 'NOT_REQUIRED',
          appliedAt: null,
          completedAt: new Date(),
          configPath: path,
          configRevision,
          diffSummary,
          state,
          rendered,
        };
      }

      assertOwned();
      const applied = await provider.apply(rendered);
      assertOwned();
      return {
        status: applied.status,
        hash: applied.desiredHash,
        previousHash: applied.previousHash,
        error: applied.error,
        rollbackOutcome: applied.rollbackOutcome,
        appliedAt: applied.appliedAt,
        completedAt: applied.completedAt,
        configPath: path,
        configRevision,
        diffSummary,
        state,
        rendered,
      };
    } catch (error: unknown) {
      return {
        status: 'FAILED',
        hash: null,
        previousHash: null,
        error: `${provider.engine} apply failed: ${errorMessage(error)}`,
        rollbackOutcome: 'NOT_REQUIRED',
        appliedAt: null,
        completedAt: new Date(),
        configPath: path,
        configRevision: null,
        diffSummary: null,
        state: null,
        rendered: null,
      };
    }
  }

  private async currentRedacted(engine: CoreEngine): Promise<{
    hash: string | null;
    canonical: string;
    path: string;
  }> {
    const path = this.configPathFor(engine);
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

  /** Remote nodes have no panel-local config file; compare against last applied hash. */
  private async currentRedactedForProxy(
    engine: CoreEngine,
    proxyServerId: string,
  ): Promise<{
    hash: string | null;
    canonical: string;
    path: string;
  }> {
    const path = this.configPathFor(engine);
    const state = await this.prisma.proxyCoreState.findUnique({
      where: {
        proxyServerId_engine: { proxyServerId, engine },
      },
    });
    const hash = state?.appliedConfigHash ?? null;
    return {
      hash,
      canonical: hash ? `{"_appliedHash":"${hash}"}\n` : '{}\n',
      path,
    };
  }

  private async markInboundRevisionsApplied(
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
  }

  private async markUserRevisionsApplied(
    tx: Prisma.TransactionClient,
    userRevisions: Array<{ id: string; revision: number }>,
  ): Promise<void> {
    for (const user of userRevisions) {
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
        engineResults: result.engineResults ?? null,
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
      engineResults: parseEngineResults(record.engineResults),
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
      engineResults: parseEngineResults(record.engineResults),
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

function emptyPreview(): ConfigPreviewEngine {
  return {
    valid: false,
    hash: '0'.repeat(64),
    previousHash: null,
    config: {},
    diff: '',
    validationError: 'No core engines registered',
  };
}

/**
 * Composite apply hash: sha256 of sorted "ENGINE=hash" lines.
 * Missing hashes use the literal "null".
 */
function compositeHash(
  entries: Array<[string, string | null | undefined]>,
): string {
  const lines = entries
    .map(([engine, hash]) => `${engine}=${hash ?? 'null'}`)
    .sort((left, right) => left.localeCompare(right));
  return sha256(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
}

function toStoredEngineResults(
  results: Partial<Record<CoreEngine, EngineApplyOutcome>>,
): Record<string, CoreApplyEngineResult> {
  const stored: Record<string, CoreApplyEngineResult> = {};
  for (const [engine, outcome] of Object.entries(results)) {
    if (!outcome) {
      continue;
    }
    stored[engine] = {
      status: outcome.status,
      hash: outcome.hash,
      previousHash: outcome.previousHash,
      error: outcome.error,
      rollbackOutcome: outcome.rollbackOutcome,
    };
  }
  return stored;
}

function parseEngineResults(
  value: Prisma.JsonValue | null,
): CoreApplySummary['engineResults'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function aggregateApplyStatus(
  results: Partial<Record<CoreEngine, EngineApplyOutcome>>,
): CoreApplyStatus {
  const statuses = Object.values(results).map((result) => result.status);
  if (statuses.length === 0) {
    return 'FAILED';
  }
  const succeeded = statuses.filter((status) => status === 'SUCCEEDED').length;
  const rolledBack = statuses.filter(
    (status) => status === 'ROLLED_BACK',
  ).length;
  if (succeeded === statuses.length) {
    return 'SUCCEEDED';
  }
  if (succeeded > 0) {
    return 'PARTIAL_SUCCEEDED';
  }
  if (rolledBack === statuses.length) {
    return 'ROLLED_BACK';
  }
  return 'FAILED';
}

function aggregateError(
  results: Partial<Record<CoreEngine, EngineApplyOutcome>>,
): string | null {
  const errors = Object.values(results)
    .map((result) => result.error)
    .filter((error): error is string => Boolean(error));
  return errors.length > 0 ? errors.join('; ') : null;
}

function aggregateRollback(
  results: Partial<Record<CoreEngine, EngineApplyOutcome>>,
): string | null {
  const outcomes = Object.values(results).map(
    (result) => result.rollbackOutcome,
  );
  if (
    outcomes.every((outcome) => outcome === 'NOT_REQUIRED' || outcome === null)
  ) {
    return 'NOT_REQUIRED';
  }
  if (outcomes.some((outcome) => outcome === 'FAILED')) {
    return 'FAILED';
  }
  if (outcomes.some((outcome) => outcome === 'SUCCEEDED')) {
    return 'SUCCEEDED';
  }
  return (
    outcomes.find((outcome): outcome is string => Boolean(outcome)) ?? null
  );
}

function uniqueUserRevisions(
  states: Array<CoreDesiredState | null>,
): Array<{ id: string; revision: number }> {
  const byId = new Map<string, number>();
  for (const state of states) {
    if (!state) {
      continue;
    }
    for (const user of state.userRevisions) {
      byId.set(user.id, user.revision);
    }
  }
  return [...byId.entries()]
    .map(([id, revision]) => ({ id, revision }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decryptNodeToken(
  settings: Prisma.JsonValue,
  encryption: SecretEncryptionService,
): string | null {
  if (
    settings === null ||
    typeof settings !== 'object' ||
    Array.isArray(settings)
  ) {
    return null;
  }
  const encrypted = (settings as Record<string, unknown>)[
    NODE_TOKEN_SETTINGS_KEY
  ];
  if (typeof encrypted !== 'string' || encrypted.length === 0) {
    return null;
  }
  try {
    return encryption.decrypt(encrypted);
  } catch {
    return null;
  }
}

function asEngineList(value: Prisma.JsonValue): CoreEngine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is CoreEngine =>
      item === 'SING_BOX' || item === 'XRAY' || item === 'MTPROXY',
  );
}
