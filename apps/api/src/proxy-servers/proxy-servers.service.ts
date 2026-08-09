import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
  DEFAULT_PROXY_INSTALL_TOKEN_TTL_SEC,
} from '@overvpn/shared/constants';
import type {
  CreateProxyServer,
  ProxyInstallCommandResponse,
  ProxyServerListQuery,
  ProxyServerSummary,
  ProxyServerWizard,
  UpdateProxyServer,
} from '@overvpn/shared/schemas';
import type { Prisma } from '../generated/prisma/client';
import { hashOpaqueToken } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';
import { CoreApplyService } from '../core/core-apply.service';
import { PrismaService } from '../infrastructure/infrastructure.module';
import { NODE_TOKEN_SETTINGS_KEY } from './proxy-server-secrets';

@Injectable()
export class ProxyServersService {
  private readonly logger = new Logger(ProxyServersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly coreApply: CoreApplyService,
  ) {}

  async list(query: ProxyServerListQuery): Promise<{
    items: ProxyServerSummary[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }> {
    const where: Prisma.ProxyServerWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
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
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.proxyServer.count({ where }),
      this.prisma.proxyServer.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toSummary(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async get(id: string): Promise<ProxyServerSummary> {
    return this.toSummary(await this.require(id));
  }

  async create(input: CreateProxyServer): Promise<ProxyServerSummary> {
    const row = await this.prisma.proxyServer.create({
      data: {
        name: input.name.trim(),
        isLocal: input.isLocal ?? false,
        status: 'PENDING',
        heartbeatIntervalSec: DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
        settings: input.note ? { note: input.note } : {},
      },
    });
    return this.toSummary(row);
  }

  async update(
    id: string,
    input: UpdateProxyServer,
  ): Promise<ProxyServerSummary> {
    await this.require(id);
    const row = await this.prisma.proxyServer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.publicHost !== undefined
          ? { publicHost: input.publicHost }
          : {}),
        ...(input.agentBaseUrl !== undefined
          ? { agentBaseUrl: input.agentBaseUrl }
          : {}),
        ...(input.enabledEngines !== undefined
          ? { enabledEngines: toInputJson(input.enabledEngines) }
          : {}),
        ...(input.enabledProtocols !== undefined
          ? {
              enabledProtocols: toInputJson(input.enabledProtocols),
            }
          : {}),
        ...(input.heartbeatIntervalSec !== undefined
          ? { heartbeatIntervalSec: input.heartbeatIntervalSec }
          : {}),
        ...(input.settings !== undefined
          ? { settings: toInputJson(input.settings) }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    return this.toSummary(row);
  }

  async createInstallCommand(id: string): Promise<ProxyInstallCommandResponse> {
    const existing = await this.require(id);
    const installToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + DEFAULT_PROXY_INSTALL_TOKEN_TTL_SEC * 1000,
    );
    const settings = clearNodeTokenSetting(existing.settings);
    await this.prisma.proxyServer.update({
      where: { id },
      data: {
        installTokenHash: hashOpaqueToken(installToken),
        installTokenExpiresAt: expiresAt,
        status: 'PENDING',
        nodeTokenHash: null,
        settings: toInputJson(settings),
      },
    });
    const panelUrl = this.panelBaseUrl();
    const command = [
      'curl -fsSL https://raw.githubusercontent.com/overl1te/OverVPN/main/install.sh',
      '| sudo bash -s -- install-proxy',
      `--panel-url ${shellQuote(panelUrl)}`,
      `--token ${shellQuote(installToken)}`,
      `--node-id ${shellQuote(id)}`,
    ].join(' ');
    return {
      proxyServerId: id,
      installToken,
      expiresAt: expiresAt.toISOString(),
      command,
      panelUrl,
    };
  }

  async applyWizard(
    id: string,
    input: ProxyServerWizard,
  ): Promise<ProxyServerSummary> {
    const existing = await this.require(id);
    const settings: Record<string, unknown> = {
      ...asObject(existing.settings),
      ...(input.settings ?? {}),
    };
    // Never let wizard payload drop the encrypted node token used for panel→agent push.
    const existingToken = asObject(existing.settings)[NODE_TOKEN_SETTINGS_KEY];
    if (typeof existingToken === 'string') {
      settings[NODE_TOKEN_SETTINGS_KEY] = existingToken;
    }
    const row = await this.prisma.proxyServer.update({
      where: { id },
      data: {
        publicHost: input.publicHost,
        ...(input.agentBaseUrl !== undefined
          ? { agentBaseUrl: input.agentBaseUrl }
          : {}),
        enabledEngines: toInputJson(input.enabledEngines),
        enabledProtocols: toInputJson(input.enabledProtocols),
        heartbeatIntervalSec: input.heartbeatIntervalSec,
        settings: toInputJson(settings),
      },
    });
    if (row.agentBaseUrl) {
      const pushed = await this.coreApply.pushToAgentBestEffort(
        row.id,
        `Wizard apply for proxy ${row.name}`,
      );
      if (!pushed) {
        this.logger.warn(
          `Wizard saved for ${row.id} but agent push did not complete`,
        );
      }
    }
    return this.toSummary(row);
  }

  async findByInstallToken(token: string) {
    const tokenHash = hashOpaqueToken(token);
    return this.prisma.proxyServer.findFirst({
      where: {
        installTokenHash: tokenHash,
        installTokenExpiresAt: { gt: new Date() },
      },
    });
  }

  async findByNodeToken(token: string) {
    const tokenHash = hashOpaqueToken(token);
    return this.prisma.proxyServer.findFirst({
      where: { nodeTokenHash: tokenHash },
    });
  }

  private async require(id: string) {
    const row = await this.prisma.proxyServer.findUnique({ where: { id } });
    if (!row) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
        reason: 'proxy_server_not_found',
        message: 'Proxy server not found',
        messageRu: 'Прокси-сервер не найден',
      });
    }
    return row;
  }

  private panelBaseUrl(): string {
    // Agent must hit the panel API (/api/agent/...), not the subscription vhost.
    const cors = this.config.get('CORS_ORIGINS', { infer: true });
    const fromCors = cors.find((origin) => {
      try {
        const url = new URL(origin);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    });
    if (fromCors) {
      try {
        const url = new URL(fromCors);
        return `${url.protocol}//${url.host}`;
      } catch {
        /* fall through */
      }
    }
    const sub = this.config.get('SUB_PUBLIC_BASE_URL', { infer: true });
    try {
      const url = new URL(sub);
      return `${url.protocol}//${url.host}`;
    } catch {
      return sub.replace(/\/+$/, '');
    }
  }

  private toSummary(row: {
    id: string;
    name: string;
    status: ProxyServerSummary['status'];
    agentBaseUrl: string | null;
    publicHost: string | null;
    enabledEngines: Prisma.JsonValue;
    enabledProtocols: Prisma.JsonValue;
    capabilities: Prisma.JsonValue;
    lastSeenAt: Date | null;
    lastError: string | null;
    heartbeatIntervalSec: number;
    settings: Prisma.JsonValue;
    isLocal: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProxyServerSummary {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      agentBaseUrl: row.agentBaseUrl,
      publicHost: row.publicHost,
      enabledEngines: asStringArray(
        row.enabledEngines,
      ) as ProxyServerSummary['enabledEngines'],
      enabledProtocols: asStringArray(
        row.enabledProtocols,
      ) as ProxyServerSummary['enabledProtocols'],
      capabilities: asObject(row.capabilities),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      lastError: row.lastError,
      heartbeatIntervalSec: row.heartbeatIntervalSec,
      settings: asObject(row.settings),
      isLocal: row.isLocal,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function asStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = entry;
    }
    return result;
  }
  return {};
}

function clearNodeTokenSetting(
  value: Prisma.JsonValue,
): Record<string, unknown> {
  const next = { ...asObject(value) };
  delete next[NODE_TOKEN_SETTINGS_KEY];
  return next;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Stable fingerprint helper for future agent identity checks. */
export function fingerprintToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}
