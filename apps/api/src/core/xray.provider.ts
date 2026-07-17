import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import {
  CoreFileSystem,
  ProcessAdapter,
  XrayReloadHandshakeAdapter,
} from './core-adapters';
import {
  canonicalizeJson,
  redactJson,
  redactText,
  sha256,
} from './core-config-utils';
import {
  type CoreDesiredState,
  type AssignmentCredential,
  type CoreHealthResult,
  type CoreProviderApplyResult,
  type DesiredInbound,
  type DesiredShadowsocksXrayInbound,
  type DesiredTrojanTlsInbound,
  type DesiredVlessGrpcTlsInbound,
  type DesiredVlessTcpTlsInbound,
  type DesiredVlessXhttpTlsInbound,
  type DesiredWireguardInbound,
  EngineProvider,
  type JsonObject,
  type OnlineClient,
  type OnlineClientsResult,
  type RenderedCoreConfig,
  type TrafficCounter,
  type TrafficSnapshotResult,
  type VlessXhttpTlsInboundSecrets,
} from './core-provider';
import {
  localizeCoreHealthError,
  localizeCoreStatsError,
} from './core-user-messages';
import {
  type RawXrayStat,
  type RawXrayUserStat,
  XrayStatsAdapter,
} from './xray-stats.adapter';

@Injectable()
export class XrayProvider extends EngineProvider {
  readonly engine = 'XRAY' as const;

