import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAX_MTPROXY_INBOUNDS,
  PROTOCOL_ENGINE_MAP,
  isPublishedMtproxyPort,
  mtproxyPublishedPortRange,
  publishedListenPortForProtocol,
  renderEndpointDisplayName,
  type CoreEngine,
  type InboundProtocol,
} from '@overvpn/shared';
import type {
  AddAssignment,
  AssignmentListQuery,
  AssignmentResult,
  CreateInbound,
  InboundLinkResult,
  InboundListQuery,
  InboundResult,
  RotateAssignmentCredential,
  UpdateInbound,
} from '@overvpn/shared/schemas';
import { AuditService } from '../audit/audit.service';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import type { AppEnvironment } from '../config/environment';
import { ProcessAdapter } from '../core/core-adapters';
import { CoreApplyService } from '../core/core-apply.service';
import { coreStateId } from '../core/core-ids';
import type {
  AssignmentCredential,
  Hysteria2InboundSecrets,
  PasswordCredential,
  ShadowsocksInboundSecrets,
  VlessCredential,
  VlessRealityInboundSecrets,
} from '../core/core-provider';
import type {
  Inbound,
  Prisma,
  UserInboundAssignment,
} from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';
import {
  buildHysteria2Uri,
  createCredential,
  normalizeHysteria2Password,
} from './hysteria2-domain';
import {
  buildInboundStorage,
  encryptableSecrets,
  isInboundSecretBundle,
  parseHysteria2PublicConfig,
  parseMtproxyPublicConfig,
  parseShadowsocksPublicConfig,
  parseTrojanPublicConfig,
  parseVlessGrpcTlsPublicConfig,
  parseVlessRealityPublicConfig,
  parseVlessTcpTlsPublicConfig,
  parseVlessXhttpTlsPublicConfig,
  storageFromInbound,
  type InboundSecretBundle,
  type InboundStorage,
  type InboundPublicConfig,
} from './inbound-storage';
import {
  buildMtproxyUri,
  createMtproxyCredential,
  normalizeMtproxySecret,
} from './mtproxy-domain';
import {
  buildShadowsocksUri,
  composeShadowsocksClientPassword,
  createShadowsocksCredential,
} from './shadowsocks-domain';
import {
  buildTrojanUri,
  createTrojanCredential,
  normalizeTrojanPassword,
} from './trojan-domain';
import { buildVlessGrpcTlsUri } from './vless-grpc-tls-domain';
import { buildVlessUri, createVlessCredential } from './vless-reality-domain';
import { buildVlessTcpTlsUri } from './vless-tcp-tls-domain';
import { buildVlessXhttpTlsUri } from './vless-xhttp-tls-domain';

type InboundWithCount = Inbound & {
  _count: { userAssignments: number };
};

type AssignmentWithUser = UserInboundAssignment & {
  user: {
    identity: string;
    username: string;
    status: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'LIMITED';
    deletedAt: Date | null;
    plan?: { name: string } | null;
  };
};

