import { randomUUID } from 'node:crypto';
import type {
  VlessRealityInboundPublicConfig,
  VlessRealityInboundSettings,
} from '@overvpn/shared/schemas';
import type { ProcessAdapter } from '../core/core-adapters';
import type {
  VlessCredential,
  VlessRealityInboundSecrets,
} from '../core/core-provider';
import { formatUriHost, rfc3986 } from './share-link-utils';

export interface VlessRealityStorage {
  publicConfig: VlessRealityInboundPublicConfig;
  secrets: VlessRealityInboundSecrets;
}

export interface RealityKeypair {
  privateKey: string;
  publicKey: string;
}

/**
 * Generates a Reality X25519 keypair via the pinned sing-box binary
 * (`sing-box generate reality-keypair`) so keys match client expectations.
 */
export async function generateRealityKeypair(
  processAdapter: ProcessAdapter,
  binaryPath: string,
  timeoutMs: number,
): Promise<RealityKeypair> {
  const result = await processAdapter.run(
    binaryPath,
    ['generate', 'reality-keypair'],
    timeoutMs,
  );
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(
      result.timedOut
        ? `sing-box reality-keypair timed out after ${timeoutMs}ms`
        : result.stderr.trim() ||
            result.stdout.trim() ||
            `sing-box reality-keypair exited with code ${String(result.exitCode)}`,
    );
  }
  const privateKey = matchKey(result.stdout, /PrivateKey:\s*(\S+)/i);
  const publicKey = matchKey(result.stdout, /PublicKey:\s*(\S+)/i);
  if (!privateKey || !publicKey) {
    throw new Error('sing-box reality-keypair output was missing keys');
  }
  return { privateKey, publicKey };
}

export function createVlessCredential(uuid?: string): VlessCredential {
  return {
    version: 1,
    uuid: normalizeUuid(uuid ?? randomUUID()),
  };
}

export function buildVlessRealityStorage(
  settings: VlessRealityInboundSettings,
  keypair: RealityKeypair | undefined,
  previous?: VlessRealityStorage,
): VlessRealityStorage {
  const privateKey =
    settings.privateKey ?? keypair?.privateKey ?? previous?.secrets.privateKey;
  const publicKey =
    settings.publicKey ?? keypair?.publicKey ?? previous?.secrets.publicKey;
  if (!privateKey || !publicKey) {
    throw new Error('VLESS Reality inbound requires a Reality keypair');
  }

  return {
    publicConfig: {
      handshakeServer: settings.handshakeServer,
      handshakePort: settings.handshakePort,
      serverNames: settings.serverNames,
      shortIds: settings.shortIds,
      flow: settings.flow,
      transport: settings.transport,
      fingerprint: settings.fingerprint,
      publicKeyPresent: true,
      privateKeyPresent: true,
    },
    secrets: {
      version: 1,
      privateKey,
      publicKey,
    },
  };
}

export function buildVlessUri(input: {
  uuid: string;
  host: string;
  port: number;
  sni: string;
  fingerprint: string;
  publicKey: string;
  shortId: string;
  flow: string;
  label: string;
}): string {
  const host = formatUriHost(input.host);
  const query = [
    ['encryption', 'none'],
    ['security', 'reality'],
    ['sni', input.sni],
    ['fp', input.fingerprint],
    ['pbk', input.publicKey],
    ['sid', input.shortId],
    ['type', 'tcp'],
    ...(input.flow ? [['flow', input.flow] as const] : []),
  ]
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
  return `vless://${rfc3986(input.uuid)}@${host}:${input.port}?${query}#${rfc3986(
    input.label,
  )}`;
}

function normalizeUuid(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw new Error('VLESS credentials require a UUID v4-compatible value');
  }
  return normalized;
}

function matchKey(stdout: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(stdout);
  return match?.[1];
}
