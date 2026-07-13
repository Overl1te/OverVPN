import type { InboundProtocol } from '@overvpn/shared/constants';
import type {
  Hysteria2InboundPublicConfig,
  Hysteria2InboundSettings,
  ShadowsocksInboundPublicConfig,
  ShadowsocksInboundSettings,
  TrojanInboundPublicConfig,
  TrojanInboundSettings,
  VlessRealityInboundPublicConfig,
  VlessRealityInboundSettings,
  VlessXhttpTlsInboundSettings,
  VlessXhttpTlsPublicConfig,
} from '@overvpn/shared/schemas';
import {
  hysteria2InboundPublicConfigSchema,
  shadowsocksInboundPublicConfigSchema,
  trojanInboundPublicConfigSchema,
  vlessRealityInboundPublicConfigSchema,
  vlessXhttpTlsPublicConfigSchema,
} from '@overvpn/shared/schemas';
import type { ProcessAdapter } from '../core/core-adapters';
import type {
  Hysteria2InboundSecrets,
  ShadowsocksInboundSecrets,
  TrojanInboundSecrets,
  VlessRealityInboundSecrets,
  VlessXhttpTlsInboundSecrets,
} from '../core/core-provider';
import {
  buildHysteria2Storage,
  type Hysteria2Storage,
} from './hysteria2-domain';
import {
  buildShadowsocksStorage,
  type ShadowsocksStorage,
} from './shadowsocks-domain';
import { buildTrojanStorage, type TrojanStorage } from './trojan-domain';
import {
  buildVlessRealityStorage,
  generateRealityKeypair,
  type VlessRealityStorage,
} from './vless-reality-domain';
import {
  buildVlessXhttpTlsStorage,
  type VlessXhttpTlsStorage,
} from './vless-xhttp-tls-domain';

export type InboundStorage =
  | { protocol: 'HYSTERIA2'; storage: Hysteria2Storage }
  | { protocol: 'VLESS_REALITY'; storage: VlessRealityStorage }
  | { protocol: 'VLESS_XHTTP_TLS'; storage: VlessXhttpTlsStorage }
  | { protocol: 'TROJAN'; storage: TrojanStorage }
  | { protocol: 'SHADOWSOCKS'; storage: ShadowsocksStorage };

export type InboundPublicConfig =
  | Hysteria2InboundPublicConfig
  | VlessRealityInboundPublicConfig
  | VlessXhttpTlsPublicConfig
  | TrojanInboundPublicConfig
  | ShadowsocksInboundPublicConfig;

export type InboundSecretBundle =
  | Hysteria2InboundSecrets
  | VlessRealityInboundSecrets
  | VlessXhttpTlsInboundSecrets
  | TrojanInboundSecrets
  | ShadowsocksInboundSecrets;

export async function buildInboundStorage(
  protocol: InboundProtocol,
  settings:
    | Hysteria2InboundSettings
    | VlessRealityInboundSettings
    | VlessXhttpTlsInboundSettings
    | TrojanInboundSettings
    | ShadowsocksInboundSettings,
  previous: InboundStorage | undefined,
  deps: {
    processAdapter: ProcessAdapter;
    binaryPath: string;
    processTimeoutMs: number;
  },
): Promise<InboundStorage> {
  if (protocol === 'HYSTERIA2') {
    return {
      protocol,
      storage: buildHysteria2Storage(
        settings as Hysteria2InboundSettings,
        previous?.protocol === 'HYSTERIA2' ? previous.storage : undefined,
      ),
    };
  }
  if (protocol === 'VLESS_REALITY') {
    const vlessSettings = settings as VlessRealityInboundSettings;
    const keypair =
      vlessSettings.privateKey && vlessSettings.publicKey
        ? {
            privateKey: vlessSettings.privateKey,
            publicKey: vlessSettings.publicKey,
          }
        : previous?.protocol === 'VLESS_REALITY'
          ? undefined
          : await generateRealityKeypair(
              deps.processAdapter,
              deps.binaryPath,
              deps.processTimeoutMs,
            );
    return {
      protocol,
      storage: buildVlessRealityStorage(
        vlessSettings,
        keypair,
        previous?.protocol === 'VLESS_REALITY' ? previous.storage : undefined,
      ),
    };
  }
  if (protocol === 'VLESS_XHTTP_TLS') {
    return {
      protocol,
      storage: buildVlessXhttpTlsStorage(
        settings as VlessXhttpTlsInboundSettings,
        previous?.protocol === 'VLESS_XHTTP_TLS'
          ? previous.storage
          : undefined,
      ),
    };
  }
  if (protocol === 'TROJAN') {
    return {
      protocol,
      storage: buildTrojanStorage(
        settings as TrojanInboundSettings,
        previous?.protocol === 'TROJAN' ? previous.storage : undefined,
      ),
    };
  }
  return {
    protocol: 'SHADOWSOCKS',
    storage: buildShadowsocksStorage(
      settings as ShadowsocksInboundSettings,
      previous?.protocol === 'SHADOWSOCKS' ? previous.storage : undefined,
    ),
  };
}

