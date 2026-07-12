import { HttpStatus, Injectable } from '@nestjs/common';
import {
  PRODUCT_NAME,
  type InboundProtocol,
  type SubscriptionFormat,
} from '@overvpn/shared/constants';
import type {
  Hysteria2SubscriptionEndpoint,
  ShadowsocksSubscriptionEndpoint,
  SubscriptionEndpoint,
  SubscriptionProfileDescriptor,
  TrojanSubscriptionEndpoint,
  VlessRealitySubscriptionEndpoint,
} from '@overvpn/shared/schemas';
import {
  hysteria2InboundPublicConfigSchema,
  shadowsocksInboundPublicConfigSchema,
  trojanInboundPublicConfigSchema,
  vlessRealityInboundPublicConfigSchema,
} from '@overvpn/shared/schemas';
import { stringify as stringifyYaml } from 'yaml';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import {
  buildHysteria2Uri,
  normalizeHysteria2Password,
} from '../inbounds/hysteria2-domain';
import {
  buildShadowsocksUri,
  composeShadowsocksClientPassword,
  normalizeShadowsocksPassword,
} from '../inbounds/shadowsocks-domain';
import {
  buildTrojanUri,
  normalizeTrojanPassword,
} from '../inbounds/trojan-domain';
import { buildVlessUri } from '../inbounds/vless-reality-domain';

export interface SubscriptionInboundRecord {
  id: string;
  tag: string;
  protocol: InboundProtocol;
  publicHost: string | null;
  publicPort: number | null;
  listenPort: number;
  config: unknown;
  secretDataEncrypted: string | null;
}

export interface SubscriptionAssignmentRecord {
  id: string;
  credentialEncrypted: string;
  inbound: SubscriptionInboundRecord;
}

export interface SubscriptionProfileUser {
  identity: string;
  username: string;
  inboundAssignments: SubscriptionAssignmentRecord[];
}

export interface RenderedSubscriptionProfile {
  body: string;
  contentType: string;
  extension: 'json' | 'txt' | 'yaml';
}

interface SubscriptionProtocolAdapter {
  readonly protocol: InboundProtocol;
  build(
    assignment: SubscriptionAssignmentRecord,
    user: SubscriptionProfileUser,
    tag: string,
  ): SubscriptionEndpoint;
}

@Injectable()
export class Hysteria2SubscriptionAdapter implements SubscriptionProtocolAdapter {
  readonly protocol = 'HYSTERIA2' as const;

  constructor(private readonly encryption: SecretEncryptionService) {}

  build(
    assignment: SubscriptionAssignmentRecord,
    user: SubscriptionProfileUser,
    tag: string,
  ): Hysteria2SubscriptionEndpoint {
    const inbound = assignment.inbound;
    if (!inbound.publicHost) {
      throw unavailable();
    }

    const config = hysteria2InboundPublicConfigSchema.safeParse(inbound.config);
    if (!config.success) {
      throw unavailable();
    }
    const credential = passwordCredential(
      this.encryption,
      assignment.credentialEncrypted,
      normalizeHysteria2Password,
    );
    const secrets = this.secrets(inbound.secretDataEncrypted);
    const obfsPassword = config.data.obfs ? secrets.obfsPassword : undefined;
    if (config.data.obfs && !obfsPassword) {
      throw unavailable();
    }

    return {
      protocol: 'HYSTERIA2',
      tag,
      displayName: `${user.identity} - ${inbound.tag}`,
      server: inbound.publicHost,
      port: inbound.publicPort ?? inbound.listenPort,
      password: credential,
      tls: {
        serverName: config.data.tls.sni,
        insecure: config.data.tls.clientInsecure,
        alpn: config.data.tls.alpn,
      },
      obfs: obfsPassword
        ? {
            type: 'salamander',
            password: obfsPassword,
          }
        : null,
      bandwidth: {
        upMbps: config.data.upMbps,
        downMbps: config.data.downMbps,
      },
    };
  }

  private secrets(encrypted: string | null): { obfsPassword?: string } {
    if (!encrypted) {
      return {};
    }
    try {
      const value = JSON.parse(this.encryption.decrypt(encrypted)) as Record<
        string,
        unknown
      >;
      if (
        value.version !== 1 ||
        (value.obfsPassword !== undefined &&
          typeof value.obfsPassword !== 'string')
      ) {
        throw new Error('Invalid inbound secret payload');
      }
      return typeof value.obfsPassword === 'string'
        ? { obfsPassword: normalizeHysteria2Password(value.obfsPassword) }
        : {};
    } catch {
      throw unavailable();
    }
  }
}

