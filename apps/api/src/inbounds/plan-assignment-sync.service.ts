import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CoreEngine } from '@overvpn/shared';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';
import { coreStateId } from '../core/core-ids';
import type { AssignmentCredential } from '../core/core-provider';
import type { Inbound, Prisma } from '../generated/prisma/client';
import { createCredential } from './hysteria2-domain';
import {
  parseShadowsocksPublicConfig,
  parseWireguardPublicConfig,
} from './inbound-storage';
import { createMtproxyCredential } from './mtproxy-domain';
import { createShadowsocksCredential } from './shadowsocks-domain';
import { createTrojanCredential } from './trojan-domain';
import { createVlessCredential } from './vless-reality-domain';
import { createWireguardCredential } from './wireguard-domain';

/**
 * Keeps user↔inbound assignments aligned with a plan's inbound list.
 * Used when creating/updating users with a plan and when a plan's inbounds change.
 */
@Injectable()
export class PlanAssignmentSyncService {
  private readonly configPaths: Record<CoreEngine, string>;

  constructor(
    private readonly encryption: SecretEncryptionService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.configPaths = {
      SING_BOX: config.get('SING_BOX_CONFIG_PATH', { infer: true }),
      XRAY: config.get('XRAY_CONFIG_PATH', { infer: true }),
      MTPROXY: config.get('MTPROXY_CONFIG_PATH', { infer: true }),
    };
  }

  async planInboundIds(
    tx: Prisma.TransactionClient,
    planId: string,
  ): Promise<string[]> {
    const rows = await tx.planInbound.findMany({
      where: { planId },
      orderBy: { priority: 'asc' },
      select: { inboundId: true },
    });
    return rows.map((row) => row.inboundId);
  }

  async syncUserToInboundIds(
    tx: Prisma.TransactionClient,
    userId: string,
    inboundIds: string[],
  ): Promise<void> {
    const desired = [...new Set(inboundIds)];
    const existing = await tx.userInboundAssignment.findMany({
      where: { userId },
    });
    const existingByInbound = new Map(
      existing.map((assignment) => [assignment.inboundId, assignment]),
    );
    const desiredSet = new Set(desired);

    for (const assignment of existing) {
      if (
        !desiredSet.has(assignment.inboundId) &&
        assignment.status === 'ACTIVE'
      ) {
        await tx.userInboundAssignment.update({
          where: { id: assignment.id },
          data: {
            status: 'DISABLED',
            disabledAt: new Date(),
          },
        });
        await this.markAssignmentChanged(tx, assignment.inboundId, userId);
      }
    }

    for (const inboundId of desired) {
      const current = existingByInbound.get(inboundId);
      if (current?.status === 'ACTIVE') {
        continue;
      }
      const inbound = await tx.inbound.findUnique({ where: { id: inboundId } });
      if (!inbound) {
        throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
          resource: 'inbound',
          id: inboundId,
        });
      }
      const credential = this.createCredential(inbound);
      const encrypted = this.encryption.encrypt(JSON.stringify(credential));
      if (current) {
        await tx.userInboundAssignment.update({
          where: { id: current.id },
          data: {
            status: 'ACTIVE',
            credentialEncrypted: encrypted,
            credentialName: userId,
            credentialVersion: { increment: 1 },
            disabledAt: null,
            rotatedAt: new Date(),
          },
        });
      } else {
        await tx.userInboundAssignment.create({
          data: {
            inboundId,
            userId,
            status: 'ACTIVE',
            credentialEncrypted: encrypted,
            credentialName: userId,
            credentialVersion: 1,
            rotatedAt: new Date(),
          },
        });
      }
      await this.markAssignmentChanged(tx, inboundId, userId);
    }
  }

  async syncAllUsersOnPlan(
    tx: Prisma.TransactionClient,
    planId: string,
    inboundIds: string[],
  ): Promise<void> {
    const users = await tx.user.findMany({
      where: { planId, deletedAt: null },
      select: { id: true },
    });
    for (const user of users) {
      await this.syncUserToInboundIds(tx, user.id, inboundIds);
    }
  }

  private createCredential(inbound: Inbound): AssignmentCredential {
    if (
      inbound.protocol === 'VLESS_REALITY' ||
      inbound.protocol === 'VLESS_XHTTP_TLS' ||
      inbound.protocol === 'VLESS_GRPC_TLS' ||
      inbound.protocol === 'VLESS_TCP_TLS'
    ) {
      return createVlessCredential();
    }
    if (inbound.protocol === 'TROJAN' || inbound.protocol === 'TROJAN_TLS') {
      return createTrojanCredential();
    }
    if (
      inbound.protocol === 'SHADOWSOCKS' ||
      inbound.protocol === 'SHADOWSOCKS_XRAY'
    ) {
      const publicConfig = parseShadowsocksPublicConfig(inbound.config);
      return createShadowsocksCredential(publicConfig.method);
    }
    if (
      inbound.protocol === 'WIREGUARD' ||
      inbound.protocol === 'WIREGUARD_XRAY'
    ) {
      return createWireguardCredential(
        parseWireguardPublicConfig(inbound.config).address,
      );
    }
    if (inbound.protocol === 'MTPROXY') {
      return createMtproxyCredential();
    }
    return createCredential();
  }

  private async markAssignmentChanged(
    tx: Prisma.TransactionClient,
    inboundId: string,
    userId: string,
  ): Promise<void> {
    const inbound = await tx.inbound.update({
      where: { id: inboundId },
      data: {
        revision: { increment: 1 },
        needsApply: true,
      },
      select: { engine: true },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        revision: { increment: 1 },
        needsApply: true,
      },
    });
    await this.bumpDesiredRevision(tx, inbound.engine);
  }

  private async bumpDesiredRevision(
    tx: Prisma.TransactionClient,
    engine: CoreEngine,
  ): Promise<void> {
    const id = coreStateId(engine);
    const configPath = this.configPaths[engine];
    await tx.coreState.upsert({
      where: { id },
      create: {
        id,
        desiredRevision: 1,
        appliedRevision: 0,
        configPath,
      },
      update: {
        desiredRevision: { increment: 1 },
        configPath,
      },
    });
  }
}