export function parseHysteria2PublicConfig(
  config: unknown,
): Hysteria2InboundPublicConfig {
  return hysteria2InboundPublicConfigSchema.parse(config);
}

export function parseVlessRealityPublicConfig(
  config: unknown,
): VlessRealityInboundPublicConfig {
  return vlessRealityInboundPublicConfigSchema.parse(config);
}

export function parseTrojanPublicConfig(
  config: unknown,
): TrojanInboundPublicConfig {
  return trojanInboundPublicConfigSchema.parse(config);
}

export function parseVlessXhttpTlsPublicConfig(
  config: unknown,
): VlessXhttpTlsPublicConfig {
  return vlessXhttpTlsPublicConfigSchema.parse(config);
}

export function parseShadowsocksPublicConfig(
  config: unknown,
): ShadowsocksInboundPublicConfig {
  return shadowsocksInboundPublicConfigSchema.parse(config);
}

export function parseInboundPublicConfig(
  protocol: InboundProtocol,
  config: unknown,
): InboundPublicConfig {
  if (protocol === 'HYSTERIA2') {
    return parseHysteria2PublicConfig(config);
  }
  if (protocol === 'VLESS_REALITY') {
    return parseVlessRealityPublicConfig(config);
  }
  if (protocol === 'VLESS_XHTTP_TLS') {
    return parseVlessXhttpTlsPublicConfig(config);
  }
  if (protocol === 'TROJAN') {
    return parseTrojanPublicConfig(config);
  }
  return parseShadowsocksPublicConfig(config);
}

export function storageFromInbound(
  protocol: InboundProtocol,
  config: unknown,
  secrets: InboundSecretBundle,
): InboundStorage {
  const publicConfig = parseInboundPublicConfig(protocol, config);
  if (protocol === 'HYSTERIA2') {
    return {
      protocol,
      storage: {
        publicConfig: publicConfig as Hysteria2InboundPublicConfig,
        secrets: secrets,
      },
    };
  }
  if (protocol === 'VLESS_REALITY') {
    return {
      protocol,
      storage: {
        publicConfig: publicConfig as VlessRealityInboundPublicConfig,
        secrets: secrets as VlessRealityInboundSecrets,
      },
    };
  }
  if (protocol === 'VLESS_XHTTP_TLS') {
    return {
      protocol,
      storage: {
        publicConfig: publicConfig as VlessXhttpTlsPublicConfig,
        secrets: secrets as VlessXhttpTlsInboundSecrets,
      },
    };
  }
  if (protocol === 'TROJAN') {
    return {
      protocol,
      storage: {
        publicConfig: publicConfig as TrojanInboundPublicConfig,
        secrets: secrets,
      },
    };
  }
  return {
    protocol: 'SHADOWSOCKS',
    storage: {
      publicConfig: publicConfig as ShadowsocksInboundPublicConfig,
      secrets: secrets as ShadowsocksInboundSecrets,
    },
  };
}

export function encryptableSecrets(
  secrets: InboundSecretBundle,
): string | null {
  return Object.keys(secrets).length === 1 ? null : JSON.stringify(secrets);
}

export function isInboundSecretBundle(
  protocol: InboundProtocol,
  value: Record<string, unknown>,
): value is Record<string, unknown> & InboundSecretBundle {
  if (value.version !== 1) {
    return false;
  }
  const keys = new Set(Object.keys(value));
  if (protocol === 'HYSTERIA2') {
    return [...keys].every(
      (key) =>
        [
          'version',
          'obfsPassword',
          'certificatePem',
          'privateKeyPem',
          'acmeExternalAccountMacKey',
          'acmeAliDnsAccessKeySecret',
          'acmeAliDnsSecurityToken',
          'acmeCloudflareApiToken',
          'acmeCloudflareZoneToken',
          'acmeDnsPassword',
        ].includes(key) &&
        (key === 'version' || typeof value[key] === 'string'),
    );
  }
  if (protocol === 'VLESS_REALITY') {
    return (
      keys.size <= 3 &&
      keys.has('privateKey') &&
      keys.has('publicKey') &&
      typeof value.privateKey === 'string' &&
      typeof value.publicKey === 'string'
    );
  }
  if (protocol === 'VLESS_XHTTP_TLS') {
    return [...keys].every(
      (key) =>
        ['version', 'certificatePem', 'privateKeyPem'].includes(key) &&
        (key === 'version' || typeof value[key] === 'string'),
    );
  }
  if (protocol === 'TROJAN') {
    return [...keys].every(
      (key) =>
        [
          'version',
          'certificatePem',
          'privateKeyPem',
          'acmeExternalAccountMacKey',
          'acmeAliDnsAccessKeySecret',
          'acmeAliDnsSecurityToken',
          'acmeCloudflareApiToken',
          'acmeCloudflareZoneToken',
          'acmeDnsPassword',
        ].includes(key) &&
        (key === 'version' || typeof value[key] === 'string'),
    );
  }
  return (
    keys.size <= 2 &&
    keys.has('serverPassword') &&
    typeof value.serverPassword === 'string'
  );
}