@Injectable()
export class VlessRealitySubscriptionAdapter implements SubscriptionProtocolAdapter {
  readonly protocol = 'VLESS_REALITY' as const;

  constructor(private readonly encryption: SecretEncryptionService) {}

  build(
    assignment: SubscriptionAssignmentRecord,
    user: SubscriptionProfileUser,
    tag: string,
  ): VlessRealitySubscriptionEndpoint {
    const inbound = assignment.inbound;
    if (!inbound.publicHost) {
      throw unavailable();
    }
    const config = vlessRealityInboundPublicConfigSchema.safeParse(
      inbound.config,
    );
    if (!config.success || !inbound.secretDataEncrypted) {
      throw unavailable();
    }
    const secrets = JSON.parse(
      this.encryption.decrypt(inbound.secretDataEncrypted),
    ) as Record<string, unknown>;
    if (typeof secrets.publicKey !== 'string') {
      throw unavailable();
    }
    const uuid = uuidCredential(
      this.encryption,
      assignment.credentialEncrypted,
    );
    return {
      protocol: 'VLESS_REALITY',
      tag,
      displayName: `${user.identity} - ${inbound.tag}`,
      server: inbound.publicHost,
      port: inbound.publicPort ?? inbound.listenPort,
      uuid,
      flow: config.data.flow,
      tls: {
        serverName: config.data.serverNames[0] ?? inbound.publicHost,
        fingerprint: config.data.fingerprint,
        publicKey: secrets.publicKey,
        shortId: config.data.shortIds[0] ?? '',
      },
    };
  }
}

@Injectable()
export class TrojanSubscriptionAdapter implements SubscriptionProtocolAdapter {
  readonly protocol = 'TROJAN' as const;

  constructor(private readonly encryption: SecretEncryptionService) {}

  build(
    assignment: SubscriptionAssignmentRecord,
    user: SubscriptionProfileUser,
    tag: string,
  ): TrojanSubscriptionEndpoint {
    const inbound = assignment.inbound;
    if (!inbound.publicHost) {
      throw unavailable();
    }
    const config = trojanInboundPublicConfigSchema.safeParse(inbound.config);
    if (!config.success) {
      throw unavailable();
    }
    const password = passwordCredential(
      this.encryption,
      assignment.credentialEncrypted,
      normalizeTrojanPassword,
    );
    return {
      protocol: 'TROJAN',
      tag,
      displayName: `${user.identity} - ${inbound.tag}`,
      server: inbound.publicHost,
      port: inbound.publicPort ?? inbound.listenPort,
      password,
      tls: {
        serverName: config.data.tls.sni,
        insecure: config.data.tls.clientInsecure,
        alpn: config.data.tls.alpn,
      },
    };
  }
}

@Injectable()
export class ShadowsocksSubscriptionAdapter implements SubscriptionProtocolAdapter {
  readonly protocol = 'SHADOWSOCKS' as const;

  constructor(private readonly encryption: SecretEncryptionService) {}

  build(
    assignment: SubscriptionAssignmentRecord,
    user: SubscriptionProfileUser,
    tag: string,
  ): ShadowsocksSubscriptionEndpoint {
    const inbound = assignment.inbound;
    if (!inbound.publicHost || !inbound.secretDataEncrypted) {
      throw unavailable();
    }
    const config = shadowsocksInboundPublicConfigSchema.safeParse(
      inbound.config,
    );
    if (!config.success) {
      throw unavailable();
    }
    const secrets = JSON.parse(
      this.encryption.decrypt(inbound.secretDataEncrypted),
    ) as Record<string, unknown>;
    if (typeof secrets.serverPassword !== 'string') {
      throw unavailable();
    }
    const userPassword = passwordCredential(
      this.encryption,
      assignment.credentialEncrypted,
      (value) => normalizeShadowsocksPassword(config.data.method, value),
    );
    return {
      protocol: 'SHADOWSOCKS',
      tag,
      displayName: `${user.identity} - ${inbound.tag}`,
      server: inbound.publicHost,
      port: inbound.publicPort ?? inbound.listenPort,
      method: config.data.method,
      password: composeShadowsocksClientPassword(
        config.data.method,
        secrets.serverPassword,
        userPassword,
      ),
    };
  }
}

