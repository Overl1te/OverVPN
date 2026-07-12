import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BackupArtifactResult,
  BackupListQuery,
  BackupListResponse,
  CreateBackupRequest,
  RestoreBackupRequest,
} from '@overvpn/shared/schemas';
import { PRODUCT_NAME } from '@overvpn/shared/constants';
import { AuditService } from '../audit/audit.service';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import type { AppEnvironment } from '../config/environment';
import {
  CoreFileSystem,
  ProcessAdapter,
  ReloadHandshakeAdapter,
} from '../core/core-adapters';
import type { BackupArtifact, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';

export abstract class BackupFileSystem {
  abstract ensureDir(path: string): Promise<void>;
  abstract writeFile(path: string, data: Buffer | string): Promise<void>;
  abstract readFile(path: string): Promise<Buffer>;
  abstract copyFile(source: string, destination: string): Promise<void>;
  abstract remove(path: string): Promise<void>;
  abstract exists(path: string): Promise<boolean>;
  abstract size(path: string): Promise<bigint>;
  abstract createTempDir(prefix: string): Promise<string>;
  abstract removeDir(path: string): Promise<void>;
  abstract openReadStream(path: string): Readable;
}

@Injectable()
export class NodeBackupFileSystem extends BackupFileSystem {
  async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }

  writeFile(path: string, data: Buffer | string): Promise<void> {
    return writeFile(path, data, { mode: 0o600 });
  }

  readFile(path: string): Promise<Buffer> {
    return readFile(path);
  }

  copyFile(source: string, destination: string): Promise<void> {
    return copyFile(source, destination);
  }

  remove(path: string): Promise<void> {
    return unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'ENOENT'
      ) {
        return false;
      }
      throw error;
    }
  }

  async size(path: string): Promise<bigint> {
    return BigInt((await stat(path)).size);
  }

  createTempDir(prefix: string): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
  }

  removeDir(path: string): Promise<void> {
    return rm(path, { recursive: true, force: true });
  }

  openReadStream(path: string): Readable {
    return createReadStream(path);
  }
}

