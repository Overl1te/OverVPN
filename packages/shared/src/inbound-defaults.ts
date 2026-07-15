import type { InboundProtocol } from './constants.js';
import type {
  Hysteria2InboundSettings,
  ShadowsocksInboundSettings,
  TrojanInboundSettings,
  VlessGrpcTlsInboundSettings,
  VlessRealityInboundSettings,
  VlessTcpTlsInboundSettings,
  VlessXhttpTlsInboundSettings,
} from './schemas.js';

export type InboundDefaultsContext = {
  publicHost: string;
  acmeHttpPort?: number;
  acmeTlsPort?: number;
  /** Published sing-box UDP port (compose SING_BOX_UDP_PORT) — Hysteria2. */
  singBoxUdpPort?: number;
  /** Published sing-box TCP port (compose SING_BOX_TCP_PORT) — VLESS Reality. */
  singBoxTcpPort?: number;
  /** Published sing-box Trojan TCP port (compose SING_BOX_TROJAN_PORT). */
  singBoxTrojanPort?: number;
  /** Published sing-box Shadowsocks TCP port (compose SING_BOX_SS_PORT). */
  singBoxSsPort?: number;
  /** Published Xray TCP listen port (compose XRAY_LISTEN_PORT) — VLESS xHTTP TLS. */
  xrayListenPort?: number;
  /** Published Xray gRPC TLS port (compose XRAY_GRPC_PORT). */
  xrayGrpcPort?: number;
  /** Published Xray TCP TLS port (compose XRAY_TCP_TLS_PORT). */
  xrayTcpTlsPort?: number;
  /** Container paths from install (LE sync). Prefer FILES TLS when set. */
  tlsCertificatePath?: string | null;
  tlsKeyPath?: string | null;
};

export type InboundListenOverrides = {
  listenHost?: string;
  listenPort?: number;
  publicHost?: string;
  publicPort?: number;
  enabled?: boolean;
};

export type InboundPublishedTransport = 'udp' | 'tcp';

const XRAY_FILES_TLS_PROTOCOLS = new Set<InboundProtocol>([
  'VLESS_XHTTP_TLS',
  'VLESS_GRPC_TLS',
  'VLESS_TCP_TLS',
]);

/** Install-published listen port for a protocol (Simple mode / API guard). */
export function publishedListenPortForProtocol(
  protocol: InboundProtocol,
  context: Pick<
    InboundDefaultsContext,
    | 'singBoxUdpPort'
    | 'singBoxTcpPort'
    | 'singBoxTrojanPort'
    | 'singBoxSsPort'
    | 'xrayListenPort'
    | 'xrayGrpcPort'
    | 'xrayTcpTlsPort'
  >,
): number {
  switch (protocol) {
    case 'HYSTERIA2':
      return context.singBoxUdpPort ?? 443;
    case 'VLESS_REALITY':
      return context.singBoxTcpPort ?? 4443;
    case 'TROJAN':
      return context.singBoxTrojanPort ?? 8444;
    case 'SHADOWSOCKS':
      return context.singBoxSsPort ?? 8445;
    case 'VLESS_XHTTP_TLS':
      return context.xrayListenPort ?? 8443;
    case 'VLESS_GRPC_TLS':
      return context.xrayGrpcPort ?? 8446;
    case 'VLESS_TCP_TLS':
      return context.xrayTcpTlsPort ?? 8447;
  }
}

export function publishedTransportForProtocol(
  protocol: InboundProtocol,
): InboundPublishedTransport {
  return protocol === 'HYSTERIA2' ? 'udp' : 'tcp';
}

type AcmeTlsDefaults = Extract<Hysteria2InboundSettings['tls'], { mode: 'ACME' }>;
type FilesTlsDefaults = Extract<Hysteria2InboundSettings['tls'], { mode: 'FILES' }>;

export function defaultAcmeEmail(publicHost: string): string | undefined {
  const host = publicHost.trim();
  if (!host || host.includes('@') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return undefined;
  }
  return `admin@${host}`;
}

function commonTlsFields(publicHost: string) {
  return {
    sni: publicHost,
    alpn: ['h3'],
    minVersion: '1.2' as const,
    cipherSuites: [],
    curvePreferences: [],
    kernelTx: false,
    kernelRx: false,
    clientInsecure: false,
  };
}

function buildFilesTls(
  publicHost: string,
  certificatePath: string,
  keyPath: string,
): FilesTlsDefaults {
  return {
    mode: 'FILES',
    ...commonTlsFields(publicHost),
    certificatePath,
    keyPath,
  };
}

