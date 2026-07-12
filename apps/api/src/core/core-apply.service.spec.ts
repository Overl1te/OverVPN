import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import type { AppEnvironment } from '../config/environment';
import type { CoreApplyRecord } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import type { TelegramNotificationService } from '../notifications/telegram-notification.service';
import { CoreFileSystem } from './core-adapters';
import { CoreApplyService } from './core-apply.service';
import {
  CoreProvider,
  type CoreDesiredState,
  type RenderedCoreConfig,
} from './core-provider';
import type { CoreStateLoader } from './core-state.loader';
import type { RedisDistributedLock } from './distributed-lock';

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
    } as unknown as PrismaService;
    const provider = new ValidationFailingProvider();
    const stateLoader = {
      load: jest.fn(() => Promise.resolve(emptyState())),
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
    const service = new CoreApplyService(
      prisma,
      provider,
      stateLoader,
      lock,
      fileSystem,
      audit,
      notifications,
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

class ValidationFailingProvider extends CoreProvider {
  applyCalls = 0;

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
      command: 'sing-box',
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

function emptyState(): CoreDesiredState {
  return {
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
  } satisfies Partial<AppEnvironment>;
  return {
    get: (key: keyof AppEnvironment) => values[key as keyof typeof values],
  } as ConfigService<AppEnvironment, true>;
}

function applyRecord(): CoreApplyRecord {
  const now = new Date();
  return {
    id: 'd0d18d24-7eaf-49ff-9aef-9269021eeac5',
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
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}
