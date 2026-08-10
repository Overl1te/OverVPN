import type { ConfigService } from '@nestjs/config';
import type { CoreEngine } from '@overvpn/shared/constants';
import type { SecretEncryptionService } from '../auth/auth-crypto';
import type { AuditService } from '../audit/audit.service';
import type { SupportIntegrityService } from '../common/support-integrity';
import type { AppEnvironment } from '../config/environment';
import type { CoreApplyRecord } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import type { TelegramNotificationService } from '../notifications/telegram-notification.service';
import { CoreFileSystem } from './core-adapters';
import { CoreApplyService } from './core-apply.service';
import type { CoreEngineRegistry } from './core-engine.registry';
import {
  EngineProvider,
  type CoreDesiredState,
  type CoreProviderApplyResult,
  type RenderedCoreConfig,
} from './core-provider';
import type { CoreStateLoader } from './core-state.loader';
import type { RedisDistributedLock } from './distributed-lock';
import type { HttpAgentTransport } from './http-agent.transport';

describe('CoreApplyService validation gate', () => {
  it('persists FAILED and never writes/reloads when validation fails', async () => {
    const record = applyRecord();
    const update = jest.fn(({ data }: { data: Partial<CoreApplyRecord> }) =>
      Promise.resolve({
        ...record,
        ...data,
        status: data.status ?? record.status,
        updatedAt: new Date(),
      }),
    );
    const prisma = {
      coreApplyRecord: {
        create: jest.fn(() => Promise.resolve(record)),
        update,
      },
      coreState: {
        findUnique: jest.fn(() => Promise.resolve(null)),
      },
      proxyServer: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        findUnique: jest.fn(),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    } as unknown as PrismaService;
    const provider = new ValidationFailingProvider('SING_BOX');
    const registry = registryOf([provider]);
    const stateLoader = {
      load: jest.fn(() => Promise.resolve(emptyState('SING_BOX'))),
    } as unknown as CoreStateLoader;
    const lock = {
      withLock: <T>(
        operation: (assertOwned: () => void) => Promise<T>,
      ): Promise<T> => operation(() => undefined),
    } as RedisDistributedLock;
    const fileSystem = new MemoryFileSystem();
    const audit = {
      record: jest.fn(),
      recordFailureSafely: jest.fn(() => Promise.resolve()),
    } as unknown as AuditService;
    const notifications = {
      notifyApplyFailure: jest.fn(() => Promise.resolve()),
    } as unknown as TelegramNotificationService;
    const supportIntegrity = {
      assertIntact: jest.fn(),
      isIntact: jest.fn(() => true),
    } as unknown as SupportIntegrityService;
    const agentTransport = {
      postApply: jest.fn(),
    } as unknown as HttpAgentTransport;
    const encryption = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
    } as unknown as SecretEncryptionService;
    const service = new CoreApplyService(
      prisma,
      registry,
      stateLoader,
      lock,
      fileSystem,
      audit,
      notifications,
      supportIntegrity,
      agentTransport,
      encryption,
      fakeConfig(),
    );

    const result = await service.apply(
      {
        id: 'bde8cc70-8467-43ab-b32c-4cd07c218d9e',
        username: 'owner',
        role: 'OWNER',
        locale: 'en',
        active: true,
        totpEnabled: true,
        lastLoginAt: null,
      },
      { reason: 'validation failure test' },
      'MANUAL',
      { requestId: 'request', ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('validation failed');
    expect(provider.applyCalls).toBe(0);
    expect(fileSystem.atomicWrites).toBe(0);
    expect(
      update.mock.calls.some(([argument]) => argument.data.status === 'FAILED'),
    ).toBe(true);
  });
});

describe('CoreApplyService multi-engine apply', () => {
  it('marks PARTIAL_SUCCEEDED when one engine fails and the other succeeds', async () => {
    const record = applyRecord();
    const update = jest.fn(({ data }: { data: Partial<CoreApplyRecord> }) =>
      Promise.resolve({
        ...record,
        ...data,
        status: data.status ?? record.status,
        updatedAt: new Date(),
      }),
    );
    const updateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const inboundUpdateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const userUpdateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const coreStateUpsert = jest.fn(() => Promise.resolve({}));
    const prisma = {
      coreApplyRecord: {
        create: jest.fn(() => Promise.resolve(record)),
        update,
        updateMany,
      },
      coreState: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        upsert: coreStateUpsert,
      },
      proxyServer: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        findUnique: jest.fn(),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      inbound: {
        updateMany: inboundUpdateMany,
      },
      user: {
        updateMany: userUpdateMany,
      },
      $transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            coreApplyRecord: { update, updateMany },
            coreState: { upsert: coreStateUpsert },
            inbound: { updateMany: inboundUpdateMany },
            user: { updateMany: userUpdateMany },
          }),
      ),
    } as unknown as PrismaService;

    const singBox = new SucceedingProvider('SING_BOX', 'a'.repeat(64));
    const xray = new ValidationFailingProvider('XRAY');
    const registry = registryOf([singBox, xray]);
    const stateLoader = {
      load: jest.fn((engine: CoreEngine) =>
        Promise.resolve(emptyState(engine)),
      ),
    } as unknown as CoreStateLoader;
    const lock = {
      withLock: <T>(
        operation: (assertOwned: () => void) => Promise<T>,
      ): Promise<T> => operation(() => undefined),
    } as RedisDistributedLock;
    const audit = {
      record: jest.fn(),
      recordFailureSafely: jest.fn(() => Promise.resolve()),
      recordSafely: jest.fn(() => Promise.resolve()),
    } as unknown as AuditService;
    const notifyApplyFailure = jest.fn(() => Promise.resolve());
    const notifications = {
      notifyApplyFailure,
    } as unknown as TelegramNotificationService;
    const supportIntegrity = {
      assertIntact: jest.fn(),
      isIntact: jest.fn(() => true),
    } as unknown as SupportIntegrityService;
    const agentTransport = {
      postApply: jest.fn(),
    } as unknown as HttpAgentTransport;
    const encryption = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
    } as unknown as SecretEncryptionService;
    const service = new CoreApplyService(
      prisma,
      registry,
      stateLoader,
      lock,
      new MemoryFileSystem(),
      audit,
      notifications,
      supportIntegrity,
      agentTransport,
      encryption,
      fakeConfig(),
    );

    const result = await service.apply(
      {
        id: 'bde8cc70-8467-43ab-b32c-4cd07c218d9e',
        username: 'owner',
        role: 'OWNER',
        locale: 'en',
        active: true,
        totpEnabled: true,
        lastLoginAt: null,
      },
      { reason: 'partial apply test' },
      'MANUAL',
      { requestId: 'request', ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(result.status).toBe('PARTIAL_SUCCEEDED');
    expect(singBox.applyCalls).toBe(1);
    expect(xray.applyCalls).toBe(0);
    expect(result.engineResults?.SING_BOX?.status).toBe('SUCCEEDED');
    expect(result.engineResults?.XRAY?.status).toBe('FAILED');
    expect(coreStateUpsert).toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(notifyApplyFailure).toHaveBeenCalled();
  });
});

