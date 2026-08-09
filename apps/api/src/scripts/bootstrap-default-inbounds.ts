import {
  buildDefaultInboundSettings,
  type InboundDefaultsContext,
} from '@overvpn/shared';
import {
  INBOUND_PROTOCOLS,
  type InboundProtocol,
} from '@overvpn/shared/constants';

const apiBase = process.env.BOOTSTRAP_API_URL ?? 'http://127.0.0.1:3000/api';
const username = process.env.BOOTSTRAP_ADMIN_USER ?? '';
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
const selected = new Set(
  (process.env.ENABLED_PROTOCOLS ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is InboundProtocol =>
      INBOUND_PROTOCOLS.includes(value as InboundProtocol),
    ),
);

function numberFromEnvironment(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function jsonRequest<T>(
  path: string,
  init: RequestInit,
  accessToken?: string,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body as T;
}

async function bootstrapDefaultInbounds(): Promise<void> {
  if (!username || !password || selected.size === 0) {
    throw new Error(
      'BOOTSTRAP_ADMIN_USER, BOOTSTRAP_ADMIN_PASSWORD, and ENABLED_PROTOCOLS are required',
    );
  }

  const login = await jsonRequest<{ accessToken?: string }>(
    '/admin/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    },
  );
  if (!login.accessToken) {
    throw new Error('Bootstrap owner login did not return an access token');
  }

  const existing = await jsonRequest<{
    items: Array<{ tag: string }>;
  }>(
    '/admin/inbounds?page=1&pageSize=100',
    { method: 'GET' },
    login.accessToken,
  );
  const existingTags = new Set(existing.items.map((inbound) => inbound.tag));

  const proxies = await jsonRequest<{
    items: Array<{ id: string; isLocal: boolean }>;
  }>(
    '/admin/proxy-servers?page=1&pageSize=50',
    { method: 'GET' },
    login.accessToken,
  );
  const proxyServerId =
    process.env.BOOTSTRAP_PROXY_SERVER_ID?.trim() ||
    proxies.items.find((item) => item.isLocal)?.id ||
    proxies.items[0]?.id;
  if (!proxyServerId) {
    throw new Error(
      'No proxy server found; create one or set BOOTSTRAP_PROXY_SERVER_ID',
    );
  }

  const context: InboundDefaultsContext = {
    publicHost: process.env.VPN_PUBLIC_HOST ?? '',
    acmeHttpPort: numberFromEnvironment('SING_BOX_ACME_HTTP_PORT', 80),
    acmeTlsPort: numberFromEnvironment('SING_BOX_ACME_TLS_PORT', 443),
    singBoxUdpPort: numberFromEnvironment('SING_BOX_UDP_PORT', 443),
    singBoxTcpPort: numberFromEnvironment('SING_BOX_TCP_PORT', 4443),
    singBoxTrojanPort: numberFromEnvironment('SING_BOX_TROJAN_PORT', 8444),
    singBoxSsPort: numberFromEnvironment('SING_BOX_SS_PORT', 8445),
    singBoxWgPort: numberFromEnvironment('SING_BOX_WG_PORT', 51_820),
    xrayListenPort: numberFromEnvironment('XRAY_LISTEN_PORT', 8443),
    xrayGrpcPort: numberFromEnvironment('XRAY_GRPC_PORT', 8446),
    xrayTcpTlsPort: numberFromEnvironment('XRAY_TCP_TLS_PORT', 8447),
    xrayTrojanPort: numberFromEnvironment('XRAY_TROJAN_PORT', 8448),
    xraySsPort: numberFromEnvironment('XRAY_SS_PORT', 8449),
    xrayWgPort: numberFromEnvironment('XRAY_WG_PORT', 51_821),
    mtproxyPortMin: numberFromEnvironment('MTPROXY_PORT_MIN', 10_001),
    mtproxyPortMax: numberFromEnvironment('MTPROXY_PORT_MAX', 10_016),
    tlsCertificatePath: process.env.VPN_TLS_CERTIFICATE_PATH || null,
    tlsKeyPath: process.env.VPN_TLS_KEY_PATH || null,
  };

  for (const protocol of INBOUND_PROTOCOLS) {
    if (!selected.has(protocol)) continue;
    const tag = `default-${protocol.toLowerCase().replaceAll('_', '-')}`;
    if (existingTags.has(tag)) {
      console.info(`Default inbound already exists: ${tag}`);
      continue;
    }
    try {
      const settings = buildDefaultInboundSettings(protocol, context);
      await jsonRequest(
        '/admin/inbounds',
        {
          method: 'POST',
          body: JSON.stringify({ tag, protocol, settings, proxyServerId }),
        },
        login.accessToken,
      );
      console.info(`Created default inbound: ${tag}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipped ${protocol}: ${message}`);
    }
  }
}

bootstrapDefaultInbounds().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to bootstrap default inbounds: ${message}`);
  process.exitCode = 1;
});
