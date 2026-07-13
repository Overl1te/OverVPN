import type {
  VlessXhttpTlsInboundSettings,
  VlessXhttpTlsPublicConfig,
} from '@overvpn/shared/schemas';
import type { VlessXhttpTlsInboundSecrets } from '../core/core-provider';
import { formatUriHost, rfc3986 } from './share-link-utils';

export interface VlessXhttpTlsStorage {
  publicConfig: VlessXhttpTlsPublicConfig;
  secrets: VlessXhttpTlsInboundSecrets;
}

export function buildVlessXhttpTlsStorage(
  settings: VlessXhttpTlsInboundSettings,
  previous?: VlessXhttpTlsStorage,
): VlessXhttpTlsStorage {
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
      'VLESS xHTTP TLS inbound requires certificate and private key PEM',
    );
  }

  const secrets: VlessXhttpTlsInboundSecrets = { version: 1 };
  if (certificatePem && privateKeyPem) {
    secrets.certificatePem = certificatePem;
    secrets.privateKeyPem = privateKeyPem;
  }

  return {
    publicConfig: {
      path: settings.path,
      host: settings.host,
      mode: settings.mode,
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

export function buildVlessXhttpTlsUri(input: {
  uuid: string;
  host: string;
  port: number;
  path: string;
  sni: string;
  mode: string;
  label: string;
  xhttpHost?: string | null;
}): string {
  const host = formatUriHost(input.host);
  const query = [
    ['encryption', 'none'],
    ['security', 'tls'],
    ['type', 'xhttp'],
    ['path', input.path],
    ...(input.xhttpHost ? [['host', input.xhttpHost] as const] : []),
    ['sni', input.sni],
    ['fp', 'chrome'],
    ['mode', input.mode],
  ]
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
  return `vless://${rfc3986(input.uuid)}@${host}:${input.port}?${query}#${rfc3986(
    input.label,
  )}`;
}