describe('CoreApplyService applySystem', () => {
  it('applies each proxy with its own proxyServerId (no cross-node merge)', async () => {
    const localId = '00000000-0000-4000-8000-000000000001';
    const remoteId = '42d6f370-7c9c-4db6-8596-0817b5a8c00b';
    const record = applyRecord();
    const update = jest.fn(({ data }: { data: Partial<CoreApplyRecord> }) =>
      Promise.resolve({
        ...record,
        ...data,
        status: data.status ?? record.status,
        updatedAt: new Date(),
      }),
    );
    const userUpdateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const findUnique = jest.fn(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve({
        id,
        name: id === localId ? 'local' : 'remote',
        agentBaseUrl: null,
        settings: {},
        isLocal: id === localId,
        status: 'ONLINE',
      }),
    );
    const prisma = {
      coreApplyRecord: {
        create: jest.fn(() => Promise.resolve(record)),
        update,
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      coreState: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        upsert: jest.fn(() => Promise.resolve({})),
      },
      proxyServer: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        findUnique,
        findMany: jest.fn(() =>
          Promise.resolve([
            { id: localId, name: 'local', isLocal: true, status: 'ONLINE' },
            { id: remoteId, name: 'remote', isLocal: false, status: 'ONLINE' },
          ]),
        ),
      },
      proxyCoreState: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        upsert: jest.fn(() => Promise.resolve({})),
      },
      inbound: {
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      user: {
        updateMany: userUpdateMany,
      },
      $transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            coreApplyRecord: {
              update,
              updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
            },
            coreState: { upsert: jest.fn(() => Promise.resolve({})) },
            proxyCoreState: { upsert: jest.fn(() => Promise.resolve({})) },
            inbound: {
              updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
            },
            user: { updateMany: jest.fn(() => Promise.resolve({ count: 0 })) },
          }),
      ),
    } as unknown as PrismaService;

    const load = jest.fn((engine: CoreEngine) =>
      Promise.resolve(emptyState(engine)),
    );
    const service = new CoreApplyService(
      prisma,
      registryOf([new SucceedingProvider('SING_BOX', 'b'.repeat(64))]),
      { load } as unknown as CoreStateLoader,
      {
        withLock: <T>(
          operation: (assertOwned: () => void) => Promise<T>,
        ): Promise<T> => operation(() => undefined),
      } as RedisDistributedLock,
      new MemoryFileSystem(),
      {
        record: jest.fn(),
        recordFailureSafely: jest.fn(() => Promise.resolve()),
        recordSafely: jest.fn(() => Promise.resolve()),
      } as unknown as AuditService,
      {
        notifyApplyFailure: jest.fn(() => Promise.resolve()),
      } as unknown as TelegramNotificationService,
      {
        assertIntact: jest.fn(),
        isIntact: jest.fn(() => true),
      } as unknown as SupportIntegrityService,
      { postApply: jest.fn() } as unknown as HttpAgentTransport,
      {
        encrypt: jest.fn((value: string) => `enc:${value}`),
        decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
      } as unknown as SecretEncryptionService,
      fakeConfig(),
    );

    const result = await service.applySystem(
      'Automated enforcement reconciliation',
    );

    expect(result.status).toBe('SUCCEEDED');
    const scopedIds = load.mock.calls.map(
      (call) =>
        (call[1] as { proxyServerId?: string } | undefined)?.proxyServerId,
    );
    expect(scopedIds).toContain(localId);
    expect(scopedIds).toContain(remoteId);
    expect(scopedIds.every((id) => Boolean(id))).toBe(true);
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { needsApply: true },
      data: { needsApply: false },
    });
  });
});

