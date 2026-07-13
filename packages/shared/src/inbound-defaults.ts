import type { InboundProtocol } from './constants.js';
import type {
  Hysteria2InboundSettings,
  ShadowsocksInboundSettings,
  TrojanInboundSettings,
  VlessRealityInboundSettings,
  VlessXhttpTlsInboundSettings,
} from './schemas.js';

export type InboundDefaultsContext = {
  publicHost: string;
  acmeHttpPort?: number;
  acmeTlsPort?: number;
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

function listenFields(context: InboundDefaultsContext, overrides?: InboundListenOverrides) {
  return {
    listenHost: overrides?.listenHost ?? '0.0.0.0',
    listenPort: overrides?.listenPort ?? 443,
    publicHost: overrides?.publicHost ?? context.publicHost,
    publicPort: overrides?.publicPort,
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
  | TrojanInboundSettings
  | ShadowsocksInboundSettings {
  const publicHost = overrides?.publicHost ?? context.publicHost;
  const common = listenFields({ ...context, publicHost }, overrides);

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
        listenPort: overrides?.listenPort ?? 8388,
        method: '2022-blake3-aes-256-gcm',
      };
    case 'VLESS_XHTTP_TLS':
      if (!context.tlsCertificatePath?.trim() || !context.tlsKeyPath?.trim()) {
        throw new Error(
          'VLESS_XHTTP_TLS defaults require configured VPN TLS certificate and key paths',
        );
      }
      return {
        ...common,
        path: '/',
        host: publicHost,
        mode: 'auto',
        tls: {
          mode: 'FILES',
          sni: publicHost,
          certificatePath: context.tlsCertificatePath.trim(),
          keyPath: context.tlsKeyPath.trim(),
        },
      };
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
