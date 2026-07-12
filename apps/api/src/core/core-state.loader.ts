import { Injectable } from '@nestjs/common';
import {
  hysteria2InboundPublicConfigSchema,
  shadowsocksInboundPublicConfigSchema,
  trojanInboundPublicConfigSchema,
  vlessRealityInboundPublicConfigSchema,
} from '@overvpn/shared/schemas';
import { z } from 'zod';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { PrismaService } from '../infrastructure/infrastructure.module';
import type {
  AssignmentCredential,
  CoreDesiredState,
  DesiredInbound,
  Hysteria2InboundSecrets,
  ShadowsocksInboundSecrets,
  TrojanInboundSecrets,
  VlessRealityInboundSecrets,
} from './core-provider';

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

@Injectable()
export class CoreStateLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
  ) {}

  async load(): Promise<CoreDesiredState> {
    const [inbounds, users, coreState] = await this.prisma.$transaction(
      async (tx) => {
        const inbounds = await tx.inbound.findMany({
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
          where: { id: 'sing-box' },
        });
        return [inbounds, users, coreState] as const;
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
      throw new Error(
        `Enabled inbound ${inbound.id} uses unsupported protocol ${String(
          inbound.protocol,
        )}`,
      );
    }

    return {
      loadedAt: new Date(),
      desiredRevision: coreState?.desiredRevision ?? 0,
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
      if (protocol === 'VLESS_REALITY') {
        return vlessCredentialSchema.parse(parsed);
      }
      return passwordCredentialSchema.parse(parsed);
    } catch {
      throw new Error(
        `Assignment ${assignmentId} has an unreadable encrypted credential`,
      );
    }
  }
}