type ParsedDatabaseUrl = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private readonly backupDir: string;
  private readonly retentionDays: number;
  private readonly encrypt: boolean;
  private readonly processTimeoutMs: number;
  private readonly databaseUrl: string;
  private readonly configPath: string;
  private readonly lastKnownGoodPath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: SecretEncryptionService,
    private readonly processAdapter: ProcessAdapter,
    private readonly files: BackupFileSystem,
    private readonly coreFiles: CoreFileSystem,
    private readonly reload: ReloadHandshakeAdapter,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.backupDir = config.get('BACKUP_DIR', { infer: true });
    this.retentionDays = config.get('BACKUP_RETENTION_DAYS', { infer: true });
    this.encrypt = config.get('BACKUP_ENCRYPT', { infer: true });
    this.processTimeoutMs = config.get('BACKUP_PROCESS_TIMEOUT_MS', {
      infer: true,
    });
    this.databaseUrl = config.get('DATABASE_URL', { infer: true });
    this.configPath = config.get('SING_BOX_CONFIG_PATH', { infer: true });
    this.lastKnownGoodPath = config.get('SING_BOX_LAST_KNOWN_GOOD_PATH', {
      infer: true,
    });
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    }
  }

  async list(query: BackupListQuery): Promise<BackupListResponse> {
    const where: Prisma.BackupArtifactWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status
        ? { status: query.status }
        : { status: { not: 'DELETED' } }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.backupArtifact.count({ where }),
      this.prisma.backupArtifact.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toResult(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async get(id: string): Promise<BackupArtifactResult> {
    return this.toResult(await this.requireArtifact(id));
  }

  async create(
    input: CreateBackupRequest,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<BackupArtifactResult> {
    await this.pruneExpiredBestEffort();
    const startedAt = new Date();
    const id = randomUUID();
    const filename = `${startedAt.toISOString().replace(/[:.]/g, '-')}_${input.kind.toLowerCase()}_${id.slice(0, 8)}.${this.encrypt ? 'ovb' : 'bin'}`;
    const storagePath = join(this.backupDir, filename);
    const expiresAt = new Date(
      startedAt.getTime() + this.retentionDays * 86_400_000,
    );
    const pending = await this.prisma.backupArtifact.create({
      data: {
        id,
        kind: input.kind,
        status: 'RUNNING',
        storagePath,
        encrypted: this.encrypt,
        createdByAdminId: actor.id,
        startedAt,
        expiresAt,
        meta: {},
      },
    });

    let workDir: string | null = null;
    try {
      workDir = await this.files.createTempDir('overvpn-backup-');
      const plaintextPath = join(workDir, 'artifact.bin');
      const meta = await this.buildArtifact(input.kind, workDir, plaintextPath);
      const finalBytes = this.encrypt
        ? this.encryption.encryptBytes(await this.files.readFile(plaintextPath))
        : await this.files.readFile(plaintextPath);
      await this.files.writeFile(storagePath, finalBytes);
      const checksum = createHash('sha256').update(finalBytes).digest('hex');
      const sizeBytes = BigInt(finalBytes.length);
      const completedAt = new Date();
      const succeeded = await this.prisma.backupArtifact.update({
        where: { id: pending.id },
        data: {
          status: 'SUCCEEDED',
          sizeBytes,
          checksum,
          completedAt,
          meta: meta as Prisma.InputJsonValue,
          errorMessage: null,
        },
      });
      await this.audit.record({
        actorAdminId: actor.id,
        action: 'BACKUP_CREATE',
        resourceType: 'backup_artifact',
        resourceId: succeeded.id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        after: {
          kind: succeeded.kind,
          checksum,
          sizeBytes: sizeBytes.toString(),
          encrypted: succeeded.encrypted,
        },
      });
      return this.toResult(succeeded);
    } catch (error: unknown) {
      const message = sanitizeError(error);
      const failed = await this.prisma.backupArtifact.update({
        where: { id: pending.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: message,
        },
      });
      await this.files.remove(storagePath).catch(() => undefined);
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'BACKUP_CREATE',
        resourceType: 'backup_artifact',
        resourceId: failed.id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: { message },
      });
      return this.toResult(failed);
    } finally {
      if (workDir) {
        await this.files.removeDir(workDir).catch(() => undefined);
      }
    }
  }

  async download(
    id: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<{ stream: Readable; filename: string; sizeBytes: bigint }> {
    const artifact = await this.requireArtifact(id);
    if (artifact.status === 'DELETED' || artifact.status === 'PENDING') {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'backup_not_downloadable',
        status: artifact.status,
      });
    }
    if (!(await this.files.exists(artifact.storagePath))) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
        reason: 'backup_file_missing',
      });
    }
    await this.audit.record({
      actorAdminId: actor.id,
      action: 'BACKUP_CREATE',
      resourceType: 'backup_artifact',
      resourceId: artifact.id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      metadata: { operation: 'download' },
    });
    return {
      stream: this.files.openReadStream(artifact.storagePath),
      filename: basename(artifact.storagePath),
      sizeBytes:
        artifact.sizeBytes ?? (await this.files.size(artifact.storagePath)),
    };
  }

  async restore(
    id: string,
    input: RestoreBackupRequest,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<BackupArtifactResult> {
    if (input.confirm !== true) {
      throw new ApiException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
        reason: 'confirm_required',
      });
    }
    const artifact = await this.requireArtifact(id);
    if (
      artifact.status === 'DELETED' ||
      artifact.status === 'PENDING' ||
      artifact.status === 'RUNNING'
    ) {
      throw new ApiException('CONFLICT', HttpStatus.CONFLICT, {
        reason: 'backup_not_restorable',
        status: artifact.status,
      });
    }
    if (!(await this.files.exists(artifact.storagePath))) {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND, {
        reason: 'backup_file_missing',
      });
    }

    const previousStatus = artifact.status;
    await this.prisma.backupArtifact.update({
      where: { id: artifact.id },
      data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null },
    });

    let workDir: string | null = null;
    try {
      workDir = await this.files.createTempDir('overvpn-restore-');
      const stored = await this.files.readFile(artifact.storagePath);
      const plaintext = artifact.encrypted
        ? this.encryption.decryptBytes(stored)
        : stored;
      const plaintextPath = join(workDir, 'artifact.bin');
      await this.files.writeFile(plaintextPath, plaintext);

      if (artifact.kind === 'DATABASE') {
        await this.restoreDatabase(plaintextPath);
      } else if (artifact.kind === 'CORE_CONFIG') {
        await this.restoreCoreConfigArchive(plaintextPath, workDir);
      } else {
        const extractDir = join(workDir, 'full');
        await this.files.ensureDir(extractDir);
        await this.extractTar(plaintextPath, extractDir);
        const dumpPath = join(extractDir, 'database.dump');
        if (!(await this.files.exists(dumpPath))) {
          throw new Error('FULL backup is missing database.dump');
        }
        await this.restoreDatabase(dumpPath);
        await this.restoreCoreFilesFromDir(extractDir);
      }

      const succeeded = await this.prisma.backupArtifact.update({
        where: { id: artifact.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      await this.audit.record({
        actorAdminId: actor.id,
        action: 'BACKUP_RESTORE',
        resourceType: 'backup_artifact',
        resourceId: succeeded.id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        after: {
          kind: succeeded.kind,
          note: input.note ?? null,
        },
        metadata: {
          downtimeRisk:
            artifact.kind === 'DATABASE' || artifact.kind === 'FULL'
              ? 'Database restore replaces live data and briefly interrupts the control plane.'
              : 'Core config restore reloads sing-box via the shared-volume handshake.',
        },
      });
      return this.toResult(succeeded);
    } catch (error: unknown) {
      const message = sanitizeError(error);
      const failed = await this.prisma.backupArtifact.update({
        where: { id: artifact.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: message,
        },
      });
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'BACKUP_RESTORE',
        resourceType: 'backup_artifact',
        resourceId: failed.id,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: {
          message,
          note: input.note ?? null,
          previousStatus,
        },
      });
      return this.toResult(failed);
    } finally {
      if (workDir) {
        await this.files.removeDir(workDir).catch(() => undefined);
      }
    }
  }

  async softDelete(
    id: string,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<BackupArtifactResult> {
    const artifact = await this.requireArtifact(id);
    if (artifact.status === 'DELETED') {
      return this.toResult(artifact);
    }
    await this.files.remove(artifact.storagePath).catch(() => undefined);
    const deleted = await this.prisma.backupArtifact.update({
      where: { id: artifact.id },
      data: {
        status: 'DELETED',
        completedAt: new Date(),
        errorMessage: null,
      },
    });
    await this.audit.record({
      actorAdminId: actor.id,
      action: 'BACKUP_CREATE',
      resourceType: 'backup_artifact',
      resourceId: deleted.id,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
      metadata: { operation: 'delete' },
    });
    return this.toResult(deleted);
  }

  private async buildArtifact(
    kind: CreateBackupRequest['kind'],
    workDir: string,
    plaintextPath: string,
  ): Promise<Record<string, unknown>> {
    const coreState = await this.prisma.coreState.findUnique({
      where: { id: 'sing-box' },
    });
    const meta: Record<string, unknown> = {
      product: PRODUCT_NAME,
      kind,
      createdAt: new Date().toISOString(),
      appliedConfigHash: coreState?.appliedConfigHash ?? null,
      appliedRevision: coreState?.appliedRevision ?? null,
      desiredRevision: coreState?.desiredRevision ?? null,
      apiVersion: '0.1.0',
    };

    if (kind === 'DATABASE') {
      await this.dumpDatabase(plaintextPath);
      meta.format = 'pg_custom';
      return meta;
    }

    if (kind === 'CORE_CONFIG') {
      const staging = join(workDir, 'core');
      await this.files.ensureDir(staging);
      await this.stageCoreFiles(staging);
      await this.files.writeFile(
        join(staging, 'metadata.json'),
        JSON.stringify(meta, null, 2),
      );
      await this.createTar(staging, plaintextPath);
      meta.format = 'tar';
      return meta;
    }

    const staging = join(workDir, 'full');
    await this.files.ensureDir(staging);
    await this.dumpDatabase(join(staging, 'database.dump'));
    await this.stageCoreFiles(staging);
    await this.files.writeFile(
      join(staging, 'metadata.json'),
      JSON.stringify(meta, null, 2),
    );
    await this.createTar(staging, plaintextPath);
    meta.format = 'tar+pg_custom';
    return meta;
  }

  private async stageCoreFiles(staging: string): Promise<void> {
    if (await this.coreFiles.exists(this.configPath)) {
      await this.files.writeFile(
        join(staging, 'config.json'),
        await this.coreFiles.read(this.configPath),
      );
    }
    if (await this.coreFiles.exists(this.lastKnownGoodPath)) {
      await this.files.writeFile(
        join(staging, 'config.last-known-good.json'),
        await this.coreFiles.read(this.lastKnownGoodPath),
      );
    }
  }

  private async dumpDatabase(destination: string): Promise<void> {
    const db = parseDatabaseUrl(this.databaseUrl);
    const result = await this.processAdapter.run(
      'pg_dump',
      [
        '-h',
        db.host,
        '-p',
        db.port,
        '-U',
        db.user,
        '-d',
        db.database,
        '-Fc',
        '--no-owner',
        '--no-acl',
        '-f',
        destination,
      ],
      this.processTimeoutMs,
      {
        env: {
          ...process.env,
          PGPASSWORD: db.password,
          PGSSLMODE: 'prefer',
        },
      },
    );
    if (result.timedOut || result.exitCode !== 0) {
      throw new Error(
        `pg_dump failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderr || result.stdout}`,
      );
    }
  }

  private async restoreDatabase(dumpPath: string): Promise<void> {
    const db = parseDatabaseUrl(this.databaseUrl);
    const result = await this.processAdapter.run(
      'pg_restore',
      [
        '-h',
        db.host,
        '-p',
        db.port,
        '-U',
        db.user,
        '-d',
        db.database,
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        dumpPath,
      ],
      this.processTimeoutMs,
      {
        env: {
          ...process.env,
          PGPASSWORD: db.password,
          PGSSLMODE: 'prefer',
        },
      },
    );
    // pg_restore may return 1 for non-fatal warnings; treat only hard failures as errors.
    if (result.timedOut || (result.exitCode !== 0 && result.exitCode !== 1)) {
      throw new Error(
        `pg_restore failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderr || result.stdout}`,
      );
    }
    if (result.exitCode === 1) {
      this.logger.warn(
        `pg_restore completed with warnings: ${result.stderr.slice(0, 500)}`,
      );
    }
  }

  private async restoreCoreConfigArchive(
    archivePath: string,
    workDir: string,
  ): Promise<void> {
    const extractDir = join(workDir, 'core');
    await this.files.ensureDir(extractDir);
    await this.extractTar(archivePath, extractDir);
    await this.restoreCoreFilesFromDir(extractDir);
  }

  private async restoreCoreFilesFromDir(directory: string): Promise<void> {
    const configPath = join(directory, 'config.json');
    const lkgPath = join(directory, 'config.last-known-good.json');
    const metadataPath = join(directory, 'metadata.json');
    if (!(await this.files.exists(configPath))) {
      throw new Error('Backup is missing config.json');
    }
    const configBytes = await this.files.readFile(configPath);
    await this.coreFiles.atomicWrite(this.configPath, configBytes);
    if (await this.files.exists(lkgPath)) {
      await this.coreFiles.atomicWrite(
        this.lastKnownGoodPath,
        await this.files.readFile(lkgPath),
      );
    } else {
      await this.coreFiles.atomicWrite(this.lastKnownGoodPath, configBytes);
    }

    let hash = createHash('sha256').update(configBytes).digest('hex');
    if (await this.files.exists(metadataPath)) {
      try {
        const meta = JSON.parse(
          (await this.files.readFile(metadataPath)).toString('utf8'),
        ) as { appliedConfigHash?: string | null };
        if (
          typeof meta.appliedConfigHash === 'string' &&
          /^[a-f0-9]{64}$/i.test(meta.appliedConfigHash)
        ) {
          hash = meta.appliedConfigHash.toLowerCase();
        }
      } catch {
        // fall back to content hash
      }
    }
    await this.reload.requestReload(hash);
  }

  private async createTar(
    sourceDir: string,
    destination: string,
  ): Promise<void> {
    const entries = await readdir(sourceDir);
    if (entries.length === 0) {
      throw new Error('Nothing to archive for core config backup');
    }
    const result = await this.processAdapter.run(
      'tar',
      ['-czf', destination, '-C', sourceDir, ...entries],
      this.processTimeoutMs,
    );
    if (result.timedOut || result.exitCode !== 0) {
      throw new Error(
        `tar create failed (exit=${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    }
  }

  private async extractTar(
    archivePath: string,
    destination: string,
  ): Promise<void> {
    const result = await this.processAdapter.run(
      'tar',
      ['-xzf', archivePath, '-C', destination],
      this.processTimeoutMs,
    );
    if (result.timedOut || result.exitCode !== 0) {
      throw new Error(
        `tar extract failed (exit=${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    }
  }

  private async pruneExpiredBestEffort(): Promise<void> {
    try {
      const expired = await this.prisma.backupArtifact.findMany({
        where: {
          status: { in: ['SUCCEEDED', 'FAILED'] },
          expiresAt: { lt: new Date() },
        },
        take: 50,
      });
      for (const row of expired) {
        await this.files.remove(row.storagePath).catch(() => undefined);
        await this.prisma.backupArtifact.update({
          where: { id: row.id },
          data: { status: 'DELETED' },
        });
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Backup prune skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async requireArtifact(id: string): Promise<BackupArtifact> {
    const artifact = await this.prisma.backupArtifact.findUnique({
      where: { id },
    });
    if (!artifact || artifact.status === 'DELETED') {
      throw new ApiException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return artifact;
  }

  private toResult(row: BackupArtifact): BackupArtifactResult {
    const meta: Record<string, unknown> =
      row.meta !== null &&
      typeof row.meta === 'object' &&
      !Array.isArray(row.meta)
        ? Object.fromEntries(Object.entries(row.meta))
        : {};
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      sizeBytes: row.sizeBytes?.toString() ?? null,
      checksum: row.checksum,
      encrypted: row.encrypted,
      meta,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }
}

export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres scheme');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split(
    '/',
  )[0];
  if (!database) {
    throw new Error('DATABASE_URL is missing a database name');
  }
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/password=[^&\s]+/gi, 'password=[REDACTED]')
    .replace(/PGPASSWORD=\S+/gi, 'PGPASSWORD=[REDACTED]')
    .slice(0, 2000);
}