  private readonly binaryPath: string;
  private readonly configPath: string;
  private readonly lastKnownGoodPath: string;
  private readonly processTimeoutMs: number;
  private readonly reloadTimeoutMs: number;
  private readonly apiListen: string;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly processAdapter: ProcessAdapter,
    private readonly fileSystem: CoreFileSystem,
    private readonly reloadHandshake: XrayReloadHandshakeAdapter,
    private readonly stats: XrayStatsAdapter,
  ) {
    super();
    this.binaryPath = config.get('XRAY_BINARY_PATH', { infer: true });
    this.configPath = config.get('XRAY_CONFIG_PATH', { infer: true });
    this.lastKnownGoodPath = config.get('XRAY_LAST_KNOWN_GOOD_PATH', {
      infer: true,
    });
    this.processTimeoutMs = config.get('XRAY_PROCESS_TIMEOUT_MS', {
      infer: true,
    });
    this.reloadTimeoutMs = config.get('XRAY_RELOAD_TIMEOUT_MS', {
      infer: true,
    });
    this.apiListen = config.get('XRAY_API_LISTEN', { infer: true });
  }

  renderConfig(state: CoreDesiredState): RenderedCoreConfig {
    if (state.engine !== this.engine) {
      throw new Error(
        `XrayProvider cannot render ${state.engine} desired state`,
      );
    }
    const secretValues = new Set<string>();
    const inbounds = [...state.inbounds]
      .sort(compareByTagAndId)
      .map((inbound) => this.renderInbound(inbound, secretValues));

    const rendered: JsonObject = {
      log: {
        loglevel: 'warning',
      },
      stats: {},
      api: {
        tag: 'api',
        listen: this.apiListen,
        services: ['StatsService'],
      },
      policy: {
        levels: {
          '0': {
            statsUserUplink: true,
            statsUserDownlink: true,
            statsUserOnline: true,
          },
        },
        system: {
          statsInboundUplink: true,
          statsInboundDownlink: true,
          statsOutboundUplink: true,
          statsOutboundDownlink: true,
        },
      },
      inbounds,
      outbounds: [
        { protocol: 'freedom', tag: 'direct' },
        { protocol: 'blackhole', tag: 'blocked' },
        { protocol: 'freedom', tag: 'api' },
      ],
      routing: {
        rules: [
          {
            type: 'field',
            inboundTag: ['api'],
            outboundTag: 'api',
          },
          {
            type: 'field',
            ip: ['geoip:private'],
            outboundTag: 'blocked',
          },
        ],
      },
    };
    const canonical = canonicalizeJson(rendered);
    const redacted = redactJson(rendered);
    if (!redacted || Array.isArray(redacted) || typeof redacted !== 'object') {
      throw new Error('Rendered Xray configuration root must be an object');
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

  async validate(config: RenderedCoreConfig) {
    const candidatePath = join(
      dirname(this.configPath),
      `.config.${randomUUID()}.candidate.json`,
    );
    const args = ['run', '-test', '-config', candidatePath] as const;
    try {
      await this.fileSystem.atomicWrite(candidatePath, config.canonical);
      const result = await this.processAdapter.run(
        this.binaryPath,
        args,
        this.processTimeoutMs,
      );
      const valid = result.exitCode === 0 && !result.timedOut;
      const rawError = result.timedOut
        ? `xray validation timed out after ${this.processTimeoutMs}ms`
        : valid
          ? null
          : result.stderr.trim() ||
            result.stdout.trim() ||
            `xray run -test exited with code ${String(result.exitCode)}`;
      return {
        valid,
        command: this.binaryPath,
        args: [...args],
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        error: rawError ? redactText(rawError, config.secretValues) : null,
      };
    } catch (error: unknown) {
      return {
        valid: false,
        command: this.binaryPath,
        args: [...args],
        exitCode: null,
        timedOut: false,
        error: redactText(errorMessage(error), config.secretValues),
      };
    } finally {
      await this.fileSystem.remove(candidatePath).catch(() => undefined);
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
        error: `Could not read current Xray configuration: ${redactText(
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
          error: `xray apply failed before replacing current config: ${applyMessage}`,
        });
      }
      const rollbackStartedAt = new Date();
      try {
        await this.fileSystem.atomicWrite(this.configPath, previous);
        await this.reloadHandshake.requestReload(previousHash);
        await this.verifyHealthy();
        return completed('ROLLED_BACK', previousHash, {
          error: `xray apply failed and the previous config was restored: ${applyMessage}`,
          rollbackOutcome: 'SUCCEEDED',
          rollbackStartedAt,
          rollbackCompletedAt: new Date(),
        });
      } catch (rollbackError: unknown) {
        return completed('FAILED', previousHash, {
          error: `xray apply failed: ${applyMessage}; rollback reload/verification failed: ${redactText(
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
      await this.stats.queryStats('');
      return {
        healthy: true,
        version: 'xray',
        latencyMs: roundLatency(performance.now() - started),
        checkedAt,
        error: null,
        errorRu: null,
      };
    } catch (primaryError: unknown) {
      try {
        await this.stats.getUsersStats();
        return {
          healthy: true,
          version: 'xray',
          latencyMs: roundLatency(performance.now() - started),
          checkedAt,
          error: null,
          errorRu: null,
        };
      } catch {
        const localized = localizeCoreHealthError(errorMessage(primaryError));
        return {
          healthy: false,
          version: null,
          latencyMs: roundLatency(performance.now() - started),
          checkedAt,
          error: localized.en,
          errorRu: localized.ru,
        };
      }
    }
  }

  async getTrafficSnapshot(): Promise<TrafficSnapshotResult> {
    const capturedAt = new Date();
    try {
      const raw = await this.stats.queryStats('');
      return {
        supported: true,
        capturedAt,
        counters: aggregateTrafficCounters(raw),
      };
    } catch (error: unknown) {
      const code = numericErrorCode(error);
      const errorCode =
        code === 12
          ? 'UNSUPPORTED'
          : code === 14 || code === 4
            ? 'UNAVAILABLE'
            : 'QUERY_FAILED';
      const localized = localizeCoreStatsError(errorCode, errorMessage(error));
      return {
        supported: false,
        capturedAt,
        error: {
          code: errorCode,
          message: localized.en,
          messageRu: localized.ru,
        },
      };
    }
  }

  async getOnlineClients(): Promise<OnlineClientsResult> {
    const capturedAt = new Date();
    const inboundTag = null;
    try {
      const users = await this.stats.getUsersStats();
      return {
        capturedAt,
        clients: usersToOnlineClients(users, inboundTag),
        partial: false,
        warnings: [],
      };
    } catch (primaryError: unknown) {
      try {
        const raw = await this.stats.queryStats('');
        return {
          capturedAt,
          clients: onlineCountersToClients(raw, inboundTag),
          partial: true,
          warnings: [
            `GetUsersStats failed; fell back to QueryStats online counters: ${errorMessage(primaryError)}`,
          ],
        };
      } catch (fallbackError: unknown) {
        return {
          capturedAt,
          clients: [],
          partial: true,
          warnings: [
            `Xray online clients query failed: ${errorMessage(primaryError)}; fallback also failed: ${errorMessage(fallbackError)}`,
          ],
        };
      }
    }
  }

  private renderInbound(
    inbound: DesiredInbound,
    secretValues: Set<string>,
  ): JsonObject {
    if (inbound.protocol === 'VLESS_XHTTP_TLS') {
      return this.renderVlessXhttpTlsInbound(inbound, secretValues);
    }
    if (inbound.protocol === 'VLESS_GRPC_TLS') {
      return this.renderVlessGrpcTlsInbound(inbound, secretValues);
    }
    if (inbound.protocol === 'VLESS_TCP_TLS') {
      return this.renderVlessTcpTlsInbound(inbound, secretValues);
    }
    if (inbound.protocol === 'TROJAN_TLS') {
      return this.renderTrojanTlsInbound(inbound, secretValues);
    }
    if (inbound.protocol === 'SHADOWSOCKS_XRAY') {
      return this.renderShadowsocksInbound(inbound, secretValues);
    }
    if (inbound.protocol === 'WIREGUARD_XRAY') {
      return this.renderWireguardInbound(inbound, secretValues);
    }
    throw new Error(
      `XrayProvider cannot render ${inbound.protocol} inbound ${inbound.id}`,
    );
  }

  private renderVlessClients(
    inbound: DesiredInbound,
    secretValues: Set<string>,
    flow?: string,
  ): JsonObject[] {
    return inbound.assignments
      .sort((left, right) => compareStrings(left.userId, right.userId))
      .map((assignment) => {
        const uuid = uuidFrom(assignment.credential);
        secretValues.add(uuid);
        const client: JsonObject = {
          id: uuid,
          email: assignment.userId,
        };
        if (flow) {
          client.flow = flow;
        }
        return client;
      });
  }

  private renderVlessXhttpTlsInbound(
    inbound: DesiredVlessXhttpTlsInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const config = inbound.config;
    const clients = this.renderVlessClients(inbound, secretValues);

    const xhttpSettings: JsonObject = {
      path: config.path,
      mode: config.mode,
    };
    if (config.host) {
      xhttpSettings.host = config.host;
    }

    const tlsSettings: JsonObject = {
      serverName: config.tls.sni,
      alpn: ['h2', 'http/1.1'],
      certificates: [
        this.renderTlsCertificate(
          inbound.tag,
          config.tls,
          inbound.secrets,
          secretValues,
        ),
      ],
    };

    return {
      listen: inbound.listenHost,
      port: inbound.listenPort,
      protocol: 'vless',
      tag: inbound.tag,
      settings: {
        clients,
        decryption: 'none',
      },
      streamSettings: {
        network: 'xhttp',
        security: 'tls',
        xhttpSettings,
        tlsSettings,
      },
    };
  }

  private renderVlessGrpcTlsInbound(
    inbound: DesiredVlessGrpcTlsInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const config = inbound.config;
    const clients = this.renderVlessClients(inbound, secretValues);
    const tlsSettings: JsonObject = {
      serverName: config.tls.sni,
      alpn: ['h2'],
      certificates: [
        this.renderTlsCertificate(
          inbound.tag,
          config.tls,
          inbound.secrets,
          secretValues,
        ),
      ],
    };

    return {
      listen: inbound.listenHost,
      port: inbound.listenPort,
      protocol: 'vless',
      tag: inbound.tag,
      settings: {
        clients,
        decryption: 'none',
      },
      streamSettings: {
        network: 'grpc',
        security: 'tls',
        grpcSettings: {
          serviceName: config.serviceName,
        },
        tlsSettings,
      },
    };
  }

  private renderVlessTcpTlsInbound(
    inbound: DesiredVlessTcpTlsInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const config = inbound.config;
    const clients = this.renderVlessClients(
      inbound,
      secretValues,
      config.flow || undefined,
    );
    const tlsSettings: JsonObject = {
      serverName: config.tls.sni,
      alpn: ['h2', 'http/1.1'],
      certificates: [
        this.renderTlsCertificate(
          inbound.tag,
          config.tls,
          inbound.secrets,
          secretValues,
        ),
      ],
    };

    return {
      listen: inbound.listenHost,
      port: inbound.listenPort,
      protocol: 'vless',
      tag: inbound.tag,
      settings: {
        clients,
        decryption: 'none',
      },
      streamSettings: {
        network: 'tcp',
        security: 'tls',
        tlsSettings,
      },
    };
  }

  private renderTrojanTlsInbound(
    inbound: DesiredTrojanTlsInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const clients = inbound.assignments.map((assignment) => {
      const password = passwordFrom(assignment.credential);
      secretValues.add(password);
      return { password, email: assignment.userId };
    });
    const tlsSettings: JsonObject = {
      serverName: inbound.config.tls.sni,
      alpn: ['h2', 'http/1.1'],
      certificates: [
        this.renderTlsCertificate(
          inbound.tag,
          inbound.config.tls,
          inbound.secrets,
          secretValues,
        ),
      ],
    };
    const settings: JsonObject = { clients };
    if (inbound.config.fallback) {
      settings.fallbacks = [
        {
          dest: `${inbound.config.fallback.server}:${inbound.config.fallback.serverPort}`,
        },
      ];
    }
    return {
      listen: inbound.listenHost,
      port: inbound.listenPort,
      protocol: 'trojan',
      tag: inbound.tag,
      settings,
      streamSettings: {
        network: 'tcp',
        security: 'tls',
        tlsSettings,
      },
    };
  }

  private renderShadowsocksInbound(
    inbound: DesiredShadowsocksXrayInbound,
    secretValues: Set<string>,
  ): JsonObject {
    secretValues.add(inbound.secrets.serverPassword);
    const clients = inbound.assignments.map((assignment) => {
      const password = passwordFrom(assignment.credential);
      secretValues.add(password);
      return { password, email: assignment.userId };
    });
    return {
      listen: inbound.listenHost,
      port: inbound.listenPort,
      protocol: 'shadowsocks',
      tag: inbound.tag,
      settings: {
        method: inbound.config.method,
        password: inbound.secrets.serverPassword,
        clients,
        network: 'tcp,udp',
      },
    };
  }

  private renderWireguardInbound(
    inbound: DesiredWireguardInbound,
    secretValues: Set<string>,
  ): JsonObject {
    secretValues.add(inbound.secrets.privateKey);
    const peers = inbound.assignments.map((assignment) => {
      secretValues.add(assignment.credential.publicKey);
      return {
        publicKey: assignment.credential.publicKey,
        allowedIPs: [assignment.credential.address],
      };
    });
    return {
      listen: inbound.listenHost,
      port: inbound.listenPort,
      protocol: 'wireguard',
      tag: inbound.tag,
      settings: {
        secretKey: inbound.secrets.privateKey,
        address: [inbound.config.address],
        peers,
        mtu: inbound.config.mtu,
        noKernelTun: true,
      },
    };
  }

  private renderTlsCertificate(
    tag: string,
    tls: {
      certificatePath: string | null;
      keyPath: string | null;
    },
    secrets: VlessXhttpTlsInboundSecrets,
    secretValues: Set<string>,
  ): JsonObject {
    if (tls.certificatePath && tls.keyPath) {
      return {
        certificateFile: tls.certificatePath,
        keyFile: tls.keyPath,
      };
    }
    const certificatePem = requiredSecret(
      secrets.certificatePem,
      `${tag} TLS certificate PEM`,
    );
    const privateKeyPem = requiredSecret(
      secrets.privateKeyPem,
      `${tag} TLS private key PEM`,
    );
    secretValues.add(certificatePem);
    secretValues.add(privateKeyPem);
    return {
      certificate: pemToLines(certificatePem),
      key: pemToLines(privateKeyPem),
    };
  }

  private async verifyHealthy(): Promise<void> {
    const deadline = Date.now() + this.reloadTimeoutMs;
    let lastError = 'unknown health error';
    while (Date.now() < deadline) {
      const health = await this.health();
      if (health.healthy) {
        return;
      }
      lastError = health.error ?? lastError;
      await delay(200);
    }
    throw new Error(
      `xray did not become healthy within ${this.reloadTimeoutMs}ms: ${lastError}`,
    );
  }
}

function compareByTagAndId(
  left: DesiredInbound,
  right: DesiredInbound,
): number {
  return (
    compareStrings(left.tag, right.tag) || compareStrings(left.id, right.id)
  );
}

function uuidFrom(credential: AssignmentCredential): string {
  if (!('uuid' in credential)) {
    throw new Error('Expected a VLESS UUID credential');
  }
  return credential.uuid;
}

function passwordFrom(credential: AssignmentCredential): string {
  if (!('password' in credential)) {
    throw new Error('Expected a password credential');
  }
  return credential.password;
}

function requiredSecret(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing encrypted ${label}`);
  }
  return value;
}

function pemToLines(pem: string): string[] {
  return pem.replace(/\r\n/g, '\n').trimEnd().split('\n');
}

function aggregateTrafficCounters(raw: RawXrayStat[]): TrafficCounter[] {
  const counters = new Map<
    string,
    {
      scope: TrafficCounter['scope'];
      key: string;
      uplinkBytes?: bigint;
      downlinkBytes?: bigint;
    }
  >();
  for (const stat of raw) {
    const match =
      /^(user|inbound|outbound)>>>(.+)>>>traffic>>>(uplink|downlink)$/.exec(
        stat.name,
      );
    if (!match) {
      continue;
    }
    const [, scope, key, direction] = match as unknown as [
      string,
      TrafficCounter['scope'],
      string,
      'uplink' | 'downlink',
    ];
    let value: bigint;
    try {
      value = BigInt(stat.value);
    } catch {
      continue;
    }
    const mapKey = `${scope}\0${key}`;
    const entry = counters.get(mapKey) ?? { scope, key };
    if (direction === 'uplink') {
      entry.uplinkBytes = value;
    } else {
      entry.downlinkBytes = value;
    }
    counters.set(mapKey, entry);
  }
  return [...counters.values()]
    .sort(
      (left, right) =>
        compareStrings(left.scope, right.scope) ||
        compareStrings(left.key, right.key),
    )
    .map((counter) => ({
      engine: 'XRAY',
      scope: counter.scope,
      key: counter.key,
      uplinkBytes: (counter.uplinkBytes ?? 0n).toString(),
      downlinkBytes: (counter.downlinkBytes ?? 0n).toString(),
    }));
}

function usersToOnlineClients(
  users: RawXrayUserStat[],
  inboundTag: string | null,
): OnlineClient[] {
  return users
    .flatMap((user) =>
      user.ips.map((entry) => ({
        engine: 'XRAY' as const,
        connectionId: `xray:online:${user.email}:${entry.ip}`,
        panelUserId: uuidPattern.test(user.email)
          ? user.email.toLowerCase()
          : null,
        userName: user.email,
        inboundTag,
        ipAddress: entry.ip,
        device: null,
        network: null,
        connectedAt: null,
        lastSeenAt: unixSecondsToDate(entry.lastSeenUnixSeconds),
        uploadBytes: user.uplinkBytes,
        downloadBytes: user.downlinkBytes,
      })),
    )
    .sort(
      (left, right) =>
        compareStrings(left.connectionId, right.connectionId) ||
        compareStrings(left.userName ?? '', right.userName ?? ''),
    );
}

function onlineCountersToClients(
  raw: RawXrayStat[],
  inboundTag: string | null,
): OnlineClient[] {
  const clients: OnlineClient[] = [];
  for (const stat of raw) {
    const match = /^user>>>(.+)>>>online$/.exec(stat.name);
    if (!match) {
      continue;
    }
    const email = match[1] ?? '';
    let onlineCount: bigint;
    try {
      onlineCount = BigInt(stat.value);
    } catch {
      continue;
    }
    if (onlineCount <= 0n) {
      continue;
    }
    clients.push({
      engine: 'XRAY',
      connectionId: `xray:online:${email}`,
      panelUserId: uuidPattern.test(email) ? email.toLowerCase() : null,
      userName: email,
      inboundTag,
      ipAddress: null,
      device: null,
      network: null,
      connectedAt: null,
      lastSeenAt: null,
      uploadBytes: null,
      downloadBytes: null,
    });
  }
  return clients.sort((left, right) =>
    compareStrings(left.connectionId, right.connectionId),
  );
}

function unixSecondsToDate(value: string): Date | null {
  try {
    const seconds = BigInt(value);
    if (seconds <= 0n) {
      return null;
    }
    return new Date(Number(seconds) * 1000);
  } catch {
    return null;
  }
}

function numericErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function roundLatency(value: number): number {
  return Math.round(value * 100) / 100;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