@Injectable()
export class SubscriptionProfileBuilder {
  private readonly adapters: ReadonlyMap<
    InboundProtocol,
    SubscriptionProtocolAdapter
  >;

  constructor(
    hysteria2: Hysteria2SubscriptionAdapter,
    vlessReality: VlessRealitySubscriptionAdapter,
    trojan: TrojanSubscriptionAdapter,
    shadowsocks: ShadowsocksSubscriptionAdapter,
  ) {
    this.adapters = new Map<InboundProtocol, SubscriptionProtocolAdapter>([
      [hysteria2.protocol, hysteria2],
      [vlessReality.protocol, vlessReality],
      [trojan.protocol, trojan],
      [shadowsocks.protocol, shadowsocks],
    ]);
  }

  build(user: SubscriptionProfileUser): SubscriptionProfileDescriptor {
    const tagAllocator = new DeterministicTagAllocator();
    const endpoints = [...user.inboundAssignments]
      .sort(compareAssignments)
      .flatMap((assignment) => {
        const adapter = this.adapters.get(assignment.inbound.protocol);
        if (!adapter) {
          return [];
        }
        const tag = tagAllocator.allocate(
          `${protocolPrefix(adapter.protocol)}-${assignment.inbound.tag}`,
        );
        return [adapter.build(assignment, user, tag)];
      });

    return {
      title: `${PRODUCT_NAME} - ${user.username}`,
      identity: user.identity,
      username: user.username,
      endpoints,
    };
  }

  render(
    format: SubscriptionFormat,
    profile: SubscriptionProfileDescriptor,
  ): RenderedSubscriptionProfile {
    if (format === 'links') {
      return {
        body: renderLinkList(profile),
        contentType: 'text/plain; charset=utf-8',
        extension: 'txt',
      };
    }
    if (format === 'clash') {
      return {
        body: renderClashProfile(profile),
        contentType: 'application/yaml; charset=utf-8',
        extension: 'yaml',
      };
    }
    return {
      body: renderSingBoxProfile(profile),
      contentType: 'application/json; charset=utf-8',
      extension: 'json',
    };
  }
}

export function renderSingBoxProfile(
  profile: SubscriptionProfileDescriptor,
): string {
  const endpointTags = profile.endpoints.map((endpoint) => endpoint.tag);
  const proxyOutbounds = profile.endpoints.map((endpoint) =>
    renderSingBoxOutbound(endpoint),
  );

  return `${JSON.stringify(
    {
      log: {
        level: 'info',
        timestamp: true,
      },
      dns: {
        servers: [
          {
            type: 'local',
            tag: 'local',
          },
          {
            type: 'https',
            tag: 'remote',
            server: '1.1.1.1',
            server_port: 443,
            path: '/dns-query',
            tls: {
              enabled: true,
              server_name: 'cloudflare-dns.com',
            },
            detour: 'select',
          },
        ],
        final: 'remote',
        strategy: 'prefer_ipv4',
      },
      inbounds: [
        {
          type: 'tun',
          tag: 'tun-in',
          address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
          auto_route: true,
          strict_route: true,
        },
      ],
      outbounds: [
        {
          type: 'selector',
          tag: 'select',
          outbounds: ['auto', ...endpointTags, 'direct'],
          default: 'auto',
        },
        {
          type: 'urltest',
          tag: 'auto',
          outbounds: endpointTags,
          url: 'https://www.gstatic.com/generate_204',
          interval: '5m',
          tolerance: 50,
        },
        ...proxyOutbounds,
        {
          type: 'direct',
          tag: 'direct',
        },
      ],
      route: {
        rules: [
          {
            action: 'sniff',
          },
          {
            protocol: 'dns',
            action: 'hijack-dns',
          },
          {
            ip_is_private: true,
            action: 'route',
            outbound: 'direct',
          },
        ],
        final: 'select',
        auto_detect_interface: true,
        default_domain_resolver: 'local',
      },
      experimental: {
        cache_file: {
          enabled: true,
        },
      },
    },
    null,
    2,
  )}\n`;
}