function buildAcmeTls(publicHost: string, context: InboundDefaultsContext): AcmeTlsDefaults {
  const email = defaultAcmeEmail(publicHost);
  const httpPort = context.acmeHttpPort;
  const tlsPort = context.acmeTlsPort;
  const httpRemapped = httpPort !== undefined && httpPort !== 80;
  const tlsRemapped = tlsPort !== undefined && tlsPort !== 443;
  const tls: AcmeTlsDefaults = {
    mode: 'ACME',
    ...commonTlsFields(publicHost),
    domains: publicHost ? [publicHost] : [],
    dataDirectory: '/var/lib/sing-box-state/acme',
    provider: 'letsencrypt',
    disableHttpChallenge: false,
    // When nginx owns TCP 443, TLS-ALPN ACME cannot succeed — HTTP-01 only.
    disableTlsAlpnChallenge: tlsRemapped,
    ...(email ? { email } : {}),
  };
  if (httpRemapped) {
    tls.alternativeHttpPort = httpPort;
  }
  if (tlsRemapped) {
    tls.alternativeTlsPort = tlsPort;
  }
  return tls;
}

function buildDefaultTls(
  publicHost: string,
  context: InboundDefaultsContext,
): AcmeTlsDefaults | FilesTlsDefaults {
  const certificatePath = context.tlsCertificatePath?.trim();
  const keyPath = context.tlsKeyPath?.trim();
  if (certificatePath && keyPath) {
    return buildFilesTls(publicHost, certificatePath, keyPath);
  }
  return buildAcmeTls(publicHost, context);
}

function requireXrayFilesTlsPaths(
  protocol: InboundProtocol,
  context: InboundDefaultsContext,
): { certificatePath: string; keyPath: string } {
  const certificatePath = context.tlsCertificatePath?.trim();
  const keyPath = context.tlsKeyPath?.trim();
  if (!certificatePath || !keyPath) {
    throw new Error(`${protocol} defaults require configured VPN TLS certificate and key paths`);
  }
  return { certificatePath, keyPath };
}

function listenFields(
  protocol: InboundProtocol,
  context: InboundDefaultsContext,
  overrides?: InboundListenOverrides,
) {
  const published = publishedListenPortForProtocol(protocol, context);
  const listenPort = overrides?.listenPort ?? published;
  return {
    listenHost: overrides?.listenHost ?? '0.0.0.0',
    listenPort,
    publicHost: overrides?.publicHost ?? context.publicHost,
    publicPort: overrides?.publicPort ?? listenPort,
    enabled: overrides?.enabled ?? true,
  };
}

export function buildDefaultInboundSettings(
  protocol: InboundProtocol,
  context: InboundDefaultsContext,
  overrides?: InboundListenOverrides,
):
  | Hysteria2InboundSettings
  | VlessRealityInboundSettings
  | VlessXhttpTlsInboundSettings
  | VlessGrpcTlsInboundSettings
  | VlessTcpTlsInboundSettings
  | TrojanInboundSettings
  | ShadowsocksInboundSettings {
  const publicHost = overrides?.publicHost ?? context.publicHost;
  const common = listenFields(protocol, { ...context, publicHost }, overrides);

  const tls = buildDefaultTls(publicHost, { ...context, publicHost });

  switch (protocol) {
    case 'HYSTERIA2':
      return {
        ...common,
        upMbps: null,
        downMbps: null,
        ignoreClientBandwidth: false,
        obfs: null,
        tls,
        masquerade: null,
        bindInterface: null,
        routingMark: null,
        reuseAddr: false,
        netns: null,
        tcpFastOpen: false,
        tcpMultiPath: false,
        disableTcpKeepAlive: false,
        tcpKeepAlive: null,
        tcpKeepAliveInterval: null,
        udpFragment: null,
        udpTimeout: null,
        detour: null,
        brutalDebug: false,
      };
    case 'VLESS_REALITY':
      return {
        ...common,
        handshakeServer: 'www.cloudflare.com',
        handshakePort: 443,
        serverNames: ['www.cloudflare.com'],
        shortIds: [''],
        flow: 'xtls-rprx-vision',
        transport: 'none',
        fingerprint: 'chrome',
      };
    case 'TROJAN':
      return {
        ...common,
        tls,
        fallback: null,
      };
    case 'SHADOWSOCKS':
      return {
        ...common,
        method: '2022-blake3-aes-256-gcm',
      };
    case 'VLESS_XHTTP_TLS': {
      const paths = requireXrayFilesTlsPaths(protocol, context);
      return {
        ...common,
        path: '/',
        host: publicHost,
        mode: 'auto',
        tls: {
          mode: 'FILES',
          sni: publicHost,
          certificatePath: paths.certificatePath,
          keyPath: paths.keyPath,
        },
      };
    }
    case 'VLESS_GRPC_TLS': {
      const paths = requireXrayFilesTlsPaths(protocol, context);
      return {
        ...common,
        serviceName: 'GunService',
        tls: {
          mode: 'FILES',
          sni: publicHost,
          certificatePath: paths.certificatePath,
          keyPath: paths.keyPath,
        },
      };
    }
    case 'VLESS_TCP_TLS': {
      const paths = requireXrayFilesTlsPaths(protocol, context);
      return {
        ...common,
        flow: 'xtls-rprx-vision',
        tls: {
          mode: 'FILES',
          sni: publicHost,
          certificatePath: paths.certificatePath,
          keyPath: paths.keyPath,
        },
      };
    }
  }
}

