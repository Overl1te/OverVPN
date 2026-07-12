import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import { SecretEncryptionService } from '../auth/auth-crypto';
import type { AppEnvironment } from '../config/environment';
import type { ProcessAdapter } from '../core/core-adapters';
import { CoreFileSystem, ReloadHandshakeAdapter } from '../core/core-adapters';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import {
  BackupFileSystem,
  BackupsService,
  parseDatabaseUrl,
} from './backups.service';
import { restoreBackupRequestSchema } from '@overvpn/shared/schemas';

const backupDir = join(tmpdir(), 'overvpn-backups-unit');

describe('BackupsService', () => {
  const actor = {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'owner',
    role: 'OWNER' as const,
    locale: 'en' as const,
    active: true,
    totpEnabled: true,
    lastLoginAt: null,
  };
  const metadata = {
    requestId: 'req-1',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };

  it('parseDatabaseUrl extracts connection fields without shell interpolation', () => {
    const parsed = parseDatabaseUrl(
      'postgresql://vpn%2Fuser:p%40ss@db.example:6543/overvpn?schema=public',
    );
    expect(parsed).toEqual({
      host: 'db.example',
      port: '6543',
      user: 'vpn/user',
      password: 'p@ss',
      database: 'overvpn',
    });
  });

  it('creates a DATABASE artifact with checksum and encrypted bytes', async () => {
    const files = memoryFiles();
    const processRun = jest.fn(
      (
        _exe: string,
        args: readonly string[],
      ): Promise<{
        exitCode: number;
        signal: null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }> => {
        const out = args[args.indexOf('-f') + 1];
        return files.writeFile(out, Buffer.from('PGDUMP')).then(() => ({
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
        }));
      },
    );
    const processAdapter = {
      run: processRun,
    } as unknown as ProcessAdapter;
    const encryption = new SecretEncryptionService(testConfig());
    const created: Record<string, unknown> = {
      id: '22222222-2222-4222-8222-222222222222',
      kind: 'DATABASE',
      status: 'RUNNING',
      storagePath: join(backupDir, 'test.bin'),
      sizeBytes: null,
      checksum: null,
      encrypted: true,
      meta: {},
      createdByAdminId: actor.id,
      startedAt: new Date(),
      completedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      backupArtifact: {
        findMany: () => Promise.resolve([]),
        create: ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(created, data);
          return Promise.resolve({ ...created });
        },
        update: ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(created, data);
          return Promise.resolve({ ...created });
        },
      },
      coreState: {
        findUnique: () =>
          Promise.resolve({
            appliedConfigHash: 'a'.repeat(64),
            appliedRevision: 3,
            desiredRevision: 3,
          }),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const auditRecord = jest.fn(() => Promise.resolve(undefined));
    const audit = {
      record: auditRecord,
      recordFailureSafely: () => Promise.resolve(undefined),
    } as unknown as AuditService;
    const service = new BackupsService(
      prisma,
      audit,
      encryption,
      processAdapter,
      files,
      new MemoryCoreFiles(),
      new MemoryReload(),
      testConfig(),
    );

    const result = await service.create({ kind: 'DATABASE' }, actor, metadata);

    expect(result.status).toBe('SUCCEEDED');
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toMatch(/^\d+$/);
    expect(result.encrypted).toBe(true);
    expect(processRun).toHaveBeenCalled();
    const processCalls = processRun.mock.calls as unknown as Array<
      [
        string,
        readonly string[],
        number,
        { env?: { PGPASSWORD?: string } } | undefined,
      ]
    >;
    const processArgs = processCalls[0];
    expect(processArgs?.[0]).toBe('pg_dump');
    expect(processArgs?.[1]).toEqual(
      expect.arrayContaining(['-Fc', '-U', 'overvpn']),
    );
    expect(processArgs?.[3]?.env?.PGPASSWORD).toBe('secret');
    expect(auditRecord).toHaveBeenCalled();
    const auditCalls = auditRecord.mock.calls as unknown as Array<
      [{ action: string }]
    >;
    expect(auditCalls[0]?.[0].action).toBe('BACKUP_CREATE');
  });

  it('rejects restore without confirm:true at the schema boundary', async () => {
    expect(
      restoreBackupRequestSchema.safeParse({ confirm: false }).success,
    ).toBe(false);
    expect(restoreBackupRequestSchema.safeParse({}).success).toBe(false);
    expect(
      restoreBackupRequestSchema.safeParse({ confirm: true }).success,
    ).toBe(true);

    const stubProcess = {
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
        }),
    } as unknown as ProcessAdapter;
    const service = new BackupsService(
      {
        backupArtifact: {
          findUnique: () => Promise.resolve(null),
        },
      } as unknown as PrismaService,
      {
        record: jest.fn(),
        recordFailureSafely: jest.fn(),
      } as unknown as AuditService,
      new SecretEncryptionService(testConfig()),
      stubProcess,
      memoryFiles(),
      new MemoryCoreFiles(),
      new MemoryReload(),
      testConfig(),
    );

    await expect(
      service.restore(
        '33333333-3333-4333-8333-333333333333',
        { confirm: true },
        actor,
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

function testConfig(): ConfigService<AppEnvironment, true> {
  const values: Record<string, unknown> = {
    BACKUP_DIR: backupDir,
    BACKUP_RETENTION_DAYS: 30,
    BACKUP_ENCRYPT: true,
    BACKUP_PROCESS_TIMEOUT_MS: 60_000,
    DATABASE_URL: 'postgresql://overvpn:secret@127.0.0.1:5432/overvpn',
    SING_BOX_CONFIG_PATH: join(tmpdir(), 'config.json'),
    SING_BOX_LAST_KNOWN_GOOD_PATH: join(tmpdir(), 'config.lkg.json'),
    SECRETS_MASTER_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };
  return {
    get: (key: string) => values[key],
  } as ConfigService<AppEnvironment, true>;
}

function memoryFiles(): BackupFileSystem {
  const store = new Map<string, Buffer>();
  const dirs = new Set<string>();
  let temp = 0;
  const files: BackupFileSystem = {
    ensureDir(path: string) {
      dirs.add(path);
      return Promise.resolve();
    },
    writeFile(path: string, data: Buffer | string) {
      store.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data));
      return Promise.resolve();
    },
    readFile(path: string) {
      const value = store.get(path);
      if (!value) {
        return Promise.reject(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
      }
      return Promise.resolve(value);
    },
    copyFile(source: string, destination: string) {
      const value = store.get(source);
      if (!value) {
        return Promise.reject(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
      }
      store.set(destination, value);
      return Promise.resolve();
    },
    remove(path: string) {
      store.delete(path);
      return Promise.resolve();
    },
    exists(path: string) {
      return Promise.resolve(store.has(path) || dirs.has(path));
    },
    size(path: string) {
      return Promise.resolve(BigInt(store.get(path)?.length ?? 0));
    },
    createTempDir() {
      temp += 1;
      const path = join(tmpdir(), `mem-${temp}`);
      dirs.add(path);
      return Promise.resolve(path);
    },
    removeDir(path: string) {
      dirs.delete(path);
      for (const key of [...store.keys()]) {
        if (key.startsWith(path)) {
          store.delete(key);
        }
      }
      return Promise.resolve();
    },
    openReadStream() {
      throw new Error('not used');
    },
  };
  return files;
}

class MemoryCoreFiles extends CoreFileSystem {
  private readonly store = new Map<string, Buffer>();

  read(path: string): Promise<Buffer> {
    const value = this.store.get(path);
    if (!value) {
      return Promise.reject(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );
    }
    return Promise.resolve(value);
  }

  atomicWrite(path: string, content: string | Buffer): Promise<void> {
    this.store.set(
      path,
      Buffer.isBuffer(content) ? content : Buffer.from(content),
    );
    return Promise.resolve();
  }

  replace(sourcePath: string, destinationPath: string): Promise<void> {
    const value = this.store.get(sourcePath);
    if (!value) {
      return Promise.reject(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );
    }
    this.store.set(destinationPath, value);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.store.delete(path);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.store.has(path));
  }
}

class MemoryReload extends ReloadHandshakeAdapter {
  requestReload(hash: string): Promise<{
    requestId: string;
    hash: string;
    acknowledgedAt: Date;
  }> {
    return Promise.resolve({
      requestId: 'ack',
      hash,
      acknowledgedAt: new Date(),
    });
  }
}
