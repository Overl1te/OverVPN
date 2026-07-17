import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { CoreFileSystem, MtproxyReloadHandshakeAdapter } from './core-adapters';
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
  type DesiredMtproxyInbound,
  EngineProvider,
  type JsonObject,
  type OnlineClient,
  type OnlineClientsResult,
  type AssignmentCredential,
  type RenderedCoreConfig,
  type TrafficCounter,
  type TrafficSnapshotResult,
} from './core-provider';
import { localizeCoreHealthError } from './core-user-messages';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RuntimeStatsUser {
  username: string;
  currentConnections: number;
  totalOctets: number;
  activeIps: string[];
}

interface RuntimeStatsInbound {
  tag: string;
  listenPort?: number | null;
  apiPort?: number | null;
  users: RuntimeStatsUser[];
  warning?: string;
}

interface RuntimeStatsSnapshot {
  version: number;
  capturedAt: string;
  useMiddleProxy?: boolean;
  inbounds: RuntimeStatsInbound[];
}

@Injectable()
export class MtproxyProvider extends EngineProvider {
  readonly engine = 'MTPROXY' as const;

  private readonly configPath: string;
  private readonly lastKnownGoodPath: string;
  private readonly healthTimeoutMs: number;
  private readonly heartbeatPath: string;
  private readonly heartbeatMaxAgeSeconds: number;
  private readonly runtimeStatsPath: string;
  private readonly runtimeStatsMaxAgeSeconds: number;
  private readonly portMin: number;
  private readonly apiPortBase: number;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly fileSystem: CoreFileSystem,
    private readonly reloadHandshake: MtproxyReloadHandshakeAdapter,
  ) {
    super();
    this.configPath = config.get('MTPROXY_CONFIG_PATH', { infer: true });
    this.lastKnownGoodPath = config.get('MTPROXY_LAST_KNOWN_GOOD_PATH', {
      infer: true,
    });
    this.healthTimeoutMs = config.get('MTPROXY_HEALTH_TIMEOUT_MS', {
      infer: true,
    });
    this.heartbeatPath = config.get('MTPROXY_HEARTBEAT_PATH', { infer: true });
    this.heartbeatMaxAgeSeconds = config.get(
      'MTPROXY_HEARTBEAT_MAX_AGE_SECONDS',
      {
        infer: true,
      },
    );
    this.runtimeStatsPath = config.get('MTPROXY_RUNTIME_STATS_PATH', {
      infer: true,
    });
    this.runtimeStatsMaxAgeSeconds = config.get(
      'MTPROXY_RUNTIME_STATS_MAX_AGE_SECONDS',
      { infer: true },
    );
    this.portMin = config.get('MTPROXY_PORT_MIN', { infer: true });
    this.apiPortBase = config.get('MTPROXY_API_PORT_BASE', { infer: true });
  }

  renderConfig(state: CoreDesiredState): RenderedCoreConfig {
    if (state.engine !== this.engine) {
      throw new Error(
        `MtproxyProvider cannot render ${state.engine} desired state`,
      );
    }
    const secretValues = new Set<string>();
    // Telemt rejects configs with zero users (`No users configured` → exit 1).
    // Keep empty inbounds out of the runtime config until someone is assigned.
    const inbounds = [...state.inbounds]
      .filter(
        (inbound): inbound is DesiredMtproxyInbound =>
          inbound.protocol === 'MTPROXY' && inbound.assignments.length > 0,
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
      throw new Error('Rendered MTProxy configuration root must be an object');
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
        if (!Array.isArray(inbound.users)) {
          return Promise.resolve(
            invalidValidation('inbound.users must be an array'),
          );
        }
      }
      return Promise.resolve({
        valid: true,
        command: 'mtproxy-config-validate',
        args: [],
        exitCode: 0,
        timedOut: false,
        error: null,
      });
    } catch (error: unknown) {
      return Promise.resolve({
        valid: false,
        command: 'mtproxy-config-validate',
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
        error: `Could not read current MTProxy configuration: ${redactText(
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
          error: `mtproxy apply failed before replacing current config: ${applyMessage}`,
        });
      }
      const rollbackStartedAt = new Date();
      try {
        await this.fileSystem.atomicWrite(this.configPath, previous);
        await this.reloadHandshake.requestReload(previousHash);
        await this.verifyHealthy();
        return completed('ROLLED_BACK', previousHash, {
          error: `mtproxy apply failed and the previous config was restored: ${applyMessage}`,
          rollbackOutcome: 'SUCCEEDED',
          rollbackStartedAt,
          rollbackCompletedAt: new Date(),
        });
      } catch (rollbackError: unknown) {
        return completed('FAILED', previousHash, {
          error: `mtproxy apply failed: ${applyMessage}; rollback reload/verification failed: ${redactText(
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
        version: 'mtproxy',
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
            message: 'MTProxy runtime stats are not available yet',
            messageRu: 'Статистика MTProxy пока недоступна',
          },
        };
      }
      const counters: TrafficCounter[] = [];
      for (const inbound of snapshot.inbounds) {
        for (const user of inbound.users) {
          if (!uuidPattern.test(user.username)) {
            continue;
          }
          // Telemt exposes a single bidirectional octet counter.
          counters.push({
            engine: 'MTPROXY',
            scope: 'user',
            key: user.username.toLowerCase(),
            uplinkBytes: '0',
            downlinkBytes: String(Math.max(0, Math.trunc(user.totalOctets))),
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
          message: `MTProxy traffic query failed: ${errorMessage(error)}`,
          messageRu: `Ошибка запроса трафика MTProxy: ${errorMessage(error)}`,
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
          warnings: ['MTProxy runtime stats are not available yet'],
        };
      }
      const clients: OnlineClient[] = [];
      const warnings: string[] = [];
      for (const inbound of snapshot.inbounds) {
        if (inbound.warning) {
          warnings.push(`${inbound.tag}: ${inbound.warning}`);
        }
        for (const user of inbound.users) {
          if (user.currentConnections <= 0) {
            continue;
          }
          const panelUserId = uuidPattern.test(user.username)
            ? user.username.toLowerCase()
            : null;
          const ips =
            user.activeIps.length > 0
              ? user.activeIps
              : [null as string | null];
          for (const ip of ips) {
            clients.push({
              engine: 'MTPROXY',
              connectionId: `mtproxy:${inbound.tag}:${user.username}:${ip ?? 'unknown'}`,
              panelUserId,
              userName: user.username,
              inboundTag: inbound.tag,
              ipAddress: ip,
              device: null,
              network: 'tcp',
              connectedAt: null,
              lastSeenAt: parseCapturedAt(snapshot.capturedAt),
              uploadBytes: null,
              downloadBytes: String(Math.max(0, Math.trunc(user.totalOctets))),
            });
          }
        }
      }
      return {
        capturedAt: parseCapturedAt(snapshot.capturedAt) ?? capturedAt,
        clients,
        partial: warnings.length > 0,
        warnings,
      };
    } catch (error: unknown) {
      return {
        capturedAt,
        clients: [],
        partial: true,
        warnings: [`MTProxy online query failed: ${errorMessage(error)}`],
      };
    }
  }

  private renderInbound(
    inbound: DesiredMtproxyInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const users = inbound.assignments.map((assignment) => {
      const secret = passwordFrom(assignment.credential);
      secretValues.add(secret);
      const user: JsonObject = {
        name: assignment.credentialName || assignment.userId,
        secret,
      };
      if (
        typeof assignment.maxUniqueIps === 'number' &&
        assignment.maxUniqueIps > 0
      ) {
        user.maxUniqueIps = assignment.maxUniqueIps;
      }
      return user;
    });
    return {
      id: inbound.id,
      tag: inbound.tag,
      listenHost: inbound.listenHost,
      listenPort: inbound.listenPort,
      apiPort: this.apiPortForListenPort(inbound.listenPort),
      secretMode: inbound.config.secretMode,
      tlsDomain: inbound.config.tlsDomain,
      users,
    };
  }

  private apiPortForListenPort(listenPort: number): number {
    const offset = listenPort - this.portMin;
    const apiPort = this.apiPortBase + offset;
    if (apiPort < 1 || apiPort > 65_535) {
      throw new Error(
        `MTProxy API port ${apiPort} derived from listen port ${listenPort} is out of range`,
      );
    }
    return apiPort;
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
      const usersRaw = Array.isArray(inbound.users) ? inbound.users : [];
      const users: RuntimeStatsUser[] = [];
      for (const userEntry of usersRaw) {
        if (
          !userEntry ||
          typeof userEntry !== 'object' ||
          Array.isArray(userEntry)
        ) {
          continue;
        }
        const user = userEntry as Record<string, unknown>;
        const username =
          typeof user.username === 'string' ? user.username.trim() : '';
        if (!username) {
          continue;
        }
        users.push({
          username,
          currentConnections: nonnegativeInt(user.currentConnections),
          totalOctets: nonnegativeInt(user.totalOctets),
          activeIps: Array.isArray(user.activeIps)
            ? user.activeIps.filter(
                (ip): ip is string => typeof ip === 'string' && ip.length > 0,
              )
            : [],
        });
      }
      inbounds.push({
        tag,
        listenPort:
          typeof inbound.listenPort === 'number' ? inbound.listenPort : null,
        apiPort: typeof inbound.apiPort === 'number' ? inbound.apiPort : null,
        users,
        warning:
          typeof inbound.warning === 'string' ? inbound.warning : undefined,
      });
    }
    return {
      version: 1,
      capturedAt,
      useMiddleProxy:
        typeof root.useMiddleProxy === 'boolean'
          ? root.useMiddleProxy
          : undefined,
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
      `MTProxy supervisor health check timed out after ${this.healthTimeoutMs}ms`,
    );
  }
}

function passwordFrom(credential: AssignmentCredential): string {
  if (!('password' in credential) || typeof credential.password !== 'string') {
    throw new Error('MTProxy assignment credential must include password');
  }
  return credential.password;
}

function compareByTagAndId(
  left: { tag: string; id: string },
  right: { tag: string; id: string },
): number {
  return left.tag.localeCompare(right.tag) || left.id.localeCompare(right.id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidValidation(message: string) {
  return {
    valid: false,
    command: 'mtproxy-config-validate',
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