function renderSingBoxOutbound(
  endpoint: SubscriptionEndpoint,
): Record<string, unknown> {
  if (endpoint.protocol === 'HYSTERIA2') {
    const outbound: Record<string, unknown> = {
      type: 'hysteria2',
      tag: endpoint.tag,
      server: endpoint.server,
      server_port: endpoint.port,
      password: endpoint.password,
    };
    if (
      endpoint.bandwidth.upMbps !== null &&
      endpoint.bandwidth.downMbps !== null
    ) {
      outbound.up_mbps = endpoint.bandwidth.upMbps;
      outbound.down_mbps = endpoint.bandwidth.downMbps;
    }
    if (endpoint.obfs) {
      outbound.obfs = {
        type: endpoint.obfs.type,
        password: endpoint.obfs.password,
      };
    }
    outbound.tls = {
      enabled: true,
      server_name: endpoint.tls.serverName,
      insecure: endpoint.tls.insecure,
      ...(endpoint.tls.alpn.length > 0 ? { alpn: endpoint.tls.alpn } : {}),
    };
    return outbound;
  }
  if (endpoint.protocol === 'VLESS_REALITY') {
    return {
      type: 'vless',
      tag: endpoint.tag,
      server: endpoint.server,
      server_port: endpoint.port,
      uuid: endpoint.uuid,
      ...(endpoint.flow ? { flow: endpoint.flow } : {}),
      tls: {
        enabled: true,
        server_name: endpoint.tls.serverName,
        utls: {
          enabled: true,
          fingerprint: endpoint.tls.fingerprint,
        },
        reality: {
          enabled: true,
          public_key: endpoint.tls.publicKey,
          short_id: endpoint.tls.shortId,
        },
      },
    };
  }
  if (endpoint.protocol === 'TROJAN') {
    return {
      type: 'trojan',
      tag: endpoint.tag,
      server: endpoint.server,
      server_port: endpoint.port,
      password: endpoint.password,
      tls: {
        enabled: true,
        server_name: endpoint.tls.serverName,
        insecure: endpoint.tls.insecure,
        ...(endpoint.tls.alpn.length > 0 ? { alpn: endpoint.tls.alpn } : {}),
      },
    };
  }
  return {
    type: 'shadowsocks',
    tag: endpoint.tag,
    server: endpoint.server,
    server_port: endpoint.port,
    method: endpoint.method,
    password: endpoint.password,
  };
}

export function renderLinkList(profile: SubscriptionProfileDescriptor): string {
  const links = profile.endpoints.map((endpoint) => {
    if (endpoint.protocol === 'HYSTERIA2') {
      return buildHysteria2Uri({
        password: endpoint.password,
        host: endpoint.server,
        port: endpoint.port,
        sni: endpoint.tls.serverName,
        insecure: endpoint.tls.insecure,
        obfsPassword: endpoint.obfs?.password,
        label: endpoint.displayName,
      });
    }
    if (endpoint.protocol === 'VLESS_REALITY') {
      return buildVlessUri({
        uuid: endpoint.uuid,
        host: endpoint.server,
        port: endpoint.port,
        sni: endpoint.tls.serverName,
        fingerprint: endpoint.tls.fingerprint,
        publicKey: endpoint.tls.publicKey,
        shortId: endpoint.tls.shortId,
        flow: endpoint.flow,
        label: endpoint.displayName,
      });
    }
    if (endpoint.protocol === 'TROJAN') {
      return buildTrojanUri({
        password: endpoint.password,
        host: endpoint.server,
        port: endpoint.port,
        sni: endpoint.tls.serverName,
        insecure: endpoint.tls.insecure,
        alpn: endpoint.tls.alpn,
        label: endpoint.displayName,
      });
    }
    return buildShadowsocksUri({
      method: endpoint.method,
      password: endpoint.password,
      host: endpoint.server,
      port: endpoint.port,
      label: endpoint.displayName,
    });
  });
  return `${links.join('\n')}\n`;
}

