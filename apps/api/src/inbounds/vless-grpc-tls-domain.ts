import type {
  VlessGrpcTlsInboundSettings,
  VlessGrpcTlsPublicConfig,
} from '@overvpn/shared/schemas';
import type { VlessGrpcTlsInboundSecrets } from '../core/core-provider';
import { formatUriHost, rfc3986 } from './share-link-utils';

export interface VlessGrpcTlsStorage {
  publicConfig: VlessGrpcTlsPublicConfig;
  secrets: VlessGrpcTlsInboundSecrets;
}

export function buildVlessGrpcTlsStorage(
  settings: VlessGrpcTlsInboundSettings,
  previous?: VlessGrpcTlsStorage,
): VlessGrpcTlsStorage {
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
      'VLESS gRPC TLS inbound requires certificate and private key PEM',
    );
  }

  const secrets: VlessGrpcTlsInboundSecrets = { version: 1 };
  if (certificatePem && privateKeyPem) {
    secrets.certificatePem = certificatePem;
    secrets.privateKeyPem = privateKeyPem;
  }

  return {
    publicConfig: {
      serviceName: settings.serviceName,
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

export function buildVlessGrpcTlsUri(input: {
  uuid: string;
  host: string;
  port: number;
  serviceName: string;
  sni: string;
  label: string;
}): string {
  const host = formatUriHost(input.host);
  const query = [
    ['encryption', 'none'],
    ['security', 'tls'],
    ['type', 'grpc'],
    ['serviceName', input.serviceName],
    ['sni', input.sni],
    ['fp', 'chrome'],
  ]
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
  return `vless://${rfc3986(input.uuid)}@${host}:${input.port}?${query}#${rfc3986(
    input.label,
  )}`;
}