class ValidationFailingProvider extends EngineProvider {
  applyCalls = 0;

  constructor(readonly engine: CoreEngine) {
    super();
  }

  renderConfig(): RenderedCoreConfig {
    return {
      config: {},
      canonical: '{}\n',
      redactedConfig: {},
      redactedCanonical: '{}\n',
      hash: 'a'.repeat(64),
      secretValues: [],
    };
  }

  validate() {
    return Promise.resolve({
      valid: false,
      command: this.engine === 'SING_BOX' ? 'sing-box' : 'xray',
      args: ['check', '-c', 'candidate'],
      exitCode: 1,
      timedOut: false,
      error: 'invalid fixture',
    });
  }

  apply(): Promise<never> {
    this.applyCalls += 1;
    return Promise.reject(new Error('apply must not run'));
  }

  health(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  getTrafficSnapshot(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  getOnlineClients(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }
}

class SucceedingProvider extends EngineProvider {
  applyCalls = 0;

  constructor(
    readonly engine: CoreEngine,
    private readonly hash: string,
  ) {
    super();
  }

  renderConfig(): RenderedCoreConfig {
    return {
      config: {},
      canonical: '{}\n',
      redactedConfig: {},
      redactedCanonical: '{}\n',
      hash: this.hash,
      secretValues: [],
    };
  }

  validate() {
    return Promise.resolve({
      valid: true,
      command: this.engine === 'SING_BOX' ? 'sing-box' : 'xray',
      args: ['check', '-c', 'candidate'],
      exitCode: 0,
      timedOut: false,
      error: null,
    });
  }

  apply(): Promise<CoreProviderApplyResult> {
    this.applyCalls += 1;
    const now = new Date();
    return Promise.resolve({
      status: 'SUCCEEDED',
      desiredHash: this.hash,
      previousHash: null,
      appliedAt: now,
      completedAt: now,
      error: null,
      rollbackOutcome: 'NOT_REQUIRED',
      rollbackStartedAt: null,
      rollbackCompletedAt: null,
    });
  }

  health(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  getTrafficSnapshot(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  getOnlineClients(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }
}

class MemoryFileSystem extends CoreFileSystem {
  atomicWrites = 0;

  read(): Promise<Buffer> {
    return Promise.resolve(Buffer.from('{}\n'));
  }

  atomicWrite(): Promise<void> {
    this.atomicWrites += 1;
    return Promise.resolve();
  }

  replace(): Promise<void> {
    return Promise.resolve();
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }

  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function registryOf(providers: EngineProvider[]): CoreEngineRegistry {
  const byEngine = new Map(
    providers.map((provider) => [provider.engine, provider]),
  );
  return {
    get: (engine: CoreEngine) => {
      const provider = byEngine.get(engine);
      if (!provider) {
        throw new Error(`missing ${engine}`);
      }
      return provider;
    },
    all: () =>
      (['SING_BOX', 'XRAY'] as const).flatMap((engine) => {
        const provider = byEngine.get(engine);
        return provider ? [provider] : [];
      }),
  } as unknown as CoreEngineRegistry;
}

function emptyState(engine: CoreEngine): CoreDesiredState {
  return {
    engine,
    loadedAt: new Date(),
    desiredRevision: 0,
    inbounds: [],
    inboundRevisions: [],
    userRevisions: [],
  };
}

function fakeConfig() {
  const values = {
    SING_BOX_CONFIG_PATH: '/tmp/config.json',
    XRAY_CONFIG_PATH: '/tmp/xray/config.json',
    MTPROXY_CONFIG_PATH: '/tmp/mtproxy/config.json',
  } satisfies Partial<AppEnvironment>;
  return {
    get: (key: keyof AppEnvironment) => values[key as keyof typeof values],
  } as ConfigService<AppEnvironment, true>;
}

function applyRecord(): CoreApplyRecord {
  const now = new Date();
  return {
    id: 'd0d18d24-7eaf-49ff-9aef-9269021eeac5',
    proxyServerId: null,
    status: 'APPLYING',
    trigger: 'MANUAL',
    reason: 'validation failure test',
    configRevision: null,
    configChecksum: null,
    desiredHash: null,
    previousHash: null,
    configPath: null,
    diffSummary: null,
    resourceType: null,
    resourceId: null,
    operation: null,
    initiatedByAdminId: 'bde8cc70-8467-43ab-b32c-4cd07c218d9e',
    startedAt: now,
    appliedAt: null,
    rollbackStartedAt: null,
    rollbackCompletedAt: null,
    completedAt: null,
    errorMessage: null,
    rollbackOutcome: null,
    engineResults: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}
