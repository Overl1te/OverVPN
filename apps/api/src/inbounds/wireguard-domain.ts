import { generateKeyPairSync, randomInt } from 'node:crypto';
import type {
  WireguardInboundPublicConfig,
  WireguardInboundSettings,
} from '@overvpn/shared/schemas';
import type {
  WireguardCredential,
  WireguardInboundSecrets,
} from '../core/core-provider';
import { formatUriHost, rfc3986 } from './share-link-utils';

export interface WireguardStorage {
  publicConfig: WireguardInboundPublicConfig;
  secrets: WireguardInboundSecrets;
}

export interface WireguardKeypair {
  privateKey: string;
  publicKey: string;
}

export function generateWireguardKeypair(): WireguardKeypair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  if (!privateJwk.d || !publicJwk.x) {
    throw new Error('Failed to export WireGuard X25519 keypair');
  }
  return {
    privateKey: base64UrlToBase64(privateJwk.d),
    publicKey: base64UrlToBase64(publicJwk.x),
  };
}

export function buildWireguardStorage(
  settings: WireguardInboundSettings,
  previous?: WireguardStorage,
): WireguardStorage {
  const supplied =
    settings.privateKey && settings.publicKey
      ? { privateKey: settings.privateKey, publicKey: settings.publicKey }
      : undefined;
  const keys = supplied ?? previous?.secrets ?? generateWireguardKeypair();
  return {
    publicConfig: {
      address: settings.address,
      mtu: settings.mtu,
      privateKeyPresent: true,
      publicKeyPresent: true,
    },
    secrets: {
      version: 1,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    },
  };
}

export function createWireguardCredential(
  serverAddress: string,
): WireguardCredential {
  const keys = generateWireguardKeypair();
  const [serverIp] = serverAddress.split('/');
  const octets = (serverIp ?? '10.66.0.1').split('.');
  const prefix = octets.slice(0, 3).join('.');
  return {
    version: 1,
    ...keys,
    address: `${prefix}.${randomInt(2, 255)}/32`,
  };
}

export function buildWireguardUri(input: {
  privateKey: string;
  publicKey: string;
  serverPublicKey: string;
  address: string;
  host: string;
  port: number;
  mtu: number;
  label: string;
}): string {
  const query = new URLSearchParams({
    public_key: input.publicKey,
    server_public_key: input.serverPublicKey,
    address: input.address,
    mtu: String(input.mtu),
    allowed_ips: '0.0.0.0/0,::/0',
  });
  return `wg://${rfc3986(input.privateKey)}@${formatUriHost(input.host)}:${input.port}?${query.toString()}#${rfc3986(input.label)}`;
}

function base64UrlToBase64(value: string): string {
  return value.replace(/-/g, '+').replace(/_/g, '/').padEnd(44, '=');
}
