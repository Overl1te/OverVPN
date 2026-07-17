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
  type OnlineClientsResult,
  type AssignmentCredential,
  type RenderedCoreConfig,
  type TrafficSnapshotResult,
} from './core-provider';
import { localizeCoreHealthError } from './core-user-messages';

@Injectable()
export class MtproxyProvider extends EngineProvider {
  readonly engine = 'MTPROXY' as const;

  private readonly configPath: string;
  private readonly lastKnownGoodPath: string;
  private readonly healthTimeoutMs: number;
  private readonly heartbeatPath: string;
  private readonly heartbeatMaxAgeSeconds: number;

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

  getTrafficSnapshot(): Promise<TrafficSnapshotResult> {
    return Promise.resolve({
      supported: false,
      capturedAt: new Date(),
      error: {
        code: 'UNSUPPORTED',
        message: 'MTProxy traffic accounting is not supported',
        messageRu: 'Учёт трафика MTProxy не поддерживается',
      },
    });
  }

  getOnlineClients(): Promise<OnlineClientsResult> {
    return Promise.resolve({
      capturedAt: new Date(),
      clients: [],
      partial: false,
      warnings: [],
    });
  }

  private renderInbound(
    inbound: DesiredMtproxyInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const users = inbound.assignments.map((assignment) => {
      const secret = passwordFrom(assignment.credential);
      secretValues.add(secret);
      return {
        name: assignment.credentialName || assignment.userId,
        secret,
      };
    });
    return {
      id: inbound.id,
      tag: inbound.tag,
      listenHost: inbound.listenHost,
      listenPort: inbound.listenPort,
      secretMode: inbound.config.secretMode,
      tlsDomain: inbound.config.tlsDomain,
      users,
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
