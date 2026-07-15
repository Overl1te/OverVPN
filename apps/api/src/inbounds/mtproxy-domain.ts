import { randomBytes } from 'node:crypto';
import type {
  MtproxyInboundPublicConfig,
  MtproxyInboundSettings,
  MtproxySecretMode,
} from '@overvpn/shared/schemas';
import type {
  MtproxyInboundSecrets,
  PasswordCredential,
} from '../core/core-provider';
import { formatUriHost, rfc3986 } from './share-link-utils';

export interface MtproxyStorage {
  publicConfig: MtproxyInboundPublicConfig;
  secrets: MtproxyInboundSecrets;
}

export function generateMtproxySecret(): string {
  return randomBytes(16).toString('hex');
}

export function normalizeMtproxySecret(supplied?: string): string {
  if (!supplied) {
    return generateMtproxySecret();
  }
  const normalized = supplied.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw new Error('MTProxy secret must be 32 lowercase hex characters');
  }
  return normalized;
}

export function createMtproxyCredential(secret?: string): PasswordCredential {
  return {
    version: 1,
    password: normalizeMtproxySecret(secret),
  };
}

export function buildMtproxyStorage(
  settings: MtproxyInboundSettings,
): MtproxyStorage {
  const tlsDomain =
    settings.secretMode === 'TLS' ? (settings.tlsDomain?.trim() ?? null) : null;
  return {
    publicConfig: {
      secretMode: settings.secretMode,
      tlsDomain,
    },
    secrets: { version: 1 },
  };
}

/** Client-facing Telegram secret (may include dd/ee prefix). */
export function formatMtproxyClientSecret(
  rawSecret: string,
  mode: MtproxySecretMode,
  tlsDomain: string | null | undefined,
): string {
  const secret = normalizeMtproxySecret(rawSecret);
  if (mode === 'CLASSIC') {
    return secret;
  }
  if (mode === 'SECURE') {
    return `dd${secret}`;
  }
  const domain = tlsDomain?.trim();
  if (!domain) {
    throw new Error('MTProxy TLS mode requires tlsDomain');
  }
  return `ee${secret}${Buffer.from(domain, 'utf8').toString('hex')}`;
}

export function buildMtproxyUri(input: {
  host: string;
  port: number;
  secret: string;
  mode: MtproxySecretMode;
  tlsDomain?: string | null;
  scheme?: 'https' | 'tg';
}): string {
  const clientSecret = formatMtproxyClientSecret(
    input.secret,
    input.mode,
    input.tlsDomain,
  );
  const host = formatUriHost(input.host);
  const query = `server=${rfc3986(host)}&port=${input.port}&secret=${rfc3986(clientSecret)}`;
  if (input.scheme === 'tg') {
    return `tg://proxy?${query}`;
  }
  return `https://t.me/proxy?${query}`;
}
