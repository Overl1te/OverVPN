import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { CoreEngine } from '@overvpn/shared/constants';
import type {
  AgentApplyResult,
  AgentDesiredState,
  AgentHeartbeatRequest,
  AgentRegisterRequest,
  AgentRegisterResponse,
  AgentStatsRequest,
} from '@overvpn/shared/schemas';
import { hashOpaqueToken, SecretEncryptionService } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import { CoreEngineRegistry } from '../core/core-engine.registry';
import { CoreStateLoader } from '../core/core-state.loader';
import type { Prisma, ProxyServer } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { NODE_TOKEN_SETTINGS_KEY } from '../proxy-servers/proxy-server-secrets';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
    private readonly stateLoader: CoreStateLoader,
    private readonly registry: CoreEngineRegistry,
  ) {}

  async register(
    proxyServer: ProxyServer,
    input: AgentRegisterRequest,
  ): Promise<AgentRegisterResponse> {
    const nodeToken = randomBytes(32).toString('base64url');
    const settings = mergeSettings(proxyServer.settings, {
      [NODE_TOKEN_SETTINGS_KEY]: this.encryption.encrypt(nodeToken),
      hostname: input.hostname,
      ...(input.agentVersion ? { agentVersion: input.agentVersion } : {}),
    });

    const updated = await this.prisma.proxyServer.update({
      where: { id: proxyServer.id },
      data: {
        status: 'ONLINE',
        agentBaseUrl: input.agentBaseUrl,
        nodeTokenHash: hashOpaqueToken(nodeToken),
        installTokenHash: null,
        installTokenExpiresAt: null,
        lastSeenAt: new Date(),
        lastError: null,
        capabilities: (input.capabilities ??
          proxyServer.capabilities) as Prisma.InputJsonValue,
        settings: settings as Prisma.InputJsonValue,
      },
    });

    this.logger.log({
      msg: 'Agent registered',
      proxyServerId: updated.id,
      hostname: input.hostname,
      agentVersion: input.agentVersion ?? null,
      agentBaseUrl: input.agentBaseUrl,
      heartbeatIntervalSec: updated.heartbeatIntervalSec,
      status: updated.status,
    });

    return {
      proxyServerId: updated.id,
      nodeToken,
      heartbeatIntervalSec: updated.heartbeatIntervalSec,
      status: updated.status,
    };
  }

  async heartbeat(
    proxyServer: ProxyServer,
    input: AgentHeartbeatRequest,
  ): Promise<{ ok: true; status: ProxyServer['status'] }> {
    const settings = mergeSettings(proxyServer.settings, {
      lastHeartbeat: {
        engines: input.engines,
        load: input.load ?? null,
        at: new Date().toISOString(),
      },
    });
    const updated = await this.prisma.proxyServer.update({
      where: { id: proxyServer.id },
      data: {
        status: input.status,
        lastSeenAt: new Date(),
        lastError: input.errorMessage ?? null,
        settings: settings as Prisma.InputJsonValue,
      },
    });
    this.logger.log({
      msg: 'Agent heartbeat',
      proxyServerId: proxyServer.id,
      status: input.status,
      engines: input.engines,
      load: input.load ?? null,
      errorMessage: input.errorMessage ?? null,
    });
    return { ok: true, status: updated.status };
  }

  async stats(
    proxyServer: ProxyServer,
    input: AgentStatsRequest,
  ): Promise<{ ok: true }> {
    const settings = mergeSettings(proxyServer.settings, {
      lastStats: {
        collectedAt: input.collectedAt,
        trafficCount: input.traffic.length,
        onlineCount: input.online.length,
        receivedAt: new Date().toISOString(),
      },
    });
    await this.prisma.proxyServer.update({
      where: { id: proxyServer.id },
      data: {
        lastSeenAt: new Date(),
        settings: settings as Prisma.InputJsonValue,
      },
    });
    this.logger.log({
      msg: 'Agent stats accepted',
      proxyServerId: proxyServer.id,
      collectedAt: input.collectedAt,
      trafficCount: input.traffic.length,
      onlineCount: input.online.length,
      online: input.online.slice(0, 50),
      trafficSample: input.traffic.slice(0, 20),
    });
    return { ok: true };
  }

  async desired(proxyServer: ProxyServer): Promise<AgentDesiredState> {
    const desired = await this.buildDesiredState(
      proxyServer.id,
      proxyServer.enabledEngines,
    );
    this.logger.log({
      msg: 'Agent desired state served',
      proxyServerId: proxyServer.id,
      revision: desired.revision,
      engines: desired.engines.map((engine) => ({
        engine: engine.engine,
        enabled: engine.enabled,
        configHash: engine.configHash ?? null,
      })),
    });
    return desired;
  }

  async applyResult(
    proxyServer: ProxyServer,
    input: AgentApplyResult,
  ): Promise<{ ok: true }> {
    const appliedAt = new Date();
    this.logger.log({
      msg: 'Agent apply-result received',
      proxyServerId: proxyServer.id,
      revision: input.revision,
      success: input.success,
      configHash: input.configHash ?? null,
      errorMessage: input.errorMessage ?? null,
      engineResults: input.engineResults,
    });
    await this.prisma.$transaction(async (tx) => {
      for (const engineResult of input.engineResults) {
        const succeeded = input.success && engineResult.success;
        const configPath = defaultConfigPath(engineResult.engine);
        await tx.proxyCoreState.upsert({
          where: {
            proxyServerId_engine: {
              proxyServerId: proxyServer.id,
              engine: engineResult.engine,
            },
          },
          create: {
            proxyServerId: proxyServer.id,
            engine: engineResult.engine,
            desiredRevision: input.revision,
            appliedRevision: succeeded ? input.revision : 0,
            appliedConfigHash: succeeded ? (input.configHash ?? null) : null,
            configPath,
            appliedAt: succeeded ? appliedAt : null,
          },
          update: succeeded
            ? {
                desiredRevision: input.revision,
                appliedRevision: input.revision,
                appliedConfigHash: input.configHash ?? null,
                appliedAt,
                configPath,
              }
            : {
                desiredRevision: input.revision,
                configPath,
              },
        });
      }

      await tx.proxyServer.update({
        where: { id: proxyServer.id },
        data: {
          lastSeenAt: appliedAt,
          lastError: input.success
            ? null
            : (input.errorMessage ?? 'Agent apply failed'),
          status: input.success ? 'ONLINE' : 'ERROR',
        },
      });
    });
    return { ok: true };
  }

  async buildDesiredState(
    proxyServerId: string,
    enabledEnginesJson?: Prisma.JsonValue,
  ): Promise<AgentDesiredState> {
    const proxy = await this.prisma.proxyServer.findUnique({
      where: { id: proxyServerId },
      select: { id: true, enabledEngines: true },
    });
    if (!proxy) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
        reason: 'proxy_server_not_found',
      });
    }

    const enabled = asEngineList(enabledEnginesJson ?? proxy.enabledEngines);
    const providers = this.registry
      .all()
      .filter(
        (provider) => enabled.length === 0 || enabled.includes(provider.engine),
      );

    let revision = 0;
    const engines: AgentDesiredState['engines'] = [];
    for (const provider of providers) {
      const state = await this.stateLoader.load(provider.engine, {
        proxyServerId,
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

    return {
      proxyServerId,
      revision,
      engines,
    };
  }
}

function mergeSettings(
  current: Prisma.JsonValue,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  return { ...base, ...patch };
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

function defaultConfigPath(engine: CoreEngine): string {
  switch (engine) {
    case 'SING_BOX':
      return '/var/lib/sing-box/config.json';
    case 'XRAY':
      return '/var/lib/xray/config.json';
    case 'MTPROXY':
      return '/var/lib/mtproxy/config.json';
    default: {
      const _exhaustive: never = engine;
      throw new Error(`Unsupported engine: ${String(_exhaustive)}`);
    }
  }
}
