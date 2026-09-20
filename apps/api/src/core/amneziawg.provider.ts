import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import {
  AmneziawgReloadHandshakeAdapter,
  CoreFileSystem,
} from './core-adapters';
import {
  canonicalizeJson,
  redactJson,
  redactText,
  sha256,
} from './core-config-utils';
import {
  type CoreDesiredState,
  type CoreHealthResult,
  type CoreProviderApplyResult,
  type CoreValidationResult,
  type DesiredAmneziawgInbound,
  EngineProvider,
  type JsonObject,
  type OnlineClient,
  type OnlineClientsResult,
  type RenderedCoreConfig,
  type TrafficCounter,
  type TrafficSnapshotResult,
} from './core-provider';
import { localizeCoreHealthError } from './core-user-messages';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RuntimeStatsPeer {
  publicKey: string;
  userId?: string;
  rxBytes: number;
  txBytes: number;
  lastHandshakeEpoch?: number | null;
  endpoint?: string | null;
}

interface RuntimeStatsInbound {
  tag: string;
  listenPort?: number | null;
  peers: RuntimeStatsPeer[];
}

interface RuntimeStatsSnapshot {
  version: number;
  capturedAt: string;
  inbounds: RuntimeStatsInbound[];
}

@Injectable()
export class AmneziawgProvider extends EngineProvider {
  readonly engine = 'AMNEZIAWG' as const;

