import { randomBytes } from 'node:crypto';
import type {
  TrojanInboundPublicConfig,
  TrojanInboundSettings,
} from '@overvpn/shared/schemas';
import type {
  PasswordCredential,
  TrojanInboundSecrets,
} from '../core/core-provider';
import {
  formatUriHost,
  hasControlCharacter,
  rfc3986,
} from './share-link-utils';

export interface TrojanStorage {
  publicConfig: TrojanInboundPublicConfig;
  secrets: TrojanInboundSecrets;
}

export function generateTrojanPassword(): string {
  return randomBytes(32).toString('base64url');
}

export function normalizeTrojanPassword(supplied: string | undefined): string {
  const password = supplied ?? generateTrojanPassword();
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < 8 || bytes > 128 || hasControlCharacter(password)) {
    throw new Error(
      'Trojan passwords must be 8-128 UTF-8 bytes without control characters',
    );
  }
  return password;
}

export function createTrojanCredential(password?: string): PasswordCredential {
  return {
    version: 1,
    password: normalizeTrojanPassword(password),
  };
}

export function buildTrojanStorage(
  settings: TrojanInboundSettings,
  previous?: TrojanStorage,
): TrojanStorage {
  const secrets: TrojanInboundSecrets = { version: 1 };
  const commonTls = {
    sni: settings.tls.sni,
    alpn: settings.tls.alpn,
    minVersion: settings.tls.minVersion,
    ...(settings.tls.maxVersion ? { maxVersion: settings.tls.maxVersion } : {}),
    cipherSuites: settings.tls.cipherSuites,
    curvePreferences: settings.tls.curvePreferences,
    kernelTx: settings.tls.kernelTx,
    kernelRx: settings.tls.kernelRx,
    clientInsecure: settings.tls.clientInsecure,
  };
  let tls: TrojanInboundPublicConfig['tls'];
  if (settings.tls.mode === 'FILES') {
    const usesPaths = Boolean(
      settings.tls.certificatePath && settings.tls.keyPath,
    );
    const certificatePem = usesPaths
      ? undefined
      : (settings.tls.certificatePem ??
        (previous?.publicConfig.tls.mode === 'FILES'
          ? previous.secrets.certificatePem
          : undefined));
    const privateKeyPem = usesPaths
      ? undefined
      : (settings.tls.privateKeyPem ??
        (previous?.publicConfig.tls.mode === 'FILES'
          ? previous.secrets.privateKeyPem
          : undefined));
    if (certificatePem) secrets.certificatePem = certificatePem;
    if (privateKeyPem) secrets.privateKeyPem = privateKeyPem;
    tls = {
      mode: 'FILES',
      ...commonTls,
      certificatePath: settings.tls.certificatePath ?? null,
      keyPath: settings.tls.keyPath ?? null,
      certificatePemPresent: Boolean(certificatePem),
      privateKeyPemPresent: Boolean(privateKeyPem),
    };
  } else {
    const externalAccount = settings.tls.externalAccount
      ? {
          keyId: settings.tls.externalAccount.keyId,
          macKeyPresent: true,
        }
      : null;
    if (settings.tls.externalAccount) {
      secrets.acmeExternalAccountMacKey = settings.tls.externalAccount.macKey;
    }
    const dns01Challenge = settings.tls.dns01Challenge
      ? publicDns01(settings.tls.dns01Challenge, secrets)
      : null;
    tls = {
      mode: 'ACME',
      ...commonTls,
      domains: settings.tls.domains,
      dataDirectory: settings.tls.dataDirectory,
      defaultServerName: settings.tls.defaultServerName ?? null,
      email: settings.tls.email ?? null,
      provider: settings.tls.provider,
      disableHttpChallenge: settings.tls.disableHttpChallenge,
      disableTlsAlpnChallenge: settings.tls.disableTlsAlpnChallenge,
      alternativeHttpPort: settings.tls.alternativeHttpPort ?? null,
      alternativeTlsPort: settings.tls.alternativeTlsPort ?? null,
      externalAccount,
      dns01Challenge,
    };
  }

  return {
    publicConfig: {
      tls,
      fallback: settings.fallback
        ? {
            server: settings.fallback.server,
            serverPort: settings.fallback.serverPort,
          }
        : null,
    },
    secrets,
  };
}

export function buildTrojanUri(input: {
  password: string;
  host: string;
  port: number;
  sni: string;
  insecure: boolean;
  alpn: string[];
  label: string;
}): string {
  const host = formatUriHost(input.host);
  const query = [
    ['security', 'tls'],
    ['sni', input.sni],
    ['allowInsecure', input.insecure ? '1' : '0'],
    ...(input.alpn.length > 0 ? [['alpn', input.alpn.join(',')]] : []),
    ['type', 'tcp'],
  ]
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
  return `trojan://${rfc3986(input.password)}@${host}:${input.port}?${query}#${rfc3986(
    input.label,
  )}`;
}

function publicDns01(
  challenge: Extract<
    TrojanInboundSettings['tls'],
    { mode: 'ACME' }
  >['dns01Challenge'] & {},
  secrets: TrojanInboundSecrets,
): Extract<
  TrojanInboundPublicConfig['tls'],
  { mode: 'ACME' }
>['dns01Challenge'] {
  if (challenge.provider === 'alidns') {
    secrets.acmeAliDnsAccessKeySecret = challenge.accessKeySecret;
    if (challenge.securityToken) {
      secrets.acmeAliDnsSecurityToken = challenge.securityToken;
    }
    return {
      provider: 'alidns',
      accessKeyId: challenge.accessKeyId,
      accessKeySecretPresent: true,
      regionId: challenge.regionId ?? null,
      securityTokenPresent: Boolean(challenge.securityToken),
    };
  }
  if (challenge.provider === 'cloudflare') {
    if (challenge.apiToken) secrets.acmeCloudflareApiToken = challenge.apiToken;
    if (challenge.zoneToken) {
      secrets.acmeCloudflareZoneToken = challenge.zoneToken;
    }
    return {
      provider: 'cloudflare',
      apiTokenPresent: Boolean(challenge.apiToken),
      zoneTokenPresent: Boolean(challenge.zoneToken),
    };
  }
  secrets.acmeDnsPassword = challenge.password;
  return {
    provider: 'acme-dns',
    username: challenge.username,
    passwordPresent: true,
    subdomain: challenge.subdomain,
    serverUrl: challenge.serverUrl,
  };
}
