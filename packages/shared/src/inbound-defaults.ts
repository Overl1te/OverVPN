import type { InboundProtocol } from './constants.js';
import type {
  Hysteria2InboundSettings,
  ShadowsocksInboundSettings,
  TrojanInboundSettings,
  VlessRealityInboundSettings,
} from './schemas.js';

export type InboundDefaultsContext = {
  publicHost: string;
  acmeHttpPort?: number;
  acmeTlsPort?: number;
};

export type InboundListenOverrides = {
  listenHost?: string;
  listenPort?: number;
  publicHost?: string;
  publicPort?: number;
  enabled?: boolean;
};

type AcmeTlsDefaults = Extract<Hysteria2InboundSettings['tls'], { mode: 'ACME' }>;

export function defaultAcmeEmail(publicHost: string): string | undefined {
  const host = publicHost.trim();
  if (!host || host.includes('@') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return undefined;
  }
  return `admin@${host}`;
}

function buildAcmeTls(publicHost: string, context: InboundDefaultsContext): AcmeTlsDefaults {
  const email = defaultAcmeEmail(publicHost);
  const tls: AcmeTlsDefaults = {
    mode: 'ACME',
    sni: publicHost,
    alpn: ['h3'],
    domains: publicHost ? [publicHost] : [],
    dataDirectory: '/var/lib/sing-box-state/acme',
    provider: 'letsencrypt',
    minVersion: '1.2',
    disableHttpChallenge: false,
    disableTlsAlpnChallenge: false,
    cipherSuites: [],
    curvePreferences: [],
    kernelTx: false,
    kernelRx: false,
    clientInsecure: false,
    ...(email ? { email } : {}),
  };
  const httpPort = context.acmeHttpPort;
  const tlsPort = context.acmeTlsPort;
  if (httpPort !== undefined && httpPort !== 80) {
    tls.alternativeHttpPort = httpPort;
  }
  if (tlsPort !== undefined && tlsPort !== 443) {
    tls.alternativeTlsPort = tlsPort;
  }
  return tls;
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
  | TrojanInboundSettings
  | ShadowsocksInboundSettings {
  const publicHost = overrides?.publicHost ?? context.publicHost;
  const common = listenFields({ ...context, publicHost }, overrides);

  switch (protocol) {
    case 'HYSTERIA2':
      return {
        ...common,
        upMbps: null,
        downMbps: null,
        ignoreClientBandwidth: false,
        obfs: null,
        tls: buildAcmeTls(publicHost, { ...context, publicHost }),
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
        tls: buildAcmeTls(publicHost, { ...context, publicHost }),
        fallback: null,
      };
    case 'SHADOWSOCKS':
      return {
        ...common,
        listenPort: overrides?.listenPort ?? 8388,
        method: '2022-blake3-aes-256-gcm',
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
  syncTlsPublicHost(settingsRecord, host);
  return { ...record, settings: settingsRecord };
}
