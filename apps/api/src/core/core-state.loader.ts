import { Injectable } from '@nestjs/common';
import type { CoreEngine } from '@overvpn/shared/constants';
import {
  hysteria2InboundPublicConfigSchema,
  mtproxyInboundPublicConfigSchema,
  shadowsocksInboundPublicConfigSchema,
  trojanInboundPublicConfigSchema,
  trojanTlsInboundPublicConfigSchema,
  vlessGrpcTlsPublicConfigSchema,
  vlessRealityInboundPublicConfigSchema,
  vlessTcpTlsPublicConfigSchema,
  vlessXhttpTlsPublicConfigSchema,
  wireguardInboundPublicConfigSchema,
} from '@overvpn/shared/schemas';
import { z } from 'zod';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { PrismaService } from '../infrastructure/infrastructure.module';
import type {
  AssignmentCredential,
  CoreDesiredState,
  DesiredInbound,
  Hysteria2InboundSecrets,
  MtproxyInboundSecrets,
  ShadowsocksInboundSecrets,
  TrojanInboundSecrets,
  TrojanTlsInboundSecrets,
  VlessGrpcTlsInboundSecrets,
  VlessRealityInboundSecrets,
  VlessTcpTlsInboundSecrets,
  VlessXhttpTlsInboundSecrets,
  WireguardCredential,
  WireguardInboundSecrets,
} from './core-provider';
import { coreStateId } from './core-ids';

const hysteria2SecretsSchema = z
  .object({
    version: z.literal(1),
    obfsPassword: z.string().optional(),
    certificatePem: z.string().optional(),
    privateKeyPem: z.string().optional(),
    acmeExternalAccountMacKey: z.string().optional(),
    acmeAliDnsAccessKeySecret: z.string().optional(),
    acmeAliDnsSecurityToken: z.string().optional(),
    acmeCloudflareApiToken: z.string().optional(),
    acmeCloudflareZoneToken: z.string().optional(),
    acmeDnsPassword: z.string().optional(),
  })
  .strict();

const vlessSecretsSchema = z
  .object({
    version: z.literal(1),
    privateKey: z.string().min(1),
    publicKey: z.string().min(1),
  })
  .strict();

const vlessXhttpTlsSecretsSchema = z
  .object({
    version: z.literal(1),
    certificatePem: z.string().optional(),
    privateKeyPem: z.string().optional(),
  })
  .strict();

const trojanSecretsSchema = z
  .object({
    version: z.literal(1),
    certificatePem: z.string().optional(),
    privateKeyPem: z.string().optional(),
    acmeExternalAccountMacKey: z.string().optional(),
    acmeAliDnsAccessKeySecret: z.string().optional(),
    acmeAliDnsSecurityToken: z.string().optional(),
    acmeCloudflareApiToken: z.string().optional(),
    acmeCloudflareZoneToken: z.string().optional(),
    acmeDnsPassword: z.string().optional(),
  })
  .strict();

const shadowsocksSecretsSchema = z
  .object({
    version: z.literal(1),
    serverPassword: z.string().min(1),
  })
  .strict();

const wireguardSecretsSchema = z
  .object({
    version: z.literal(1),
    privateKey: z.string().min(1),
    publicKey: z.string().min(1),
  })
  .strict();

const mtproxySecretsSchema = z
  .object({
    version: z.literal(1),
  })
  .strict();

const passwordCredentialSchema = z
  .object({
    version: z.literal(1),
    password: z.string().min(1),
  })
  .strict();

const vlessCredentialSchema = z
  .object({
    version: z.literal(1),
    uuid: z.string().uuid(),
  })
  .strict();

const wireguardCredentialSchema = z
  .object({
    version: z.literal(1),
    privateKey: z.string().min(1),
    publicKey: z.string().min(1),
    address: z.string().min(1),
  })
  .strict();