  private readonly configPath: string;
  private readonly lastKnownGoodPath: string;
  private readonly healthTimeoutMs: number;
  private readonly heartbeatPath: string;
  private readonly heartbeatMaxAgeSeconds: number;
  private readonly runtimeStatsPath: string;
  private readonly runtimeStatsMaxAgeSeconds: number;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly fileSystem: CoreFileSystem,
    private readonly reloadHandshake: AmneziawgReloadHandshakeAdapter,
  ) {
    super();
    this.configPath = config.get('AMNEZIAWG_CONFIG_PATH', { infer: true });
    this.lastKnownGoodPath = config.get('AMNEZIAWG_LAST_KNOWN_GOOD_PATH', {
      infer: true,
    });
    this.healthTimeoutMs = config.get('AMNEZIAWG_HEALTH_TIMEOUT_MS', {
      infer: true,
    });
    this.heartbeatPath = config.get('AMNEZIAWG_HEARTBEAT_PATH', {
      infer: true,
    });
    this.heartbeatMaxAgeSeconds = config.get(
      'AMNEZIAWG_HEARTBEAT_MAX_AGE_SECONDS',
      { infer: true },
    );
    this.runtimeStatsPath = config.get('AMNEZIAWG_RUNTIME_STATS_PATH', {
      infer: true,
    });
    this.runtimeStatsMaxAgeSeconds = config.get(
      'AMNEZIAWG_RUNTIME_STATS_MAX_AGE_SECONDS',
      { infer: true },
    );
  }

  renderConfig(state: CoreDesiredState): RenderedCoreConfig {
    if (state.engine !== this.engine) {
      throw new Error(
        `AmneziawgProvider cannot render ${state.engine} desired state`,
      );
    }
    const secretValues = new Set<string>();
    const inbounds = [...state.inbounds]
      .filter(
        (inbound): inbound is DesiredAmneziawgInbound =>
          inbound.protocol === 'AMNEZIAWG',
      )
      .sort(compareByTagAndId)
      .map((inbound) => this.renderInbound(inbound, secretValues));
    const rendered: JsonObject = {
      version: 1,
      inbounds,
    };
    const canonical = canonicalizeJson(rendered);
    const redacted = redactJson(rendered);
    if (!redacted || Array.isArray(redacted) || typeof redacted !== 'object') {
      throw new Error(
        'Rendered AmneziaWG configuration root must be an object',
      );
    }
    return {
      config: rendered,
      canonical,
      redactedConfig: redacted,
      redactedCanonical: canonicalizeJson(redacted),
      hash: sha256(canonical),
      secretValues: [...secretValues],
    };
  }

  validate(config: RenderedCoreConfig): Promise<CoreValidationResult> {
    try {
      const parsed = JSON.parse(config.canonical) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return Promise.resolve(
          invalidValidation('config root must be an object'),
        );
      }
      const root = parsed as Record<string, unknown>;
      if (root.version !== 1) {
        return Promise.resolve(invalidValidation('config.version must be 1'));
      }
      if (!Array.isArray(root.inbounds)) {
        return Promise.resolve(
          invalidValidation('config.inbounds must be an array'),
        );
      }
      for (const entry of root.inbounds) {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          Array.isArray(entry)
        ) {
          return Promise.resolve(
            invalidValidation('inbound entry must be an object'),
          );
        }
        const inbound = entry as Record<string, unknown>;
        if (typeof inbound.tag !== 'string' || !inbound.tag) {
          return Promise.resolve(invalidValidation('inbound.tag is required'));
        }
        if (typeof inbound.listenPort !== 'number') {
          return Promise.resolve(
            invalidValidation('inbound.listenPort is required'),
          );
        }
        if (typeof inbound.privateKey !== 'string' || !inbound.privateKey) {
          return Promise.resolve(
            invalidValidation('inbound.privateKey is required'),
          );
        }
        if (!Array.isArray(inbound.peers)) {
          return Promise.resolve(
            invalidValidation('inbound.peers must be an array'),
          );
        }
      }
      return Promise.resolve({
        valid: true,
        command: 'amneziawg-config-validate',
        args: [],
        exitCode: 0,
        timedOut: false,
        error: null,
      });
    } catch (error: unknown) {
      return Promise.resolve({
        valid: false,
        command: 'amneziawg-config-validate',
        args: [],
        exitCode: null,
        timedOut: false,
        error: redactText(errorMessage(error), config.secretValues),
      });
    }
  }

  async apply(config: RenderedCoreConfig): Promise<CoreProviderApplyResult> {
    const completed = (
      status: CoreProviderApplyResult['status'],
      previousHash: string | null,
      options: {
        appliedAt?: Date | null;
        error?: string | null;
        rollbackOutcome?: CoreProviderApplyResult['rollbackOutcome'];
        rollbackStartedAt?: Date | null;
        rollbackCompletedAt?: Date | null;
      } = {},
    ): CoreProviderApplyResult => ({
      status,
      desiredHash: config.hash,
      previousHash,
      appliedAt: options.appliedAt ?? null,
      completedAt: new Date(),
      error: options.error ?? null,
      rollbackOutcome: options.rollbackOutcome ?? 'NOT_REQUIRED',
      rollbackStartedAt: options.rollbackStartedAt ?? null,
      rollbackCompletedAt: options.rollbackCompletedAt ?? null,
    });

    let previous: Buffer;
    try {
      previous = await this.fileSystem.read(this.configPath);
    } catch (error: unknown) {
      return completed('FAILED', null, {
        error: `Could not read current AmneziaWG configuration: ${redactText(
          errorMessage(error),
          config.secretValues,
        )}`,
      });
    }
    const previousHash = sha256(previous);
    const candidatePath = join(
      dirname(this.configPath),
      `.config.${randomUUID()}.apply.json`,
    );
    let wroteCurrent = false;
    try {
      await this.fileSystem.atomicWrite(candidatePath, config.canonical);
      await this.fileSystem.atomicWrite(this.lastKnownGoodPath, previous);
      await this.fileSystem.replace(candidatePath, this.configPath);
      wroteCurrent = true;
      await this.reloadHandshake.requestReload(config.hash);
      await this.verifyHealthy();
      return completed('SUCCEEDED', previousHash, {
        appliedAt: new Date(),
      });
    } catch (applyError: unknown) {
      const applyMessage = redactText(
        errorMessage(applyError),
        config.secretValues,
      );
      if (!wroteCurrent) {
        return completed('FAILED', previousHash, {
          error: `amneziawg apply failed before replacing current config: ${applyMessage}`,
        });
      }
      const rollbackStartedAt = new Date();
      try {
        await this.fileSystem.atomicWrite(this.configPath, previous);
        await this.reloadHandshake.requestReload(previousHash);
        await this.verifyHealthy();
        return completed('ROLLED_BACK', previousHash, {
          error: `amneziawg apply failed and the previous config was restored: ${applyMessage}`,
          rollbackOutcome: 'SUCCEEDED',
          rollbackStartedAt,
          rollbackCompletedAt: new Date(),
        });
      } catch (rollbackError: unknown) {
        return completed('FAILED', previousHash, {
          error: `amneziawg apply failed: ${applyMessage}; rollback reload/verification failed: ${redactText(
            errorMessage(rollbackError),
            config.secretValues,
          )}`,
          rollbackOutcome: 'FAILED',
          rollbackStartedAt,
          rollbackCompletedAt: new Date(),
        });
      }
    } finally {
      await this.fileSystem.remove(candidatePath).catch(() => undefined);
    }
  }

  async health(): Promise<CoreHealthResult> {
    const checkedAt = new Date();
    const started = performance.now();
    try {
      await this.verifyHealthy();
      return {
        healthy: true,
        version: 'amneziawg',
        latencyMs: Math.round(performance.now() - started),
        checkedAt,
        error: null,
        errorRu: null,
      };
    } catch (error: unknown) {
      const localized = localizeCoreHealthError(errorMessage(error));
      return {
        healthy: false,
        version: null,
        latencyMs: Math.round(performance.now() - started),
        checkedAt,
        error: localized.en,
        errorRu: localized.ru,
      };
    }
  }

  async getTrafficSnapshot(): Promise<TrafficSnapshotResult> {
    const capturedAt = new Date();
    try {
      const snapshot = await this.readRuntimeStats();
      if (!snapshot) {
        return {
          supported: false,
          capturedAt,
          error: {
            code: 'UNAVAILABLE',
            message: 'AmneziaWG runtime stats are not available yet',
            messageRu: 'Статистика AmneziaWG пока недоступна',
          },
        };
      }
      const counters: TrafficCounter[] = [];
      for (const inbound of snapshot.inbounds) {
        for (const peer of inbound.peers) {
          const key =
            peer.userId && uuidPattern.test(peer.userId)
              ? peer.userId.toLowerCase()
              : null;
          if (!key) {
            continue;
          }
          counters.push({
            engine: 'AMNEZIAWG',
            scope: 'user',
            key,
            uplinkBytes: String(Math.max(0, Math.trunc(peer.txBytes))),
            downlinkBytes: String(Math.max(0, Math.trunc(peer.rxBytes))),
          });
        }
      }
      return {
        supported: true,
        capturedAt: parseCapturedAt(snapshot.capturedAt) ?? capturedAt,
        counters,
      };
    } catch (error: unknown) {
      return {
        supported: false,
        capturedAt,
        error: {
          code: 'QUERY_FAILED',
          message: `AmneziaWG traffic query failed: ${errorMessage(error)}`,
          messageRu: `Ошибка запроса трафика AmneziaWG: ${errorMessage(error)}`,
        },
      };
    }
  }

  async getOnlineClients(): Promise<OnlineClientsResult> {
    const capturedAt = new Date();
    try {
      const snapshot = await this.readRuntimeStats();
      if (!snapshot) {
        return {
          capturedAt,
          clients: [],
          partial: true,
          warnings: ['AmneziaWG runtime stats are not available yet'],
        };
      }
      const clients: OnlineClient[] = [];
      for (const inbound of snapshot.inbounds) {
        for (const peer of inbound.peers) {
          if (!peer.userId || !uuidPattern.test(peer.userId)) {
            continue;
          }
          if (!peer.lastHandshakeEpoch) {
            continue;
          }
          clients.push({
            engine: 'AMNEZIAWG',
            connectionId: `amneziawg:${inbound.tag}:${peer.publicKey}`,
            panelUserId: peer.userId.toLowerCase(),
            userName: peer.userId,
            inboundTag: inbound.tag,
            ipAddress: peer.endpoint?.split(':')[0] ?? null,
            device: null,
            network: 'udp',
            connectedAt: null,
            lastSeenAt: new Date(peer.lastHandshakeEpoch * 1000),
            uploadBytes: String(Math.max(0, Math.trunc(peer.txBytes))),
            downloadBytes: String(Math.max(0, Math.trunc(peer.rxBytes))),
          });
        }
      }
      return { capturedAt, clients, partial: false, warnings: [] };
    } catch (error: unknown) {
      return {
        capturedAt,
        clients: [],
        partial: true,
        warnings: [`AmneziaWG online query failed: ${errorMessage(error)}`],
      };
    }
  }

  private renderInbound(
    inbound: DesiredAmneziawgInbound,
    secretValues: Set<string>,
  ): JsonObject {
    secretValues.add(inbound.secrets.privateKey);
    const peers = inbound.assignments
      .sort((left, right) => compareStrings(left.userId, right.userId))
      .map((assignment) => {
        secretValues.add(assignment.credential.publicKey);
        return {
          publicKey: assignment.credential.publicKey,
          allowedIps: [assignment.credential.address],
          userId: assignment.userId,
        };
      });
    return {
      id: inbound.id,
      tag: inbound.tag,
      listenPort: inbound.listenPort,
      privateKey: inbound.secrets.privateKey,
      address: inbound.config.address,
      mtu: inbound.config.mtu,
      jc: inbound.config.jc,
      jmin: inbound.config.jmin,
      jmax: inbound.config.jmax,
      s1: inbound.config.s1,
      s2: inbound.config.s2,
      s3: inbound.config.s3,
      s4: inbound.config.s4,
      h1: inbound.config.h1,
      h2: inbound.config.h2,
      h3: inbound.config.h3,
      h4: inbound.config.h4,
      i1: inbound.config.i1,
      i2: inbound.config.i2,
      i3: inbound.config.i3,
      i4: inbound.config.i4,
      i5: inbound.config.i5,
      peers,
    };
  }

  private async readRuntimeStats(): Promise<RuntimeStatsSnapshot | null> {
    let raw: Buffer;
    try {
      raw = await this.fileSystem.read(this.runtimeStatsPath);
    } catch {
      return null;
    }
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const root = parsed as Record<string, unknown>;
    if (root.version !== 1 || !Array.isArray(root.inbounds)) {
      return null;
    }
    const capturedAt =
      typeof root.capturedAt === 'string' ? root.capturedAt : '';
    const captured = parseCapturedAt(capturedAt);
    if (captured) {
      const ageSeconds = (Date.now() - captured.getTime()) / 1000;
      if (ageSeconds > this.runtimeStatsMaxAgeSeconds) {
        return null;
      }
    }
    const inbounds: RuntimeStatsInbound[] = [];
    for (const entry of root.inbounds) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const inbound = entry as Record<string, unknown>;
      const tag = typeof inbound.tag === 'string' ? inbound.tag : '';
      if (!tag) {
        continue;
      }
      const peersRaw = Array.isArray(inbound.peers) ? inbound.peers : [];
      const peers: RuntimeStatsPeer[] = [];
      for (const peerEntry of peersRaw) {
        if (
          !peerEntry ||
          typeof peerEntry !== 'object' ||
          Array.isArray(peerEntry)
        ) {
          continue;
        }
        const peer = peerEntry as Record<string, unknown>;
        const publicKey =
          typeof peer.publicKey === 'string' ? peer.publicKey.trim() : '';
        if (!publicKey) {
          continue;
        }
        peers.push({
          publicKey,
          userId: typeof peer.userId === 'string' ? peer.userId : undefined,
          rxBytes: nonnegativeInt(peer.rxBytes),
          txBytes: nonnegativeInt(peer.txBytes),
          lastHandshakeEpoch:
            typeof peer.lastHandshakeEpoch === 'number'
              ? peer.lastHandshakeEpoch
              : null,
          endpoint: typeof peer.endpoint === 'string' ? peer.endpoint : null,
        });
      }
      inbounds.push({
        tag,
        listenPort:
          typeof inbound.listenPort === 'number' ? inbound.listenPort : null,
        peers,
      });
    }
    return {
      version: 1,
      capturedAt,
      inbounds,
    };
  }

  private async verifyHealthy(): Promise<void> {
    const deadline = Date.now() + this.healthTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const raw = (await this.fileSystem.read(this.heartbeatPath))
          .toString('utf8')
          .trim();
        const epochSeconds = Number.parseFloat(raw);
        if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
          const ageSeconds = Date.now() / 1000 - epochSeconds;
          if (ageSeconds >= 0 && ageSeconds <= this.heartbeatMaxAgeSeconds) {
            return;
          }
        }
      } catch {
        // retry until deadline
      }
      await delay(100);
    }
    throw new Error(
      `AmneziaWG supervisor health check timed out after ${this.healthTimeoutMs}ms`,
    );
  }
}

function compareByTagAndId(
  left: { tag: string; id: string },
  right: { tag: string; id: string },
): number {
  return left.tag.localeCompare(right.tag) || left.id.localeCompare(right.id);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidValidation(message: string) {
  return {
    valid: false,
    command: 'amneziawg-config-validate',
    args: [] as string[],
    exitCode: 1,
    timedOut: false,
    error: message,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nonnegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return 0;
}

function parseCapturedAt(value: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
