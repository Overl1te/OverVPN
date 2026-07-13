import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import {
  CoreFileSystem,
  CoreHttpAdapter,
  ProcessAdapter,
  ReloadHandshakeAdapter,
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
  type DesiredHysteria2Inbound,
  type DesiredInbound,
  type DesiredShadowsocksInbound,
  type DesiredTrojanInbound,
  type DesiredVlessRealityInbound,
  EngineProvider,
  type JsonObject,
  type OnlineClient,
  type OnlineClientsResult,
  type PasswordCredential,
  type RenderedCoreConfig,
  type TrafficCounter,
  type TrafficSnapshotResult,
  type VlessCredential,
} from './core-provider';
import {
  localizeCoreHealthError,
  localizeCoreStatsError,
} from './core-user-messages';
import { type RawV2RayStat, V2RayStatsAdapter } from './v2ray-stats.adapter';

@Injectable()
export class SingBoxProvider extends EngineProvider {
  readonly engine = 'SING_BOX' as const;

  private readonly binaryPath: string;
  private readonly configPath: string;
  private readonly lastKnownGoodPath: string;
  private readonly processTimeoutMs: number;
  private readonly reloadTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly clashApiUrl: string;
  private readonly clashApiListen: string;
  private readonly clashApiSecret: string;
  private readonly v2rayApiListen: string;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly processAdapter: ProcessAdapter,
    private readonly fileSystem: CoreFileSystem,
    private readonly reloadHandshake: ReloadHandshakeAdapter,
    private readonly http: CoreHttpAdapter,
    private readonly stats: V2RayStatsAdapter,
  ) {
    super();
    this.binaryPath = config.get('SING_BOX_BINARY_PATH', { infer: true });
    this.configPath = config.get('SING_BOX_CONFIG_PATH', { infer: true });
    this.lastKnownGoodPath = config.get('SING_BOX_LAST_KNOWN_GOOD_PATH', {
      infer: true,
    });
    this.processTimeoutMs = config.get('SING_BOX_PROCESS_TIMEOUT_MS', {
      infer: true,
    });
    this.reloadTimeoutMs = config.get('SING_BOX_RELOAD_TIMEOUT_MS', {
      infer: true,
    });
    this.healthTimeoutMs = config.get('SING_BOX_HEALTH_TIMEOUT_MS', {
      infer: true,
    });
    this.clashApiUrl = config
      .get('SING_BOX_CLASH_API_URL', { infer: true })
      .replace(/\/+$/, '');
    this.clashApiListen = config.get('SING_BOX_CLASH_API_LISTEN', {
      infer: true,
    });
    this.clashApiSecret = config.get('SING_BOX_CLASH_API_SECRET', {
      infer: true,
    });
    this.v2rayApiListen = config.get('SING_BOX_V2RAY_API_LISTEN', {
      infer: true,
    });
  }

  renderConfig(state: CoreDesiredState): RenderedCoreConfig {
    if (state.engine !== this.engine) {
      throw new Error(
        `SingBoxProvider cannot render ${state.engine} desired state`,
      );
    }
    const secretValues = new Set<string>([this.clashApiSecret]);
    const inbounds = [...state.inbounds]
      .sort(compareByTagAndId)
      .map((inbound) => this.renderInbound(inbound, secretValues));
    const userNames = [
      ...new Set(
        state.inbounds.flatMap((inbound) =>
          inbound.assignments.map((assignment) => assignment.userId),
        ),
      ),
    ].sort();
    const inboundTags = state.inbounds.map((inbound) => inbound.tag).sort();

    const rendered: JsonObject = {
      log: {
        disabled: false,
        level: 'info',
        timestamp: true,
      },
      dns: {
        servers: [
          {
            type: 'local',
            tag: 'local',
            prefer_go: true,
          },
        ],
        final: 'local',
        strategy: 'prefer_ipv4',
      },
      inbounds,
      outbounds: [
        { type: 'direct', tag: 'direct' },
        { type: 'block', tag: 'block' },
      ],
      route: {
        final: 'direct',
        auto_detect_interface: true,
        rules: [
          {
            ip_is_private: true,
            outbound: 'block',
          },
        ],
      },
      experimental: {
        clash_api: {
          external_controller: this.clashApiListen,
          secret: this.clashApiSecret,
          access_control_allow_origin: [],
          access_control_allow_private_network: false,
        },
        v2ray_api: {
          listen: this.v2rayApiListen,
          stats: {
            enabled: true,
            inbounds: inboundTags,
            outbounds: ['block', 'direct'],
            users: userNames,
          },
        },
      },
    };
    const canonical = canonicalizeJson(rendered);
    const redacted = redactJson(rendered);
    if (!redacted || Array.isArray(redacted) || typeof redacted !== 'object') {
      throw new Error('Rendered sing-box configuration root must be an object');
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
    const args = ['check', '-c', candidatePath] as const;
    try {
      await this.fileSystem.atomicWrite(candidatePath, config.canonical);
      const result = await this.processAdapter.run(
        this.binaryPath,
        args,
        this.processTimeoutMs,
      );
      const valid = result.exitCode === 0 && !result.timedOut;
      const rawError = result.timedOut
        ? `sing-box validation timed out after ${this.processTimeoutMs}ms`
        : valid
          ? null
          : result.stderr.trim() ||
            result.stdout.trim() ||
            `sing-box check exited with code ${String(result.exitCode)}`;
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
        error: `Could not read current sing-box configuration: ${redactText(
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
          error: `sing-box apply failed before replacing current config: ${applyMessage}`,
        });
      }
      const rollbackStartedAt = new Date();
      try {
        await this.fileSystem.atomicWrite(this.configPath, previous);
        await this.reloadHandshake.requestReload(previousHash);
        await this.verifyHealthy();
        return completed('ROLLED_BACK', previousHash, {
          error: `sing-box apply failed and the previous config was restored: ${applyMessage}`,
          rollbackOutcome: 'SUCCEEDED',
          rollbackStartedAt,
          rollbackCompletedAt: new Date(),
        });
      } catch (rollbackError: unknown) {
        return completed('FAILED', previousHash, {
          error: `sing-box apply failed: ${applyMessage}; rollback reload/verification failed: ${redactText(
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
    try {
      const response = await this.http.getJson(
        `${this.clashApiUrl}/version`,
        { Authorization: `Bearer ${this.clashApiSecret}` },
        this.healthTimeoutMs,
      );
      const body = asRecord(response.body);
      const version = typeof body?.version === 'string' ? body.version : null;
      if (response.status < 200 || response.status >= 300 || !version) {
        const localized = localizeCoreHealthError(
          `HTTP ${response.status} without a version`,
        );
        return {
          healthy: false,
          version,
          latencyMs: roundLatency(response.latencyMs),
          checkedAt,
          error: localized.en,
          errorRu: localized.ru,
        };
      }
      return {
        healthy: true,
        version,
        latencyMs: roundLatency(response.latencyMs),
        checkedAt,
        error: null,
        errorRu: null,
      };
    } catch (error: unknown) {
      const localized = localizeCoreHealthError(errorMessage(error));
      return {
        healthy: false,
        version: null,
        latencyMs: 0,
        checkedAt,
        error: localized.en,
        errorRu: localized.ru,
      };
    }
  }

  async getTrafficSnapshot(): Promise<TrafficSnapshotResult> {
    const capturedAt = new Date();
    try {
      const raw = await this.stats.query();
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
    try {
      const response = await this.http.getJson(
        `${this.clashApiUrl}/connections`,
        { Authorization: `Bearer ${this.clashApiSecret}` },
        this.healthTimeoutMs,
      );
      if (response.status < 200 || response.status >= 300) {
        return {
          capturedAt,
          clients: [],
          partial: true,
          warnings: [`Clash API /connections returned HTTP ${response.status}`],
        };
      }
      const root = asRecord(response.body);
      if (!root || !Array.isArray(root.connections)) {
        return {
          capturedAt,
          clients: [],
          partial: true,
          warnings: ['Clash API /connections returned an unknown payload'],
        };
      }
      const connections = root.connections;
      const warnings: string[] = [];
      const clients = connections.flatMap((connection, index) => {
        const parsed = parseOnlineClient(connection);
        if (!parsed) {
          warnings.push(`Connection at index ${index} had an unknown shape`);
          return [];
        }
        return [parsed];
      });
      return {
        capturedAt,
        clients,
        partial: warnings.length > 0,
        warnings,
      };
    } catch (error: unknown) {
      return {
        capturedAt,
        clients: [],
        partial: true,
        warnings: [
          `Clash API connections request failed: ${errorMessage(error)}`,
        ],
      };
    }
  }

  private renderInbound(
    inbound: DesiredInbound,
    secretValues: Set<string>,
  ): JsonObject {
    if (inbound.protocol === 'HYSTERIA2') {
      return this.renderHysteria2Inbound(inbound, secretValues);
    }
    if (inbound.protocol === 'VLESS_REALITY') {
      return this.renderVlessRealityInbound(inbound, secretValues);
    }
    if (inbound.protocol === 'TROJAN') {
      return this.renderTrojanInbound(inbound, secretValues);
    }
    if (inbound.protocol === 'SHADOWSOCKS') {
      return this.renderShadowsocksInbound(inbound, secretValues);
    }
    throw new Error(
      `SingBoxProvider cannot render ${inbound.protocol} inbound ${inbound.id}`,
    );
  }

  private renderHysteria2Inbound(
    inbound: DesiredHysteria2Inbound,
    secretValues: Set<string>,
  ): JsonObject {
    const config = inbound.config;
    const users = inbound.assignments
      .sort((left, right) => compareStrings(left.userId, right.userId))
      .map((assignment) => {
        const password = passwordFrom(assignment.credential);
        secretValues.add(password);
        return {
          name: assignment.userId,
          password,
        };
      });
    const rendered: JsonObject = {
      type: 'hysteria2',
      tag: inbound.tag,
      listen: inbound.listenHost,
      listen_port: inbound.listenPort,
      users,
      ignore_client_bandwidth: config.ignoreClientBandwidth,
      tls: this.renderTls(
        inbound.config.tls,
        inbound.secrets,
        inbound.tag,
        secretValues,
      ),
    };
    setOptional(rendered, 'up_mbps', config.upMbps);
    setOptional(rendered, 'down_mbps', config.downMbps);
    setOptional(rendered, 'bind_interface', config.bindInterface);
    setOptional(rendered, 'routing_mark', config.routingMark);
    setOptional(rendered, 'netns', config.netns);
    setOptional(rendered, 'tcp_keep_alive', config.tcpKeepAlive);
    setOptional(
      rendered,
      'tcp_keep_alive_interval',
      config.tcpKeepAliveInterval,
    );
    setOptional(rendered, 'udp_fragment', config.udpFragment);
    setOptional(rendered, 'udp_timeout', config.udpTimeout);
    setOptional(rendered, 'detour', config.detour);
    if (config.reuseAddr) rendered.reuse_addr = true;
    if (config.tcpFastOpen) rendered.tcp_fast_open = true;
    if (config.tcpMultiPath) rendered.tcp_multi_path = true;
    if (config.disableTcpKeepAlive) rendered.disable_tcp_keep_alive = true;
    if (config.brutalDebug) rendered.brutal_debug = true;
    if (config.obfs) {
      const password = requiredSecret(
        inbound.secrets.obfsPassword,
        `${inbound.tag} obfs password`,
      );
      secretValues.add(password);
      rendered.obfs = { type: 'salamander', password };
    }
    if (config.masquerade) {
      rendered.masquerade = renderMasquerade(config.masquerade);
    }
    return rendered;
  }

  private renderVlessRealityInbound(
    inbound: DesiredVlessRealityInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const config = inbound.config;
    secretValues.add(inbound.secrets.privateKey);
    secretValues.add(inbound.secrets.publicKey);
    const users = inbound.assignments
      .sort((left, right) => compareStrings(left.userId, right.userId))
      .map((assignment) => {
        const uuid = uuidFrom(assignment.credential);
        secretValues.add(uuid);
        const user: JsonObject = {
          name: assignment.userId,
          uuid,
        };
        if (config.flow) {
          user.flow = config.flow;
        }
        return user;
      });
    return {
      type: 'vless',
      tag: inbound.tag,
      listen: inbound.listenHost,
      listen_port: inbound.listenPort,
      users,
      tls: {
        enabled: true,
        server_name: config.serverNames[0],
        reality: {
          enabled: true,
          handshake: {
            server: config.handshakeServer,
            server_port: config.handshakePort,
          },
          private_key: inbound.secrets.privateKey,
          short_id: config.shortIds,
        },
      },
    };
  }

  private renderTrojanInbound(
    inbound: DesiredTrojanInbound,
    secretValues: Set<string>,
  ): JsonObject {
    const users = inbound.assignments
      .sort((left, right) => compareStrings(left.userId, right.userId))
      .map((assignment) => {
        const password = passwordFrom(assignment.credential);
        secretValues.add(password);
        return {
          name: assignment.userId,
          password,
        };
      });
    const rendered: JsonObject = {
      type: 'trojan',
      tag: inbound.tag,
      listen: inbound.listenHost,
      listen_port: inbound.listenPort,
      users,
      tls: this.renderTls(
        inbound.config.tls,
        inbound.secrets,
        inbound.tag,
        secretValues,
      ),
    };
    if (inbound.config.fallback) {
      rendered.fallback = {
        server: inbound.config.fallback.server,
        server_port: inbound.config.fallback.serverPort,
      };
    }
    return rendered;
  }

  private renderShadowsocksInbound(
    inbound: DesiredShadowsocksInbound,
    secretValues: Set<string>,
  ): JsonObject {
    secretValues.add(inbound.secrets.serverPassword);
    const users = inbound.assignments
      .sort((left, right) => compareStrings(left.userId, right.userId))
      .map((assignment) => {
        const password = passwordFrom(assignment.credential);
        secretValues.add(password);
        return {
          name: assignment.userId,
          password,
        };
      });
    return {
      type: 'shadowsocks',
      tag: inbound.tag,
      listen: inbound.listenHost,
      listen_port: inbound.listenPort,
      method: inbound.config.method,
      password: inbound.secrets.serverPassword,
      users,
      multiplex: {
        enabled: false,
      },
    };
  }

  private renderTls(
    tls: DesiredHysteria2Inbound['config']['tls'],
    secrets:
      DesiredHysteria2Inbound['secrets'] | DesiredTrojanInbound['secrets'],
    tag: string,
    secretValues: Set<string>,
  ): JsonObject {
    const rendered: JsonObject = {
      enabled: true,
      server_name: tls.sni,
      alpn: tls.alpn,
    };
    setOptional(rendered, 'min_version', tls.minVersion ?? null);
    setOptional(rendered, 'max_version', tls.maxVersion ?? null);
    if (tls.cipherSuites.length > 0) {
      rendered.cipher_suites = tls.cipherSuites;
    }
    if (tls.curvePreferences.length > 0) {
      rendered.curve_preferences = tls.curvePreferences;
    }
    if (tls.kernelTx) rendered.kernel_tx = true;
    if (tls.kernelRx) rendered.kernel_rx = true;

    if (tls.mode === 'FILES') {
      if (tls.certificatePath && tls.keyPath) {
        rendered.certificate_path = tls.certificatePath;
        rendered.key_path = tls.keyPath;
      } else {
        const certificate = requiredSecret(
          secrets.certificatePem,
          `${tag} TLS certificate PEM`,
        );
        const privateKey = requiredSecret(
          secrets.privateKeyPem,
          `${tag} TLS private key PEM`,
        );
        secretValues.add(certificate);
        secretValues.add(privateKey);
        rendered.certificate = certificate;
        rendered.key = privateKey;
      }
      return rendered;
    }

    const acme: JsonObject = {
      domain: tls.domains,
      data_directory: tls.dataDirectory,
      provider: tls.provider,
      disable_http_challenge: tls.disableHttpChallenge,
      disable_tls_alpn_challenge: tls.disableTlsAlpnChallenge,
    };
    setOptional(acme, 'default_server_name', tls.defaultServerName);
    setOptional(acme, 'email', tls.email);
    setOptional(acme, 'alternative_http_port', tls.alternativeHttpPort);
    setOptional(acme, 'alternative_tls_port', tls.alternativeTlsPort);
    if (tls.externalAccount) {
      const macKey = requiredSecret(
        secrets.acmeExternalAccountMacKey,
        `${tag} ACME external account MAC key`,
      );
      secretValues.add(macKey);
      acme.external_account = {
        key_id: tls.externalAccount.keyId,
        mac_key: macKey,
      };
    }
    if (tls.dns01Challenge) {
      acme.dns01_challenge = this.renderDns01(
        secrets,
        tag,
        tls.dns01Challenge,
        secretValues,
      );
    }
    rendered.acme = acme;
    return rendered;
  }

  private renderDns01(
    secrets:
      DesiredHysteria2Inbound['secrets'] | DesiredTrojanInbound['secrets'],
    tag: string,
    challenge: NonNullable<
      Extract<
        DesiredHysteria2Inbound['config']['tls'],
        { mode: 'ACME' }
      >['dns01Challenge']
    >,
    secretValues: Set<string>,
  ): JsonObject {
    if (!challenge) {
      throw new Error('Missing ACME DNS-01 challenge');
    }
    if (challenge.provider === 'alidns') {
      const accessKeySecret = requiredSecret(
        secrets.acmeAliDnsAccessKeySecret,
        `${tag} AliDNS access key secret`,
      );
      secretValues.add(accessKeySecret);
      const result: JsonObject = {
        provider: 'alidns',
        access_key_id: challenge.accessKeyId,
        access_key_secret: accessKeySecret,
      };
      setOptional(result, 'region_id', challenge.regionId);
      if (challenge.securityTokenPresent) {
        const securityToken = requiredSecret(
          secrets.acmeAliDnsSecurityToken,
          `${tag} AliDNS security token`,
        );
        secretValues.add(securityToken);
        result.security_token = securityToken;
      }
      return result;
    }
    if (challenge.provider === 'cloudflare') {
      const result: JsonObject = { provider: 'cloudflare' };
      if (challenge.apiTokenPresent) {
        const token = requiredSecret(
          secrets.acmeCloudflareApiToken,
          `${tag} Cloudflare API token`,
        );
        secretValues.add(token);
        result.api_token = token;
      }
      if (challenge.zoneTokenPresent) {
        const token = requiredSecret(
          secrets.acmeCloudflareZoneToken,
          `${tag} Cloudflare zone token`,
        );
        secretValues.add(token);
        result.zone_token = token;
      }
      return result;
    }
    const password = requiredSecret(
      secrets.acmeDnsPassword,
      `${tag} ACME-DNS password`,
    );
    secretValues.add(password);
    return {
      provider: 'acme-dns',
      username: challenge.username,
      password,
      subdomain: challenge.subdomain,
      server_url: challenge.serverUrl,
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
      `sing-box did not become healthy within ${this.reloadTimeoutMs}ms: ${lastError}`,
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

function passwordFrom(
  credential: PasswordCredential | VlessCredential,
): string {
  if (!('password' in credential)) {
    throw new Error('Expected a password credential');
  }
  return credential.password;
}

function uuidFrom(credential: PasswordCredential | VlessCredential): string {
  if (!('uuid' in credential)) {
    throw new Error('Expected a VLESS UUID credential');
  }
  return credential.uuid;
}

function setOptional(
  target: JsonObject,
  key: string,
  value: string | number | boolean | null | undefined,
): void {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
}

function requiredSecret(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing encrypted ${label}`);
  }
  return value;
}

function renderMasquerade(
  masquerade: DesiredHysteria2Inbound['config']['masquerade'] & {},
): JsonObject {
  if (masquerade.type === 'FILE') {
    return { type: 'file', directory: masquerade.directory };
  }
  if (masquerade.type === 'PROXY') {
    return {
      type: 'proxy',
      url: masquerade.url,
      rewrite_host: masquerade.rewriteHost,
    };
  }
  return {
    type: 'string',
    status_code: masquerade.statusCode,
    headers: masquerade.headers,
    content: masquerade.content,
  };
}

function aggregateTrafficCounters(raw: RawV2RayStat[]): TrafficCounter[] {
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
      engine: 'SING_BOX',
      scope: counter.scope,
      key: counter.key,
      uplinkBytes: (counter.uplinkBytes ?? 0n).toString(),
      downlinkBytes: (counter.downlinkBytes ?? 0n).toString(),
    }));
}

function parseOnlineClient(value: unknown): OnlineClient | null {
  const connection = asRecord(value);
  const metadata = asRecord(connection?.metadata);
  if (!connection || !metadata || typeof connection.id !== 'string') {
    return null;
  }
  const userName =
    typeof metadata.user === 'string' && metadata.user ? metadata.user : null;
  return {
    engine: 'SING_BOX',
    connectionId: connection.id,
    panelUserId:
      userName && uuidPattern.test(userName) ? userName.toLowerCase() : null,
    userName,
    inboundTag: typeof metadata.inbound === 'string' ? metadata.inbound : null,
    ipAddress: typeof metadata.sourceIP === 'string' ? metadata.sourceIP : null,
    device:
      typeof metadata.processPath === 'string'
        ? metadata.processPath
        : typeof metadata.process === 'string'
          ? metadata.process
          : null,
    network: typeof metadata.network === 'string' ? metadata.network : null,
    connectedAt:
      typeof connection.start === 'string' &&
      !Number.isNaN(Date.parse(connection.start))
        ? new Date(connection.start)
        : null,
    lastSeenAt: null,
    uploadBytes: nonnegativeNumberString(connection.upload),
    downloadBytes: nonnegativeNumberString(connection.download),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonnegativeNumberString(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value).toString()
    : typeof value === 'string' && /^\d+$/.test(value)
      ? value
      : null;
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