@Injectable()
export class CoreStateLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
  ) {}

  async load(
    engine: CoreEngine = 'SING_BOX',
    options: { proxyServerId?: string } = {},
  ): Promise<CoreDesiredState> {
    const proxyServerId = options.proxyServerId;
    const [inbounds, users, coreState, proxyCoreState] =
      await this.prisma.$transaction(
        async (tx) => {
          const inbounds = await tx.inbound.findMany({
            where: {
              engine,
              ...(proxyServerId ? { proxyServerId } : {}),
            },
            orderBy: [{ tag: 'asc' }, { id: 'asc' }],
            include: {
              userAssignments: {
                where: {
                  status: 'ACTIVE',
                  user: {
                    status: 'ACTIVE',
                    deletedAt: null,
                  },
                },
                include: {
                  user: {
                    select: {
                      id: true,
                      identity: true,
                      username: true,
                      revision: true,
                      deviceLimit: true,
                      ipLimit: true,
                    },
                  },
                },
                orderBy: [{ userId: 'asc' }, { id: 'asc' }],
              },
            },
          });
          const users = await tx.user.findMany({
            select: { id: true, revision: true },
            orderBy: { id: 'asc' },
          });
          const coreState = await tx.coreState.findUnique({
            where: { id: coreStateId(engine) },
          });
          const proxyCoreState =
            proxyServerId === undefined
              ? null
              : await tx.proxyCoreState.findUnique({
                  where: {
                    proxyServerId_engine: {
                      proxyServerId,
                      engine,
                    },
                  },
                });
          return [inbounds, users, coreState, proxyCoreState] as const;
        },
        { isolationLevel: 'RepeatableRead' },
      );

    const desiredInbounds: DesiredInbound[] = [];
    for (const inbound of inbounds) {
      if (!inbound.enabled) {
        continue;
      }
      if (!inbound.publicHost) {
        throw new Error(`Enabled inbound ${inbound.id} has no public host`);
      }
      const assignments = inbound.userAssignments.map((assignment) => ({
        id: assignment.id,
        userId: assignment.user.id,
        userIdentity: assignment.user.identity,
        credentialName: assignment.credentialName,
        credentialVersion: assignment.credentialVersion,
        credential: this.decryptCredential(
          assignment.id,
          assignment.credentialEncrypted,
          inbound.protocol,
        ),
        maxUniqueIps: resolveMaxUniqueIps(
          assignment.user.deviceLimit,
          assignment.user.ipLimit,
        ),
      }));
      const base = {
        id: inbound.id,
        tag: inbound.tag,
        listenHost: inbound.listenHost,
        listenPort: inbound.listenPort,
        publicHost: inbound.publicHost,
        publicPort: inbound.publicPort ?? inbound.listenPort,
        revision: inbound.revision,
        assignments,
      };

      if (inbound.protocol === 'HYSTERIA2') {
        desiredInbounds.push({
          ...base,
          protocol: 'HYSTERIA2',
          config: hysteria2InboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptHysteria2Secrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'VLESS_REALITY') {
        desiredInbounds.push({
          ...base,
          protocol: 'VLESS_REALITY',
          config: vlessRealityInboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptVlessSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'VLESS_XHTTP_TLS') {
        desiredInbounds.push({
          ...base,
          protocol: 'VLESS_XHTTP_TLS',
          config: vlessXhttpTlsPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptVlessXhttpTlsSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'VLESS_GRPC_TLS') {
        desiredInbounds.push({
          ...base,
          protocol: 'VLESS_GRPC_TLS',
          config: vlessGrpcTlsPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptVlessGrpcTlsSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'VLESS_TCP_TLS') {
        desiredInbounds.push({
          ...base,
          protocol: 'VLESS_TCP_TLS',
          config: vlessTcpTlsPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptVlessTcpTlsSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'TROJAN') {
        desiredInbounds.push({
          ...base,
          protocol: 'TROJAN',
          config: trojanInboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptTrojanSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'TROJAN_TLS') {
        desiredInbounds.push({
          ...base,
          protocol: 'TROJAN_TLS',
          config: trojanTlsInboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptTrojanTlsSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'SHADOWSOCKS') {
        desiredInbounds.push({
          ...base,
          protocol: 'SHADOWSOCKS',
          config: shadowsocksInboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptShadowsocksSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (inbound.protocol === 'SHADOWSOCKS_XRAY') {
        desiredInbounds.push({
          ...base,
          protocol: 'SHADOWSOCKS_XRAY',
          config: shadowsocksInboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptShadowsocksSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      if (
        inbound.protocol === 'WIREGUARD' ||
        inbound.protocol === 'WIREGUARD_XRAY'
      ) {
        desiredInbounds.push({
          ...base,
          protocol: inbound.protocol,
          config: wireguardInboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptWireguardSecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
          assignments: assignments as Array<
            (typeof assignments)[number] & { credential: WireguardCredential }
          >,
        });
        continue;
      }
      if (inbound.protocol === 'MTPROXY') {
        desiredInbounds.push({
          ...base,
          protocol: 'MTPROXY',
          config: mtproxyInboundPublicConfigSchema.parse(inbound.config),
          secrets: this.decryptMtproxySecrets(
            inbound.id,
            inbound.secretDataEncrypted,
          ),
        });
        continue;
      }
      throw new Error(
        `Enabled inbound ${inbound.id} uses unsupported protocol ${String(
          inbound.protocol,
        )}`,
      );
    }

    assertNoListenPortConflicts(desiredInbounds);

    return {
      engine,
      loadedAt: new Date(),
      desiredRevision:
        proxyCoreState?.desiredRevision ?? coreState?.desiredRevision ?? 0,
      inbounds: desiredInbounds,
      inboundRevisions: inbounds.map(({ id, revision }) => ({ id, revision })),
      userRevisions: users,
    };
  }

  private decryptHysteria2Secrets(
    inboundId: string,
    encrypted: string | null,
  ): Hysteria2InboundSecrets {
    if (!encrypted) {
      return { version: 1 };
    }
    try {
      return hysteria2SecretsSchema.parse(
        JSON.parse(this.encryption.decrypt(encrypted)) as unknown,
      );
    } catch {
      throw new Error(`Inbound ${inboundId} has unreadable encrypted secrets`);
    }
  }

  private decryptVlessSecrets(
    inboundId: string,
    encrypted: string | null,
  ): VlessRealityInboundSecrets {
    if (!encrypted) {
      throw new Error(`Inbound ${inboundId} is missing Reality secrets`);
    }
    try {
      return vlessSecretsSchema.parse(
        JSON.parse(this.encryption.decrypt(encrypted)) as unknown,
      );
    } catch {
      throw new Error(`Inbound ${inboundId} has unreadable encrypted secrets`);
    }
  }

  private decryptTrojanSecrets(
    inboundId: string,
    encrypted: string | null,
  ): TrojanInboundSecrets {
    if (!encrypted) {
      return { version: 1 };
    }
    try {
      return trojanSecretsSchema.parse(
        JSON.parse(this.encryption.decrypt(encrypted)) as unknown,
      );
    } catch {
      throw new Error(`Inbound ${inboundId} has unreadable encrypted secrets`);
    }
  }

  private decryptTrojanTlsSecrets(
    inboundId: string,
    encrypted: string | null,
  ): TrojanTlsInboundSecrets {
    return this.decryptVlessXhttpTlsSecrets(inboundId, encrypted);
  }

  private decryptWireguardSecrets(
    inboundId: string,
    encrypted: string | null,
  ): WireguardInboundSecrets {
    if (!encrypted) {
      throw new Error(`Inbound ${inboundId} is missing WireGuard secrets`);
    }
    try {
      return wireguardSecretsSchema.parse(
        JSON.parse(this.encryption.decrypt(encrypted)) as unknown,
      );
    } catch {
      throw new Error(`Inbound ${inboundId} has unreadable encrypted secrets`);
    }
  }

  private decryptVlessXhttpTlsSecrets(
    inboundId: string,
    encrypted: string | null,
  ): VlessXhttpTlsInboundSecrets {
    if (!encrypted) {
      return { version: 1 };
    }
    try {
      return vlessXhttpTlsSecretsSchema.parse(
        JSON.parse(this.encryption.decrypt(encrypted)) as unknown,
      );
    } catch {
      throw new Error(`Inbound ${inboundId} has unreadable encrypted secrets`);
    }
  }

  private decryptVlessGrpcTlsSecrets(
    inboundId: string,
    encrypted: string | null,
  ): VlessGrpcTlsInboundSecrets {
    return this.decryptVlessXhttpTlsSecrets(inboundId, encrypted);
  }

  private decryptVlessTcpTlsSecrets(
    inboundId: string,
    encrypted: string | null,
  ): VlessTcpTlsInboundSecrets {
    return this.decryptVlessXhttpTlsSecrets(inboundId, encrypted);
  }

  private decryptShadowsocksSecrets(
    inboundId: string,
    encrypted: string | null,
  ): ShadowsocksInboundSecrets {
    if (!encrypted) {
      throw new Error(`Inbound ${inboundId} is missing Shadowsocks secrets`);
    }
    try {
      return shadowsocksSecretsSchema.parse(
        JSON.parse(this.encryption.decrypt(encrypted)) as unknown,
      );
    } catch {
      throw new Error(`Inbound ${inboundId} has unreadable encrypted secrets`);
    }
  }

  private decryptMtproxySecrets(
    inboundId: string,
    encrypted: string | null,
  ): MtproxyInboundSecrets {
    if (!encrypted) {
      return { version: 1 };
    }
    try {
      return mtproxySecretsSchema.parse(
        JSON.parse(this.encryption.decrypt(encrypted)) as unknown,
      );
    } catch {
      throw new Error(`Inbound ${inboundId} has unreadable encrypted secrets`);
    }
  }

  private decryptCredential(
    assignmentId: string,
    encrypted: string,
    protocol: string,
  ): AssignmentCredential {
    if (!encrypted.startsWith('v1:')) {
      throw new Error(
        `Assignment ${assignmentId} requires credential rotation after migration`,
      );
    }
    try {
      const parsed = JSON.parse(this.encryption.decrypt(encrypted)) as unknown;
      if (
        protocol === 'VLESS_REALITY' ||
        protocol === 'VLESS_XHTTP_TLS' ||
        protocol === 'VLESS_GRPC_TLS' ||
        protocol === 'VLESS_TCP_TLS'
      ) {
        return vlessCredentialSchema.parse(parsed);
      }
      if (protocol === 'WIREGUARD' || protocol === 'WIREGUARD_XRAY') {
        return wireguardCredentialSchema.parse(parsed);
      }
      return passwordCredentialSchema.parse(parsed);
    } catch {
      throw new Error(
        `Assignment ${assignmentId} has an unreadable encrypted credential`,
      );
    }
  }
}

/** Prefer deviceLimit; fall back to ipLimit. Null/non-positive → no Telemt cap. */
function resolveMaxUniqueIps(
  deviceLimit: number | null | undefined,
  ipLimit: number | null | undefined,
): number | null {
  if (typeof deviceLimit === 'number' && deviceLimit > 0) {
    return deviceLimit;
  }
  if (typeof ipLimit === 'number' && ipLimit > 0) {
    return ipLimit;
  }
  return null;
}

function isWildcardListenHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === '0.0.0.0' ||
    normalized === '::' ||
    normalized === '::0' ||
    normalized === '*'
  );
}

function assertNoListenPortConflicts(
  inbounds: Array<Pick<DesiredInbound, 'tag' | 'listenHost' | 'listenPort'>>,
): void {
  for (let index = 0; index < inbounds.length; index += 1) {
    const left = inbounds[index]!;
    for (let other = index + 1; other < inbounds.length; other += 1) {
      const right = inbounds[other]!;
      if (left.listenPort !== right.listenPort) {
        continue;
      }
      const leftWild = isWildcardListenHost(left.listenHost);
      const rightWild = isWildcardListenHost(right.listenHost);
      const sameHost =
        left.listenHost.trim().toLowerCase() ===
        right.listenHost.trim().toLowerCase();
      if (leftWild || rightWild || sameHost) {
        throw new Error(
          `Listen port conflict: inbound "${left.tag}" and "${right.tag}" both bind ${left.listenHost}:${left.listenPort}`,
        );
      }
    }
  }
}
