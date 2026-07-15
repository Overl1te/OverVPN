import type {
  VlessTcpTlsInboundSettings,
  VlessTcpTlsPublicConfig,
} from '@overvpn/shared/schemas';
import type { VlessTcpTlsInboundSecrets } from '../core/core-provider';
import { formatUriHost, rfc3986 } from './share-link-utils';

export interface VlessTcpTlsStorage {
  publicConfig: VlessTcpTlsPublicConfig;
  secrets: VlessTcpTlsInboundSecrets;
}

export function buildVlessTcpTlsStorage(
  settings: VlessTcpTlsInboundSettings,
  previous?: VlessTcpTlsStorage,
): VlessTcpTlsStorage {
  const usesPaths = Boolean(
    settings.tls.certificatePath && settings.tls.keyPath,
  );
  const certificatePem = usesPaths
    ? undefined
    : (settings.tls.certificatePem ?? previous?.secrets.certificatePem);
  const privateKeyPem = usesPaths
    ? undefined
    : (settings.tls.privateKeyPem ?? previous?.secrets.privateKeyPem);

  if (!usesPaths && (!certificatePem || !privateKeyPem)) {
    throw new Error(
      'VLESS TCP TLS inbound requires certificate and private key PEM',
    );
  }

  const secrets: VlessTcpTlsInboundSecrets = { version: 1 };
  if (certificatePem && privateKeyPem) {
    secrets.certificatePem = certificatePem;
    secrets.privateKeyPem = privateKeyPem;
  }

  return {
    publicConfig: {
      flow: settings.flow,
      tls: {
        mode: 'FILES',
        sni: settings.tls.sni,
        certificatePath: settings.tls.certificatePath ?? null,
        keyPath: settings.tls.keyPath ?? null,
        certificatePemPresent: Boolean(certificatePem),
        privateKeyPemPresent: Boolean(privateKeyPem),
      },
    },
    secrets,
  };
}

export function buildVlessTcpTlsUri(input: {
  uuid: string;
  host: string;
  port: number;
  sni: string;
  flow: string;
  label: string;
}): string {
  const host = formatUriHost(input.host);
  const query = [
    ['encryption', 'none'],
    ['security', 'tls'],
    ['type', 'tcp'],
    ['sni', input.sni],
    ['fp', 'chrome'],
    ...(input.flow ? [['flow', input.flow] as const] : []),
  ]
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
  return `vless://${rfc3986(input.uuid)}@${host}:${input.port}?${query}#${rfc3986(
    input.label,
  )}`;
}
