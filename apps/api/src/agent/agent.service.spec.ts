import type { ExecutionContext } from '@nestjs/common';
import { hashOpaqueToken } from '../auth/auth-crypto';
import type { SecretEncryptionService } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import type { CoreEngineRegistry } from '../core/core-engine.registry';
import type { CoreStateLoader } from '../core/core-state.loader';
import type { ProxyServer } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import { NODE_TOKEN_SETTINGS_KEY } from '../proxy-servers/proxy-server-secrets';
import { InstallTokenGuard, NodeTokenGuard } from './agent.guards';
import { AgentService } from './agent.service';

const NODE_ID = '11111111-1111-4111-8111-111111111111';

function proxyRow(overrides: Partial<ProxyServer> = {}): ProxyServer {
  const base: ProxyServer = {
    id: NODE_ID,
    name: 'edge-1',
    status: 'PENDING',
    agentBaseUrl: null,
    installTokenHash: null,
    installTokenExpiresAt: null,
    nodeTokenHash: null,
    publicHost: null,
    enabledEngines: ['SING_BOX'],
    enabledProtocols: ['HYSTERIA2'],
    capabilities: {},
    lastSeenAt: null,
    lastError: null,
    heartbeatIntervalSec: 20,
    settings: {},
    isLocal: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  return { ...base, ...overrides };
}

type AgentRequest = {
  params: { id: string };
  headers: Record<string, string>;
  proxyServer?: ProxyServer;
};

function httpContext(params: { id: string; authorization?: string }): {
  context: ExecutionContext;
  request: AgentRequest;
} {
  const request: AgentRequest = {
    params: { id: params.id },
    headers: {
      ...(params.authorization ? { authorization: params.authorization } : {}),
    },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('InstallTokenGuard', () => {
  it('rejects missing bearer token', async () => {
    const findFirst = jest.fn();
    const prisma = {
      proxyServer: { findFirst },
    } as unknown as PrismaService;
    const guard = new InstallTokenGuard(prisma);

    await expect(
      guard.canActivate(httpContext({ id: NODE_ID }).context),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      guard.canActivate(httpContext({ id: NODE_ID }).context),
    ).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('accepts valid install token for the path node id', async () => {
    const token = 'install-token-value-with-enough-entropy-xx';
    const row = proxyRow({
      installTokenHash: hashOpaqueToken(token),
      installTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    const findFirst = jest.fn(() => Promise.resolve(row));
    const prisma = {
      proxyServer: { findFirst },
    } as unknown as PrismaService;
    const guard = new InstallTokenGuard(prisma);
    const { context, request } = httpContext({
      id: NODE_ID,
      authorization: `Bearer ${token}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(request.proxyServer?.id).toBe(NODE_ID);
  });
});

describe('NodeTokenGuard', () => {
  it('rejects unknown node token', async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const prisma = {
      proxyServer: { findFirst },
    } as unknown as PrismaService;
    const guard = new NodeTokenGuard(prisma);

    await expect(
      guard.canActivate(
        httpContext({
          id: NODE_ID,
          authorization: 'Bearer not-a-real-node-token-value',
        }).context,
      ),
    ).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('accepts hashed node token', async () => {
    const token = 'node-token-value-with-enough-entropy-xxxx';
    const row = proxyRow({
      status: 'ONLINE',
      nodeTokenHash: hashOpaqueToken(token),
    });
    const findFirst = jest.fn(() => Promise.resolve(row));
    const prisma = {
      proxyServer: { findFirst },
    } as unknown as PrismaService;
    const guard = new NodeTokenGuard(prisma);

    await expect(
      guard.canActivate(
        httpContext({
          id: NODE_ID,
          authorization: `Bearer ${token}`,
        }).context,
      ),
    ).resolves.toBe(true);
  });
});

describe('AgentService.register', () => {
  it('issues nodeToken, stores hash + encrypted secret, clears install token, sets ONLINE', async () => {
    const existing = proxyRow({
      installTokenHash: 'abc',
      installTokenExpiresAt: new Date(Date.now() + 60_000),
      settings: { note: 'keep-me' },
    });
    const update = jest.fn(
      (args: {
        where: { id: string };
        data: {
          status?: string;
          agentBaseUrl?: string;
          nodeTokenHash?: string;
          installTokenHash?: null;
          installTokenExpiresAt?: null;
          lastError?: null;
          settings?: Record<string, unknown>;
        };
      }) =>
        Promise.resolve({
          ...existing,
          ...args.data,
          status:
            (args.data.status as ProxyServer['status']) ?? existing.status,
          heartbeatIntervalSec: existing.heartbeatIntervalSec,
        }),
    );
    const prisma = {
      proxyServer: { update },
    } as unknown as PrismaService;
    const encrypt = jest.fn((value: string) => `enc:${value}`);
    const encryption = {
      encrypt,
      decrypt: jest.fn(),
    } as unknown as SecretEncryptionService;
    const service = new AgentService(
      prisma,
      encryption,
      { load: jest.fn() } as unknown as CoreStateLoader,
      { all: () => [] } as unknown as CoreEngineRegistry,
    );

    const result = await service.register(existing, {
      hostname: 'proxy-1',
      agentBaseUrl: 'http://10.0.0.5:7700',
      agentVersion: '0.1.0',
      capabilities: { engines: ['SING_BOX'] },
    });

    expect(result.proxyServerId).toBe(NODE_ID);
    expect(result.status).toBe('ONLINE');
    expect(result.nodeToken.length).toBeGreaterThanOrEqual(32);
    expect(result.heartbeatIntervalSec).toBe(20);
    expect(update).toHaveBeenCalledTimes(1);
    const updateArg = update.mock.calls[0]?.[0];
    expect(updateArg).toBeDefined();
    expect(updateArg?.where).toEqual({ id: NODE_ID });
    expect(updateArg?.data.status).toBe('ONLINE');
    expect(updateArg?.data.agentBaseUrl).toBe('http://10.0.0.5:7700');
    expect(updateArg?.data.nodeTokenHash).toBe(
      hashOpaqueToken(result.nodeToken),
    );
    expect(updateArg?.data.installTokenHash).toBeNull();
    expect(updateArg?.data.installTokenExpiresAt).toBeNull();
    expect(updateArg?.data.lastError).toBeNull();
    expect(updateArg?.data.settings).toMatchObject({
      note: 'keep-me',
      hostname: 'proxy-1',
      agentVersion: '0.1.0',
      [NODE_TOKEN_SETTINGS_KEY]: `enc:${result.nodeToken}`,
    });
    expect(encrypt).toHaveBeenCalledWith(result.nodeToken);
  });
});