export function renderClashProfile(
  profile: SubscriptionProfileDescriptor,
): string {
  const proxyNames = profile.endpoints.map((endpoint) => endpoint.tag);
  const proxies = profile.endpoints.map((endpoint) => {
    if (endpoint.protocol === 'HYSTERIA2') {
      return {
        name: endpoint.tag,
        type: 'hysteria2',
        server: endpoint.server,
        port: endpoint.port,
        password: endpoint.password,
        sni: endpoint.tls.serverName,
        'skip-cert-verify': endpoint.tls.insecure,
        ...(endpoint.tls.alpn.length > 0 ? { alpn: endpoint.tls.alpn } : {}),
        ...(endpoint.obfs
          ? {
              obfs: endpoint.obfs.type,
              'obfs-password': endpoint.obfs.password,
            }
          : {}),
        ...(endpoint.bandwidth.upMbps === null
          ? {}
          : { up: `${endpoint.bandwidth.upMbps} Mbps` }),
        ...(endpoint.bandwidth.downMbps === null
          ? {}
          : { down: `${endpoint.bandwidth.downMbps} Mbps` }),
      };
    }
    if (endpoint.protocol === 'VLESS_REALITY') {
      return {
        name: endpoint.tag,
        type: 'vless',
        server: endpoint.server,
        port: endpoint.port,
        uuid: endpoint.uuid,
        network: 'tcp',
        tls: true,
        udp: true,
        ...(endpoint.flow ? { flow: endpoint.flow } : {}),
        'client-fingerprint': endpoint.tls.fingerprint,
        servername: endpoint.tls.serverName,
        'reality-opts': {
          'public-key': endpoint.tls.publicKey,
          'short-id': endpoint.tls.shortId,
        },
      };
    }
    if (endpoint.protocol === 'TROJAN') {
      return {
        name: endpoint.tag,
        type: 'trojan',
        server: endpoint.server,
        port: endpoint.port,
        password: endpoint.password,
        sni: endpoint.tls.serverName,
        'skip-cert-verify': endpoint.tls.insecure,
        ...(endpoint.tls.alpn.length > 0 ? { alpn: endpoint.tls.alpn } : {}),
      };
    }
    return {
      name: endpoint.tag,
      type: 'ss',
      server: endpoint.server,
      port: endpoint.port,
      cipher: endpoint.method,
      password: endpoint.password,
    };
  });
  const config = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    ipv6: true,
    'unified-delay': true,
    'tcp-concurrent': true,
    dns: {
      enable: true,
      ipv6: true,
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      'default-nameserver': ['1.1.1.1', '8.8.8.8'],
      nameserver: ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'],
    },
    proxies,
    'proxy-groups': [
      {
        name: 'PROXY',
        type: 'select',
        proxies: ['AUTO', ...proxyNames, 'DIRECT'],
      },
      {
        name: 'AUTO',
        type: 'url-test',
        proxies: proxyNames,
        url: 'https://www.gstatic.com/generate_204',
        interval: 300,
        tolerance: 50,
      },
    ],
    rules: ['MATCH,PROXY'],
  };

  return stringifyYaml(config, {
    aliasDuplicateObjects: false,
    lineWidth: 0,
  });
}

function passwordCredential(
  encryption: SecretEncryptionService,
  encrypted: string,
  normalize: (value: string | undefined) => string,
): string {
  if (!encrypted.startsWith('v1:')) {
    throw unavailable();
  }
  try {
    const value = JSON.parse(encryption.decrypt(encrypted)) as Record<
      string,
      unknown
    >;
    if (
      value.version !== 1 ||
      typeof value.password !== 'string' ||
      Object.keys(value).some((key) => key !== 'version' && key !== 'password')
    ) {
      throw new Error('Invalid credential payload');
    }
    return normalize(value.password);
  } catch {
    throw unavailable();
  }
}

function uuidCredential(
  encryption: SecretEncryptionService,
  encrypted: string,
): string {
  if (!encrypted.startsWith('v1:')) {
    throw unavailable();
  }
  try {
    const value = JSON.parse(encryption.decrypt(encrypted)) as Record<
      string,
      unknown
    >;
    if (
      value.version !== 1 ||
      typeof value.uuid !== 'string' ||
      Object.keys(value).some((key) => key !== 'version' && key !== 'uuid')
    ) {
      throw new Error('Invalid credential payload');
    }
    return value.uuid;
  } catch {
    throw unavailable();
  }
}

class DeterministicTagAllocator {
  private readonly counts = new Map<string, number>();

  allocate(input: string): string {
    const base =
      input
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'proxy';
    const count = (this.counts.get(base) ?? 0) + 1;
    this.counts.set(base, count);
    return count === 1 ? base : `${base.slice(0, 95)}-${count}`;
  }
}

function compareAssignments(
  left: SubscriptionAssignmentRecord,
  right: SubscriptionAssignmentRecord,
): number {
  return (
    left.inbound.tag.localeCompare(right.inbound.tag, 'en') ||
    left.inbound.id.localeCompare(right.inbound.id, 'en') ||
    left.id.localeCompare(right.id, 'en')
  );
}

function protocolPrefix(protocol: InboundProtocol): string {
  return protocol === 'HYSTERIA2'
    ? 'hy2'
    : protocol.toLowerCase().replaceAll('_', '-');
}

function unavailable(): ApiException {
  return new ApiException(
    'SUBSCRIPTION_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