function syncTlsPublicHost(settings: Record<string, unknown>, host: string): void {
  const tls = settings.tls;
  if (typeof tls !== 'object' || tls === null) {
    return;
  }
  const tlsRecord = { ...(tls as Record<string, unknown>) };
  if (tlsRecord.mode === 'ACME') {
    const previousSni = typeof tlsRecord.sni === 'string' ? tlsRecord.sni : '';
    const previousEmail = typeof tlsRecord.email === 'string' ? tlsRecord.email : '';
    const previousDefaultEmail = defaultAcmeEmail(previousSni);
    tlsRecord.sni = host;
    tlsRecord.domains = [host];
    const nextEmail = defaultAcmeEmail(host);
    if (
      nextEmail &&
      (!previousEmail || (previousDefaultEmail && previousEmail === previousDefaultEmail))
    ) {
      tlsRecord.email = nextEmail;
    }
    settings.tls = tlsRecord;
  } else if (tlsRecord.mode === 'FILES') {
    tlsRecord.sni = host;
    settings.tls = tlsRecord;
  }
}

export function applyVpnPublicHostFallback(
  body: unknown,
  vpnPublicHost: string | undefined | null,
): unknown {
  const host = vpnPublicHost?.trim();
  if (!host || typeof body !== 'object' || body === null) {
    return body;
  }
  const record = body as Record<string, unknown>;
  const settings = record.settings;
  if (typeof settings !== 'object' || settings === null) {
    return body;
  }
  const settingsRecord = { ...(settings as Record<string, unknown>) };
  const currentHost =
    typeof settingsRecord.publicHost === 'string' ? settingsRecord.publicHost.trim() : '';
  if (currentHost) {
    return body;
  }
  settingsRecord.publicHost = host;
  if (
    record.protocol === 'VLESS_XHTTP_TLS' &&
    (typeof settingsRecord.host !== 'string' || !settingsRecord.host.trim())
  ) {
    settingsRecord.host = host;
  }
  syncTlsPublicHost(settingsRecord, host);
  return { ...record, settings: settingsRecord };
}

/**
 * Fills missing Xray FILES TLS cert paths from install env defaults.
 * Does not override explicit paths or inline PEM.
 */
export function applyVpnTlsPathsFallback(
  body: unknown,
  certificatePath: string | undefined | null,
  keyPath: string | undefined | null,
): unknown {
  const cert = certificatePath?.trim();
  const key = keyPath?.trim();
  if (!cert || !key || typeof body !== 'object' || body === null) {
    return body;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.protocol !== 'string' ||
    !XRAY_FILES_TLS_PROTOCOLS.has(record.protocol as InboundProtocol)
  ) {
    return body;
  }
  const settings = record.settings;
  if (typeof settings !== 'object' || settings === null) {
    return body;
  }
  const settingsRecord = { ...(settings as Record<string, unknown>) };
  const tls = settingsRecord.tls;
  const tlsRecord: Record<string, unknown> =
    typeof tls === 'object' && tls !== null
      ? { ...(tls as Record<string, unknown>) }
      : { mode: 'FILES' };
  if (tlsRecord.mode !== undefined && tlsRecord.mode !== 'FILES') {
    return body;
  }
  const hasInline =
    (typeof tlsRecord.certificatePem === 'string' && tlsRecord.certificatePem.trim()) ||
    (typeof tlsRecord.privateKeyPem === 'string' && tlsRecord.privateKeyPem.trim());
  if (hasInline) {
    return body;
  }
  const hasCertPath =
    typeof tlsRecord.certificatePath === 'string' && tlsRecord.certificatePath.trim();
  const hasKeyPath = typeof tlsRecord.keyPath === 'string' && tlsRecord.keyPath.trim();
  if (hasCertPath && hasKeyPath) {
    return body;
  }
  tlsRecord.mode = 'FILES';
  if (!hasCertPath) {
    tlsRecord.certificatePath = cert;
  }
  if (!hasKeyPath) {
    tlsRecord.keyPath = key;
  }
  if (typeof tlsRecord.sni !== 'string' || !tlsRecord.sni.trim()) {
    const publicHost =
      typeof settingsRecord.publicHost === 'string' ? settingsRecord.publicHost.trim() : '';
    if (publicHost) {
      tlsRecord.sni = publicHost;
    }
  }
  settingsRecord.tls = tlsRecord;
  return { ...record, settings: settingsRecord };
}