@Injectable()
export class InboundsService {
  private readonly configPaths: Record<CoreEngine, string>;
  private readonly binaryPath: string;
  private readonly processTimeoutMs: number;
  private readonly singBoxUdpPort: number;
  private readonly singBoxTcpPort: number;
  private readonly singBoxTrojanPort: number;
  private readonly singBoxSsPort: number;
  private readonly xrayListenPort: number;
  private readonly xrayGrpcPort: number;
  private readonly xrayTcpTlsPort: number;
  private readonly mtproxyPortMin: number;
  private readonly mtproxyPortMax: number;
  private readonly mtproxyEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: SecretEncryptionService,
    private readonly audit: AuditService,
    private readonly coreApply: CoreApplyService,
    private readonly processAdapter: ProcessAdapter,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.configPaths = {
      SING_BOX: config.get('SING_BOX_CONFIG_PATH', { infer: true }),
      XRAY: config.get('XRAY_CONFIG_PATH', { infer: true }),
      MTPROXY: config.get('MTPROXY_CONFIG_PATH', { infer: true }),
    };
    this.binaryPath = config.get('SING_BOX_BINARY_PATH', { infer: true });
    this.processTimeoutMs = config.get('SING_BOX_PROCESS_TIMEOUT_MS', {
      infer: true,
    });
    this.singBoxUdpPort = config.get('SING_BOX_UDP_PORT', { infer: true });
    this.singBoxTcpPort = config.get('SING_BOX_TCP_PORT', { infer: true });
    this.singBoxTrojanPort = config.get('SING_BOX_TROJAN_PORT', {
      infer: true,
    });
    this.singBoxSsPort = config.get('SING_BOX_SS_PORT', { infer: true });
    this.xrayListenPort = config.get('XRAY_LISTEN_PORT', { infer: true });
    this.xrayGrpcPort = config.get('XRAY_GRPC_PORT', { infer: true });
    this.xrayTcpTlsPort = config.get('XRAY_TCP_TLS_PORT', { infer: true });
    this.mtproxyPortMin = config.get('MTPROXY_PORT_MIN', { infer: true });
    this.mtproxyPortMax = config.get('MTPROXY_PORT_MAX', { infer: true });
    this.mtproxyEnabled = config.get('MTPROXY_ENABLED', { infer: true });
  }

  async list(query: InboundListQuery): Promise<{
    items: InboundResult[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const where: Prisma.InboundWhereInput = {
      ...(query.protocol ? { protocol: query.protocol } : {}),
      ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      ...(query.search
        ? {
            OR: [
              { tag: { contains: query.search, mode: 'insensitive' } },
              {
                publicHost: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
    const [total, inbounds] = await this.prisma.$transaction([
      this.prisma.inbound.count({ where }),
      this.prisma.inbound.findMany({
        where,
        include: { _count: { select: { userAssignments: true } } },
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: inbounds.map((inbound) => this.toResult(inbound)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async get(id: string): Promise<InboundResult> {
    return this.toResult(await this.requireInbound(id));
  }

  async create(
    input: CreateInbound,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ) {
    try {
      const engine = this.resolveEngine(input.protocol);
      if (input.protocol === 'MTPROXY') {
        this.assertMtproxyEnabled();
        await this.assertMtproxyInboundLimit();
      }
      this.assertListenPortPublished(input.protocol, input.settings.listenPort);
      await this.assertListenPortAvailable(
        input.settings.listenHost,
        input.settings.listenPort,
      );
      const built = await buildInboundStorage(
        input.protocol,
        input.settings,
        undefined,
        {
          processAdapter: this.processAdapter,
          binaryPath: this.binaryPath,
          processTimeoutMs: this.processTimeoutMs,
        },
      );
      const inbound = await this.prisma.$transaction(async (tx) => {
        await this.assertListenPortAvailable(
          input.settings.listenHost,
          input.settings.listenPort,
          undefined,
          tx,
        );
        const created = await tx.inbound.create({
          data: {
            tag: input.tag,
            engine,
            protocol: input.protocol,
            listenHost: input.settings.listenHost,
            listenPort: input.settings.listenPort,
            publicHost: input.settings.publicHost,
            publicPort: input.settings.publicPort ?? input.settings.listenPort,
            enabled: input.settings.enabled,
            disabledAt: input.settings.enabled ? null : new Date(),
            displayNameTemplate:
              input.displayNameTemplate === undefined ||
              input.displayNameTemplate === null ||
              input.displayNameTemplate.trim() === ''
                ? null
                : input.displayNameTemplate.trim(),
            config: built.storage.publicConfig,
            secretDataEncrypted: this.encryptSecrets(built.storage.secrets),
            needsApply: true,
          },
          include: { _count: { select: { userAssignments: true } } },
        });
        await this.bumpDesiredRevision(tx, engine);
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'INBOUND_CREATE',
            resourceType: 'inbound',
            resourceId: created.id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            after: this.toResult(created),
          },
          tx,
        );
        return created;
      });
      const apply = await this.applyMutation(
        actor,
        metadata,
        `Create inbound ${inbound.tag}`,
      );
      return { inbound: this.toResult(inbound), apply };
    } catch (error: unknown) {
      await this.recordMutationFailure(
        'INBOUND_CREATE',
        actor,
        metadata,
        null,
        error,
        input,
      );
      throw this.mapMutationError(error);
    }
  }

  async update(
    id: string,
    input: UpdateInbound,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const before = await this.requireInbound(id, tx);
        if (input.protocol && input.protocol !== before.protocol) {
          throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
            reason: 'inbound_protocol_change_not_allowed',
          });
        }
        const expectedEngine = this.resolveEngine(before.protocol);
        if (before.engine !== expectedEngine) {
          throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
            reason: 'inbound_engine_protocol_mismatch',
            protocol: before.protocol,
            engine: before.engine,
            expectedEngine,
          });
        }
        const previous = this.tryStorageFromInbound(before);
        const brandingOnly =
          input.settings === undefined &&
          input.tag === undefined &&
          input.protocol === undefined &&
          input.displayNameTemplate !== undefined;
        if (!input.settings && !previous && !brandingOnly) {
          throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
            reason: 'inbound_settings_migration_required',
          });
        }
        const built = input.settings
          ? await buildInboundStorage(
              before.protocol,
              input.settings,
              previous,
              {
                processAdapter: this.processAdapter,
                binaryPath: this.binaryPath,
                processTimeoutMs: this.processTimeoutMs,
              },
            )
          : previous;
        if (input.settings) {
          this.assertListenPortPublished(
            before.protocol,
            input.settings.listenPort,
          );
          await this.assertListenPortAvailable(
            input.settings.listenHost,
            input.settings.listenPort,
            id,
            tx,
          );
        }
        const updated = await tx.inbound.update({
          where: { id },
          data: {
            tag: input.tag,
            ...(input.displayNameTemplate !== undefined
              ? {
                  displayNameTemplate:
                    input.displayNameTemplate === null ||
                    input.displayNameTemplate.trim() === ''
                      ? null
                      : input.displayNameTemplate.trim(),
                }
              : {}),
            ...(input.settings && built
              ? {
                  listenHost: input.settings.listenHost,
                  listenPort: input.settings.listenPort,
                  publicHost: input.settings.publicHost,
                  publicPort:
                    input.settings.publicPort ?? input.settings.listenPort,
                  enabled: input.settings.enabled,
                  disabledAt: input.settings.enabled ? null : new Date(),
                  config: built.storage.publicConfig,
                  secretDataEncrypted: this.encryptSecrets(
                    built.storage.secrets,
                  ),
                }
              : {}),
            ...(brandingOnly
              ? {}
              : {
                  revision: { increment: 1 },
                  needsApply: true,
                }),
          },
          include: { _count: { select: { userAssignments: true } } },
        });
        if (!brandingOnly) {
          await this.bumpDesiredRevision(tx, before.engine);
        }
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'INBOUND_UPDATE',
            resourceType: 'inbound',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before: this.toAuditInbound(before),
            after: this.toResult(updated),
          },
          tx,
        );
        return { inbound: updated, brandingOnly };
      });
      if (result.brandingOnly) {
        return { inbound: this.toResult(result.inbound), apply: null };
      }
      const apply = await this.applyMutation(
        actor,
        metadata,
        `Update inbound ${result.inbound.tag}`,
      );
      return { inbound: this.toResult(result.inbound), apply };
    } catch (error: unknown) {
      await this.recordMutationFailure(
        'INBOUND_UPDATE',
        actor,
        metadata,
        id,
        error,
        input,
      );
      throw this.mapMutationError(error);
    }
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ) {
    const action = enabled ? 'INBOUND_ENABLE' : 'INBOUND_DISABLE';
    try {
      const inbound = await this.prisma.$transaction(async (tx) => {
        const before = await this.requireInbound(id, tx);
        this.parsePublicConfig(before);
        const updated = await tx.inbound.update({
          where: { id },
          data: {
            enabled,
            disabledAt: enabled ? null : new Date(),
            revision: { increment: 1 },
            needsApply: true,
          },
          include: { _count: { select: { userAssignments: true } } },
        });
        await this.bumpDesiredRevision(tx, before.engine);
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action,
            resourceType: 'inbound',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before: this.toAuditInbound(before),
            after: this.toResult(updated),
          },
          tx,
        );
        return updated;
      });
      const apply = await this.applyMutation(
        actor,
        metadata,
        `${enabled ? 'Enable' : 'Disable'} inbound ${inbound.tag}`,
      );
      return { inbound: this.toResult(inbound), apply };
    } catch (error: unknown) {
      await this.recordMutationFailure(action, actor, metadata, id, error);
      throw this.mapMutationError(error);
    }
  }

  async remove(
    id: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ) {
    try {
      const tag = await this.prisma.$transaction(async (tx) => {
        const before = await this.requireInbound(id, tx);
        // History rows used Restrict FKs; clear/null them so delete always works.
        // PlanInbound + UserInboundAssignment already cascade from schema.
        await tx.onlineSession.deleteMany({ where: { inboundId: id } });
        await tx.trafficCheckpoint.deleteMany({ where: { inboundId: id } });
        await tx.usageDaily.updateMany({
          where: { inboundId: id },
          data: { inboundId: null },
        });
        await tx.inbound.delete({ where: { id } });
        await this.bumpDesiredRevision(tx, before.engine);
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'INBOUND_DELETE',
            resourceType: 'inbound',
            resourceId: id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before: this.toAuditInbound(before),
          },
          tx,
        );
        return before.tag;
      });
      const apply = await this.applyMutation(
        actor,
        metadata,
        `Delete inbound ${tag}`,
      );
      return { inbound: null, apply };
    } catch (error: unknown) {
      await this.recordMutationFailure(
        'INBOUND_DELETE',
        actor,
        metadata,
        id,
        error,
      );
      throw this.mapMutationError(error);
    }
  }

  async listAssignments(
    inboundId: string,
    query: AssignmentListQuery,
  ): Promise<{
    items: AssignmentResult[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    await this.requireInbound(inboundId);
    const where: Prisma.UserInboundAssignmentWhereInput = {
      inboundId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                {
                  username: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
                {
                  identity: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          }
        : {}),
    };
    const [total, assignments] = await this.prisma.$transaction([
      this.prisma.userInboundAssignment.count({ where }),
      this.prisma.userInboundAssignment.findMany({
        where,
        include: {
          user: {
            select: {
              identity: true,
              username: true,
              status: true,
              deletedAt: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: assignments.map((assignment) => this.toAssignment(assignment)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async addAssignment(
    inboundId: string,
    input: AddAssignment,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ) {
    try {
      const assignment = await this.prisma.$transaction(async (tx) => {
        await this.requireInbound(inboundId, tx);
        const user = await tx.user.findFirst({
          where: { id: input.userId, deletedAt: null },
        });
        if (!user) {
          throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
            resource: 'user',
            id: input.userId,
          });
        }
        if (user.status !== 'ACTIVE') {
          throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
            reason: 'user_not_active',
          });
        }
        const existing = await tx.userInboundAssignment.findUnique({
          where: {
            userId_inboundId: {
              userId: user.id,
              inboundId,
            },
          },
        });
        const inboundRecord = await this.requireInbound(inboundId, tx);
        const credential = this.createAssignmentCredential(
          inboundRecord,
          input,
        );
        const encrypted = this.encryption.encrypt(JSON.stringify(credential));
        const saved = existing
          ? await tx.userInboundAssignment.update({
              where: { id: existing.id },
              data: {
                status: 'ACTIVE',
                credentialEncrypted: encrypted,
                credentialName: user.id,
                credentialVersion: { increment: 1 },
                disabledAt: null,
                rotatedAt: new Date(),
              },
              include: {
                user: {
                  select: {
                    identity: true,
                    username: true,
                    status: true,
                    deletedAt: true,
                  },
                },
              },
            })
          : await tx.userInboundAssignment.create({
              data: {
                inboundId,
                userId: user.id,
                status: 'ACTIVE',
                credentialEncrypted: encrypted,
                credentialName: user.id,
                credentialVersion: 1,
                rotatedAt: new Date(),
              },
              include: {
                user: {
                  select: {
                    identity: true,
                    username: true,
                    status: true,
                    deletedAt: true,
                  },
                },
              },
            });
        await this.markAssignmentChanged(tx, inboundId, user.id);
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'INBOUND_ASSIGNMENT_ADD',
            resourceType: 'inbound_assignment',
            resourceId: saved.id,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            after: this.toAssignment(saved),
          },
          tx,
        );
        return saved;
      });
      const apply = await this.applyMutation(
        actor,
        metadata,
        `Assign user ${assignment.userId} to inbound ${inboundId}`,
      );
      return { assignment: this.toAssignment(assignment), apply };
    } catch (error: unknown) {
      await this.recordMutationFailure(
        'INBOUND_ASSIGNMENT_ADD',
        actor,
        metadata,
        inboundId,
        error,
        { userId: input.userId },
      );
      throw this.mapMutationError(error);
    }
  }

  async removeAssignment(
    inboundId: string,
    assignmentId: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ) {
    try {
      const assignment = await this.prisma.$transaction(async (tx) => {
        const before = await this.requireAssignment(
          inboundId,
          assignmentId,
          tx,
        );
        const updated = await tx.userInboundAssignment.update({
          where: { id: assignmentId },
          data: {
            status: 'DISABLED',
            disabledAt: new Date(),
          },
          include: {
            user: {
              select: {
                identity: true,
                username: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        });
        await this.markAssignmentChanged(tx, inboundId, before.userId);
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'INBOUND_ASSIGNMENT_REMOVE',
            resourceType: 'inbound_assignment',
            resourceId: assignmentId,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before: this.toAssignment(before),
            after: this.toAssignment(updated),
          },
          tx,
        );
        return updated;
      });
      const apply = await this.applyMutation(
        actor,
        metadata,
        `Remove assignment ${assignmentId} from inbound ${inboundId}`,
      );
      return { assignment: this.toAssignment(assignment), apply };
    } catch (error: unknown) {
      await this.recordMutationFailure(
        'INBOUND_ASSIGNMENT_REMOVE',
        actor,
        metadata,
        assignmentId,
        error,
      );
      throw this.mapMutationError(error);
    }
  }

  async rotateCredential(
    inboundId: string,
    assignmentId: string,
    input: RotateAssignmentCredential,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ) {
    try {
      const assignment = await this.prisma.$transaction(async (tx) => {
        const before = await this.requireAssignment(
          inboundId,
          assignmentId,
          tx,
        );
        const inbound = await this.requireInbound(inboundId, tx);
        const credential = this.createAssignmentCredential(inbound, input);
        const updated = await tx.userInboundAssignment.update({
          where: { id: assignmentId },
          data: {
            credentialEncrypted: this.encryption.encrypt(
              JSON.stringify(credential),
            ),
            credentialVersion: { increment: 1 },
            credentialName: before.userId,
            rotatedAt: new Date(),
          },
          include: {
            user: {
              select: {
                identity: true,
                username: true,
                status: true,
                deletedAt: true,
              },
            },
          },
        });
        await this.markAssignmentChanged(tx, inboundId, before.userId);
        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'INBOUND_CREDENTIAL_ROTATE',
            resourceType: 'inbound_assignment',
            resourceId: assignmentId,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before: this.toAssignment(before),
            after: this.toAssignment(updated),
          },
          tx,
        );
        return updated;
      });
      const apply = await this.applyMutation(
        actor,
        metadata,
        `Rotate credential for assignment ${assignmentId}`,
      );
      return { assignment: this.toAssignment(assignment), apply };
    } catch (error: unknown) {
      await this.recordMutationFailure(
        'INBOUND_CREDENTIAL_ROTATE',
        actor,
        metadata,
        assignmentId,
        error,
      );
      throw this.mapMutationError(error);
    }
  }

  async link(
    inboundId: string,
    assignmentId: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<InboundLinkResult> {
    try {
      const assignment = await this.requireAssignment(inboundId, assignmentId);
      const inbound = await this.requireInbound(inboundId);
      if (assignment.status !== 'ACTIVE') {
        throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
          reason: 'assignment_disabled',
        });
      }
      if (
        assignment.user.status !== 'ACTIVE' ||
        assignment.user.deletedAt !== null
      ) {
        throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
          reason: 'user_not_active',
        });
      }
      if (!inbound.enabled || !inbound.publicHost) {
        throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
          reason: 'inbound_not_publicly_available',
        });
      }
      const label = renderEndpointDisplayName(inbound.displayNameTemplate, {
        username: assignment.user.username,
        identity: assignment.user.identity,
        tag: inbound.tag,
        protocol: inbound.protocol,
        planName: assignment.user.plan?.name ?? null,
      });
      const host = inbound.publicHost;
      const port = inbound.publicPort ?? inbound.listenPort;
      const generatedAt = new Date().toISOString();
      const linkBase = {
        assignmentId,
        credentialVersion: assignment.credentialVersion,
        generatedAt,
      };
      const secrets = this.decryptSecrets(inbound);
      const credential = this.decryptCredential(
        assignment.credentialEncrypted,
        inbound.protocol,
      );

      let uri: string;
      let protocol: InboundLinkResult['protocol'];
      if (inbound.protocol === 'HYSTERIA2') {
        const publicConfig = parseHysteria2PublicConfig(inbound.config);
        const hy2Secrets = secrets as Hysteria2InboundSecrets;
        uri = buildHysteria2Uri({
          password: (credential as PasswordCredential).password,
          host,
          port,
          sni: publicConfig.tls.sni,
          insecure: publicConfig.tls.clientInsecure,
          obfsPassword: publicConfig.obfs ? hy2Secrets.obfsPassword : undefined,
          label,
        });
        protocol = 'HYSTERIA2';
      } else if (inbound.protocol === 'VLESS_REALITY') {
        const publicConfig = parseVlessRealityPublicConfig(inbound.config);
        const vlessSecrets = secrets as VlessRealityInboundSecrets;
        uri = buildVlessUri({
          uuid: (credential as VlessCredential).uuid,
          host,
          port,
          sni: publicConfig.serverNames[0] ?? host,
          fingerprint: publicConfig.fingerprint,
          publicKey: vlessSecrets.publicKey,
          shortId: publicConfig.shortIds[0] ?? '',
          flow: publicConfig.flow,
          label,
        });
        protocol = 'VLESS_REALITY';
      } else if (inbound.protocol === 'VLESS_XHTTP_TLS') {
        const publicConfig = parseVlessXhttpTlsPublicConfig(inbound.config);
        uri = buildVlessXhttpTlsUri({
          uuid: (credential as VlessCredential).uuid,
          host,
          port,
          path: publicConfig.path,
          sni: publicConfig.tls.sni,
          mode: publicConfig.mode,
          xhttpHost: publicConfig.host,
          label,
        });
        protocol = 'VLESS_XHTTP_TLS';
      } else if (inbound.protocol === 'VLESS_GRPC_TLS') {
        const publicConfig = parseVlessGrpcTlsPublicConfig(inbound.config);
        uri = buildVlessGrpcTlsUri({
          uuid: (credential as VlessCredential).uuid,
          host,
          port,
          serviceName: publicConfig.serviceName,
          sni: publicConfig.tls.sni,
          label,
        });
        protocol = 'VLESS_GRPC_TLS';
      } else if (inbound.protocol === 'VLESS_TCP_TLS') {
        const publicConfig = parseVlessTcpTlsPublicConfig(inbound.config);
        uri = buildVlessTcpTlsUri({
          uuid: (credential as VlessCredential).uuid,
          host,
          port,
          sni: publicConfig.tls.sni,
          flow: publicConfig.flow,
          label,
        });
        protocol = 'VLESS_TCP_TLS';
      } else if (inbound.protocol === 'TROJAN') {
        const publicConfig = parseTrojanPublicConfig(inbound.config);
        uri = buildTrojanUri({
          password: (credential as PasswordCredential).password,
          host,
          port,
          sni: publicConfig.tls.sni,
          insecure: publicConfig.tls.clientInsecure,
          alpn: publicConfig.tls.alpn,
          label,
        });
        protocol = 'TROJAN';
      } else if (inbound.protocol === 'MTPROXY') {
        const publicConfig = parseMtproxyPublicConfig(inbound.config);
        uri = buildMtproxyUri({
          host,
          port,
          secret: (credential as PasswordCredential).password,
          mode: publicConfig.secretMode,
          tlsDomain: publicConfig.tlsDomain,
        });
        protocol = 'MTPROXY';
      } else {
        const publicConfig = parseShadowsocksPublicConfig(inbound.config);
        const ssSecrets = secrets as ShadowsocksInboundSecrets;
        uri = buildShadowsocksUri({
          method: publicConfig.method,
          password: composeShadowsocksClientPassword(
            publicConfig.method,
            ssSecrets.serverPassword,
            (credential as PasswordCredential).password,
          ),
          host,
          port,
          label,
        });
        protocol = 'SHADOWSOCKS';
      }

      await this.audit.record({
        actorAdminId: actor.id,
        action: 'INBOUND_CREDENTIAL_REVEAL',
        resourceType: 'inbound_assignment',
        resourceId: assignmentId,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: {
          inboundId,
          credentialVersion: assignment.credentialVersion,
          protocol,
        },
      });
      return {
        ...linkBase,
        protocol,
        uri,
      };
    } catch (error: unknown) {
      await this.recordMutationFailure(
        'INBOUND_CREDENTIAL_REVEAL',
        actor,
        metadata,
        assignmentId,
        error,
      );
      throw this.mapMutationError(error);
    }
  }

  private async requireInbound(
    id: string,
    client: Pick<PrismaService, 'inbound'> = this.prisma,
  ): Promise<InboundWithCount> {
    const inbound = await client.inbound.findUnique({
      where: { id },
      include: { _count: { select: { userAssignments: true } } },
    });
    if (!inbound) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return inbound;
  }

  private async requireAssignment(
    inboundId: string,
    assignmentId: string,
    client: Pick<PrismaService, 'userInboundAssignment'> = this.prisma,
  ): Promise<AssignmentWithUser> {
    const assignment = await client.userInboundAssignment.findFirst({
      where: { id: assignmentId, inboundId },
      include: {
        user: {
          select: {
            identity: true,
            username: true,
            status: true,
            deletedAt: true,
            plan: { select: { name: true } },
          },
        },
      },
    });
    if (!assignment) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return assignment;
  }

  private resolveEngine(protocol: InboundProtocol): CoreEngine {
    const engine = PROTOCOL_ENGINE_MAP[protocol];
    if (!engine) {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_protocol_engine_unknown',
        protocol,
      });
    }
    return engine;
  }

  private publishedPortContext() {
    return {
      singBoxUdpPort: this.singBoxUdpPort,
      singBoxTcpPort: this.singBoxTcpPort,
      singBoxTrojanPort: this.singBoxTrojanPort,
      singBoxSsPort: this.singBoxSsPort,
      xrayListenPort: this.xrayListenPort,
      xrayGrpcPort: this.xrayGrpcPort,
      xrayTcpTlsPort: this.xrayTcpTlsPort,
      mtproxyPortMin: this.mtproxyPortMin,
      mtproxyPortMax: this.mtproxyPortMax,
    };
  }

  private assertMtproxyEnabled(): void {
    if (this.mtproxyEnabled) {
      return;
    }
    throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
      reason: 'mtproxy_disabled',
      message:
        'MTProxy is disabled on this install. Re-run install with MTProxy enabled (COMPOSE_PROFILES=mtproxy, MTPROXY_ENABLED=true).',
      messageRu:
        'MTProxy отключён на этой установке. Переустановите с MTProxy (COMPOSE_PROFILES=mtproxy, MTPROXY_ENABLED=true).',
    });
  }

  private async assertMtproxyInboundLimit(
    client: Pick<PrismaService, 'inbound'> | Prisma.TransactionClient = this
      .prisma,
  ): Promise<void> {
    const count = await client.inbound.count({
      where: { protocol: 'MTPROXY' },
    });
    if (count >= MAX_MTPROXY_INBOUNDS) {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_mtproxy_limit_reached',
        message: `At most ${MAX_MTPROXY_INBOUNDS} MTPROXY inbounds are allowed`,
        messageRu: `Допускается не более ${MAX_MTPROXY_INBOUNDS} inbound’ов MTPROXY`,
        limit: MAX_MTPROXY_INBOUNDS,
        count,
      });
    }
  }

  private assertListenPortPublished(
    protocol: InboundProtocol,
    listenPort: number,
  ): void {
    const context = this.publishedPortContext();
    if (protocol === 'MTPROXY') {
      if (isPublishedMtproxyPort(listenPort, context)) {
        return;
      }
      const range = mtproxyPublishedPortRange(context);
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_listen_port_not_published',
        message: `Listen port ${listenPort} is not published for MTPROXY. Use a port in ${range.min}-${range.max} (or change MTPROXY_PORT_MIN / MTPROXY_PORT_MAX and Compose publish).`,
        messageRu: `Порт ${listenPort} не опубликован для MTPROXY. Используйте порт из диапазона ${range.min}-${range.max}, либо измените MTPROXY_PORT_MIN / MTPROXY_PORT_MAX и publish в Compose.`,
        protocol,
        listenPort,
        allowedPortMin: range.min,
        allowedPortMax: range.max,
        transport: 'TCP',
      });
    }
    const allowedPort = publishedListenPortForProtocol(protocol, context);
    if (listenPort === allowedPort) {
      return;
    }
    const transport = protocol === 'HYSTERIA2' ? 'UDP' : 'TCP';
    throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
      reason: 'inbound_listen_port_not_published',
      message: `Listen port ${listenPort} is not published for ${protocol}. Use install ${transport} port ${allowedPort} (or change SING_BOX_UDP_PORT / SING_BOX_TCP_PORT / SING_BOX_TROJAN_PORT / SING_BOX_SS_PORT / XRAY_LISTEN_PORT / XRAY_GRPC_PORT / XRAY_TCP_TLS_PORT and Compose publish).`,
      messageRu: `Порт ${listenPort} не опубликован для ${protocol}. Используйте порт установки ${allowedPort} (${transport}), либо измените SING_BOX_UDP_PORT / SING_BOX_TCP_PORT / SING_BOX_TROJAN_PORT / SING_BOX_SS_PORT / XRAY_LISTEN_PORT / XRAY_GRPC_PORT / XRAY_TCP_TLS_PORT и publish в Compose.`,
      protocol,
      listenPort,
      allowedPort,
      transport,
    });
  }

  private async assertListenPortAvailable(
    listenHost: string,
    listenPort: number,
    excludeId?: string,
    client: Pick<PrismaService, 'inbound'> | Prisma.TransactionClient = this
      .prisma,
  ): Promise<void> {
    const collision = await client.inbound.findFirst({
      where: {
        listenHost,
        listenPort,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, tag: true },
    });
    if (collision) {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_listen_port_conflict',
        message: `Listen address ${listenHost}:${listenPort} is already used by inbound "${collision.tag}"`,
        messageRu: `Адрес ${listenHost}:${listenPort} уже занят inbound «${collision.tag}»`,
        listenHost,
        listenPort,
        conflictingInboundId: collision.id,
        conflictingTag: collision.tag,
      });
    }
  }

  private storageFromInbound(inbound: Inbound): InboundStorage {
    return storageFromInbound(
      inbound.protocol,
      inbound.config,
      this.decryptSecrets(inbound),
    );
  }

  private tryStorageFromInbound(inbound: Inbound): InboundStorage | undefined {
    try {
      return this.storageFromInbound(inbound);
    } catch (error: unknown) {
      if (
        error instanceof ApiException &&
        error.details &&
        typeof error.details === 'object' &&
        (error.details as { reason?: unknown }).reason ===
          'inbound_settings_migration_required'
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private createAssignmentCredential(
    inbound: Inbound,
    input: AddAssignment | RotateAssignmentCredential,
  ): AssignmentCredential {
    if (
      inbound.protocol === 'VLESS_REALITY' ||
      inbound.protocol === 'VLESS_XHTTP_TLS' ||
      inbound.protocol === 'VLESS_GRPC_TLS' ||
      inbound.protocol === 'VLESS_TCP_TLS'
    ) {
      return createVlessCredential(input.uuid);
    }
    if (inbound.protocol === 'TROJAN') {
      return createTrojanCredential(input.password);
    }
    if (inbound.protocol === 'SHADOWSOCKS') {
      const publicConfig = this.parseShadowsocksPublicConfig(inbound);
      return createShadowsocksCredential(publicConfig.method, input.password);
    }
    if (inbound.protocol === 'MTPROXY') {
      return createMtproxyCredential(input.password);
    }
    return createCredential(input.password);
  }

  private decryptSecrets(inbound: Inbound): InboundSecretBundle {
    const encrypted = inbound.secretDataEncrypted;
    if (!encrypted) {
      if (
        inbound.protocol === 'VLESS_REALITY' ||
        inbound.protocol === 'SHADOWSOCKS'
      ) {
        throw new ApiException(
          'INTERNAL_ERROR',
          HttpStatus.INTERNAL_SERVER_ERROR,
          { reason: 'unreadable_inbound_secret_bundle' },
        );
      }
      return { version: 1 };
    }
    try {
      const parsed = JSON.parse(this.encryption.decrypt(encrypted)) as Record<
        string,
        unknown
      >;
      if (!isInboundSecretBundle(inbound.protocol, parsed)) {
        throw new Error('Unsupported secret bundle version');
      }
      return parsed;
    } catch {
      throw new ApiException(
        'INTERNAL_ERROR',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { reason: 'unreadable_inbound_secret_bundle' },
      );
    }
  }

  private decryptCredential(
    encrypted: string,
    protocol: InboundProtocol,
  ): AssignmentCredential {
    if (!encrypted.startsWith('v1:')) {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'credential_rotation_required',
      });
    }
    try {
      const parsed = JSON.parse(
        this.encryption.decrypt(encrypted),
      ) as AssignmentCredential;
      if (parsed.version !== 1) {
        throw new Error('Invalid credential payload');
      }
      if (
        protocol === 'VLESS_REALITY' ||
        protocol === 'VLESS_XHTTP_TLS' ||
        protocol === 'VLESS_GRPC_TLS' ||
        protocol === 'VLESS_TCP_TLS'
      ) {
        if (
          !('uuid' in parsed) ||
          typeof parsed.uuid !== 'string' ||
          Object.keys(parsed).some((key) => key !== 'version' && key !== 'uuid')
        ) {
          throw new Error('Invalid VLESS credential payload');
        }
        return parsed;
      }
      if (
        !('password' in parsed) ||
        typeof parsed.password !== 'string' ||
        Object.keys(parsed).some(
          (key) => key !== 'version' && key !== 'password',
        )
      ) {
        throw new Error('Invalid credential payload');
      }
      if (protocol === 'HYSTERIA2') {
        normalizeHysteria2Password(parsed.password);
      } else if (protocol === 'TROJAN') {
        normalizeTrojanPassword(parsed.password);
      } else if (protocol === 'MTPROXY') {
        normalizeMtproxySecret(parsed.password);
      }
      return parsed;
    } catch (error: unknown) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new ApiException(
        'INTERNAL_ERROR',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { reason: 'unreadable_assignment_credential' },
      );
    }
  }

  private encryptSecrets(secrets: InboundSecretBundle): string | null {
    const payload = encryptableSecrets(secrets);
    return payload ? this.encryption.encrypt(payload) : null;
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

  private applyMutation(
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
    reason: string,
  ) {
    return this.coreApply.apply(actor, { reason }, 'MUTATION', metadata);
  }

  private toResult(inbound: InboundWithCount): InboundResult {
    const listen = {
      listenHost: inbound.listenHost,
      listenPort: inbound.listenPort,
      publicHost: inbound.publicHost ?? '',
      publicPort: inbound.publicPort ?? inbound.listenPort,
      enabled: inbound.enabled,
    };
    const common = {
      id: inbound.id,
      tag: inbound.tag,
      displayNameTemplate: inbound.displayNameTemplate,
      revision: inbound.revision,
      needsApply: inbound.needsApply,
      assignmentCount: inbound._count.userAssignments,
      createdAt: inbound.createdAt.toISOString(),
      updatedAt: inbound.updatedAt.toISOString(),
      disabledAt: inbound.disabledAt?.toISOString() ?? null,
    };
    if (inbound.protocol === 'HYSTERIA2') {
      return {
        ...common,
        protocol: 'HYSTERIA2',
        settings: {
          ...this.parseHysteria2PublicConfig(inbound),
          ...listen,
        },
      };
    }
    if (inbound.protocol === 'VLESS_REALITY') {
      return {
        ...common,
        protocol: 'VLESS_REALITY',
        settings: {
          ...this.parseVlessRealityPublicConfig(inbound),
          ...listen,
        },
      };
    }
    if (inbound.protocol === 'VLESS_XHTTP_TLS') {
      return {
        ...common,
        protocol: 'VLESS_XHTTP_TLS',
        settings: {
          ...this.parseVlessXhttpTlsPublicConfig(inbound),
          ...listen,
        },
      };
    }
    if (inbound.protocol === 'VLESS_GRPC_TLS') {
      return {
        ...common,
        protocol: 'VLESS_GRPC_TLS',
        settings: {
          ...this.parseVlessGrpcTlsPublicConfig(inbound),
          ...listen,
        },
      };
    }
    if (inbound.protocol === 'VLESS_TCP_TLS') {
      return {
        ...common,
        protocol: 'VLESS_TCP_TLS',
        settings: {
          ...this.parseVlessTcpTlsPublicConfig(inbound),
          ...listen,
        },
      };
    }
    if (inbound.protocol === 'TROJAN') {
      return {
        ...common,
        protocol: 'TROJAN',
        settings: {
          ...this.parseTrojanPublicConfig(inbound),
          ...listen,
        },
      };
    }
    if (inbound.protocol === 'MTPROXY') {
      return {
        ...common,
        protocol: 'MTPROXY',
        settings: {
          ...this.parseMtproxyPublicConfig(inbound),
          ...listen,
        },
      };
    }
    return {
      ...common,
      protocol: 'SHADOWSOCKS',
      settings: {
        ...this.parseShadowsocksPublicConfig(inbound),
        ...listen,
      },
    };
  }

  private parseHysteria2PublicConfig(inbound: Inbound) {
    try {
      return parseHysteria2PublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parseVlessRealityPublicConfig(inbound: Inbound) {
    try {
      return parseVlessRealityPublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parseTrojanPublicConfig(inbound: Inbound) {
    try {
      return parseTrojanPublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parseVlessXhttpTlsPublicConfig(inbound: Inbound) {
    try {
      return parseVlessXhttpTlsPublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parseVlessGrpcTlsPublicConfig(inbound: Inbound) {
    try {
      return parseVlessGrpcTlsPublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parseVlessTcpTlsPublicConfig(inbound: Inbound) {
    try {
      return parseVlessTcpTlsPublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parseShadowsocksPublicConfig(inbound: Inbound) {
    try {
      return parseShadowsocksPublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parseMtproxyPublicConfig(inbound: Inbound) {
    try {
      return parseMtproxyPublicConfig(inbound.config);
    } catch {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'inbound_settings_migration_required',
        inboundId: inbound.id,
      });
    }
  }

  private parsePublicConfig(inbound: Inbound): InboundPublicConfig {
    if (inbound.protocol === 'HYSTERIA2') {
      return this.parseHysteria2PublicConfig(inbound);
    }
    if (inbound.protocol === 'VLESS_REALITY') {
      return this.parseVlessRealityPublicConfig(inbound);
    }
    if (inbound.protocol === 'VLESS_XHTTP_TLS') {
      return this.parseVlessXhttpTlsPublicConfig(inbound);
    }
    if (inbound.protocol === 'VLESS_GRPC_TLS') {
      return this.parseVlessGrpcTlsPublicConfig(inbound);
    }
    if (inbound.protocol === 'VLESS_TCP_TLS') {
      return this.parseVlessTcpTlsPublicConfig(inbound);
    }
    if (inbound.protocol === 'TROJAN') {
      return this.parseTrojanPublicConfig(inbound);
    }
    if (inbound.protocol === 'MTPROXY') {
      return this.parseMtproxyPublicConfig(inbound);
    }
    return this.parseShadowsocksPublicConfig(inbound);
  }

  private toAuditInbound(inbound: InboundWithCount): unknown {
    try {
      return this.toResult(inbound);
    } catch {
      return {
        id: inbound.id,
        tag: inbound.tag,
        protocol: inbound.protocol,
        listenHost: inbound.listenHost,
        listenPort: inbound.listenPort,
        publicHost: inbound.publicHost,
        publicPort: inbound.publicPort,
        enabled: inbound.enabled,
        revision: inbound.revision,
        needsApply: inbound.needsApply,
        settingsMigrationRequired: true,
      };
    }
  }

  private toAssignment(assignment: AssignmentWithUser): AssignmentResult {
    return {
      id: assignment.id,
      inboundId: assignment.inboundId,
      userId: assignment.userId,
      userIdentity: assignment.user.identity,
      userUsername: assignment.user.username,
      status: assignment.status,
      credentialName: assignment.credentialName,
      credentialVersion: assignment.credentialVersion,
      credentialPresent: assignment.credentialEncrypted.startsWith('v1:'),
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
      disabledAt: assignment.disabledAt?.toISOString() ?? null,
      rotatedAt: assignment.rotatedAt?.toISOString() ?? null,
    };
  }

  private async recordMutationFailure(
    action:
      | 'INBOUND_CREATE'
      | 'INBOUND_UPDATE'
      | 'INBOUND_DELETE'
      | 'INBOUND_ENABLE'
      | 'INBOUND_DISABLE'
      | 'INBOUND_ASSIGNMENT_ADD'
      | 'INBOUND_ASSIGNMENT_REMOVE'
      | 'INBOUND_CREDENTIAL_ROTATE'
      | 'INBOUND_CREDENTIAL_REVEAL',
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
    resourceId: string | null,
    error: unknown,
    input?: unknown,
  ): Promise<void> {
    await this.audit.recordFailureSafely({
      actorAdminId: actor.id,
      action,
      resourceType: 'inbound',
      resourceId,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      metadata: {
        error: error instanceof ApiException ? error.code : errorName(error),
        input,
      },
    });
  }

  private mapMutationError(error: unknown): unknown {
    if (error instanceof ApiException) {
      return error;
    }
    if (error && typeof error === 'object') {
      const code = (error as { code?: unknown }).code;
      if (code === 'P2002') {
        return new ApiException('CONFLICT', HttpStatus.CONFLICT, {
          reason: 'unique_constraint',
        });
      }
      if (code === 'P2003') {
        return new ApiException('CONFLICT', HttpStatus.CONFLICT, {
          reason: 'referenced_history_prevents_delete',
        });
      }
    }
    return error;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
