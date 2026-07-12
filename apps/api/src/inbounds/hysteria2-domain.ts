import { randomBytes } from 'node:crypto';
import type {
  Hysteria2InboundPublicConfig,
  Hysteria2InboundSettings,
} from '@overvpn/shared/schemas';
import type {
  Hysteria2Credential,
  Hysteria2InboundSecrets,
} from '../core/core-provider';
import {
  formatUriHost,
  hasControlCharacter,
  rfc3986,
} from './share-link-utils';

export interface Hysteria2Storage {
  publicConfig: Hysteria2InboundPublicConfig;
  secrets: Hysteria2InboundSecrets;
}

export function generateHysteria2Password(): string {
  return randomBytes(32).toString('base64url');
}

export function normalizeHysteria2Password(
  supplied: string | undefined,
): string {
  const password = supplied ?? generateHysteria2Password();
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < 8 || bytes > 128 || hasControlCharacter(password)) {
    throw new Error(
      'Hysteria2 passwords must be 8-128 UTF-8 bytes without control characters',
    );
  }
  return password;
}

export function createCredential(password?: string): Hysteria2Credential {
  return {
    version: 1,
    password: normalizeHysteria2Password(password),
  };
}

export function buildHysteria2Storage(
  settings: Hysteria2InboundSettings,
  previous?: Hysteria2Storage,
): Hysteria2Storage {
  const secrets: Hysteria2InboundSecrets = { version: 1 };
  const obfsPassword = settings.obfs
    ? (settings.obfs.password ??
      previous?.secrets.obfsPassword ??
      generateHysteria2Password())
    : undefined;
  if (obfsPassword) {
    secrets.obfsPassword = normalizeHysteria2Password(obfsPassword);
  }

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
  let tls: Hysteria2InboundPublicConfig['tls'];
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
      upMbps: settings.upMbps,
      downMbps: settings.downMbps,
      ignoreClientBandwidth: settings.ignoreClientBandwidth,
      obfs: settings.obfs
        ? {
            type: 'SALAMANDER',
            passwordPresent: true,
          }
        : null,
      tls,
      masquerade: settings.masquerade,
      bindInterface: settings.bindInterface,
      routingMark: settings.routingMark,
      reuseAddr: settings.reuseAddr,
      netns: settings.netns,
      tcpFastOpen: settings.tcpFastOpen,
      tcpMultiPath: settings.tcpMultiPath,
      disableTcpKeepAlive: settings.disableTcpKeepAlive,
      tcpKeepAlive: settings.tcpKeepAlive,
      tcpKeepAliveInterval: settings.tcpKeepAliveInterval,
      udpFragment: settings.udpFragment,
      udpTimeout: settings.udpTimeout,
      detour: settings.detour,
      brutalDebug: settings.brutalDebug,
    },
    secrets,
  };
}

export function buildHysteria2Uri(input: {
  password: string;
  host: string;
  port: number;
  sni: string;
  insecure: boolean;
  obfsPassword?: string;
  label: string;
}): string {
  const host = formatUriHost(input.host);
  const query = [
    ['sni', input.sni],
    ['insecure', input.insecure ? '1' : '0'],
    ...(input.obfsPassword
      ? [
          ['obfs', 'salamander'],
          ['obfs-password', input.obfsPassword],
        ]
      : []),
  ]
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');
  return `hysteria2://${rfc3986(input.password)}@${host}:${
    input.port
  }/?${query}#${rfc3986(input.label)}`;
}

function publicDns01(
  challenge: Extract<
    Hysteria2InboundSettings['tls'],
    { mode: 'ACME' }
  >['dns01Challenge'] & {},
  secrets: Hysteria2InboundSecrets,
): Extract<
  Hysteria2InboundPublicConfig['tls'],
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
