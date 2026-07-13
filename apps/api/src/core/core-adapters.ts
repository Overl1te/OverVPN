import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import {
  constants as fsConstants,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';

export interface ProcessExecutionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessRunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdoutPath?: string;
  stdin?: string | Buffer;
}

export abstract class ProcessAdapter {
  abstract run(
    executable: string,
    args: readonly string[],
    timeoutMs: number,
    options?: ProcessRunOptions,
  ): Promise<ProcessExecutionResult>;
}

@Injectable()
export class NodeProcessAdapter extends ProcessAdapter {
  run(
    executable: string,
    args: readonly string[],
    timeoutMs: number,
    options: ProcessRunOptions = {},
  ): Promise<ProcessExecutionResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {
        shell: false,
        windowsHide: true,
        cwd: options.cwd,
        env: options.env,
        stdio: [
          options.stdin === undefined ? 'ignore' : 'pipe',
          'pipe',
          'pipe',
        ],
      });
      const outputLimit = 64 * 1024;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let stdoutBytes = 0;
      let stdoutFile: WriteStream | undefined;
      const append = (current: string, chunk: Buffer): string => {
        if (current.length >= outputLimit) {
          return current;
        }
        return `${current}${chunk.toString('utf8')}`.slice(0, outputLimit);
      };
      if (options.stdoutPath) {
        stdoutFile = createWriteStream(options.stdoutPath, {
          flags: 'w',
          mode: 0o600,
        });
        child.stdout!.pipe(stdoutFile);
      } else {
        child.stdout!.on('data', (chunk: Buffer) => {
          stdout = append(stdout, chunk);
          stdoutBytes += chunk.length;
        });
      }
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      if (options.stdin !== undefined && child.stdin) {
        child.stdin.end(options.stdin);
      }
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      timeout.unref();

      const settle = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      child.once('error', (error) => {
        clearTimeout(timeout);
        stdoutFile?.destroy();
        settle(() => reject(error));
      });
      child.once('close', (exitCode, signal) => {
        clearTimeout(timeout);
        if (stdoutFile) {
          stdoutFile.end(() => {
            settle(() =>
              resolve({
                exitCode,
                signal,
                stdout: stdoutBytes > 0 ? `[${stdoutBytes} bytes]` : '',
                stderr,
                timedOut,
              }),
            );
          });
          return;
        }
        settle(() => resolve({ exitCode, signal, stdout, stderr, timedOut }));
      });
    });
  }
}

export abstract class CoreFileSystem {
  abstract read(path: string): Promise<Buffer>;
  abstract atomicWrite(path: string, content: string | Buffer): Promise<void>;
  abstract replace(sourcePath: string, destinationPath: string): Promise<void>;
  abstract remove(path: string): Promise<void>;
  abstract exists(path: string): Promise<boolean>;
}

@Injectable()
export class NodeCoreFileSystem extends CoreFileSystem {
  read(path: string): Promise<Buffer> {
    return readFile(path);
  }

  async atomicWrite(path: string, content: string | Buffer): Promise<void> {
    const directory = dirname(path);
    const temporaryPath = join(
      directory,
      `.${basename(path)}.${randomUUID()}.tmp`,
    );
    const handle = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(content);
      try {
        await handle.sync();
      } catch (error: unknown) {
        if (!isWindowsFsyncPermissionError(error)) {
          throw error;
        }
      }
    } finally {
      await handle.close();
    }
    try {
      await this.renameReplacing(temporaryPath, path);
      await this.syncDirectory(directory);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async replace(sourcePath: string, destinationPath: string): Promise<void> {
    await this.renameReplacing(sourcePath, destinationPath);
    await this.syncDirectory(dirname(destinationPath));
  }

  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      const handle = await open(path, fsConstants.O_RDONLY);
      await handle.close();
      return true;
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private async renameReplacing(
    sourcePath: string,
    destinationPath: string,
  ): Promise<void> {
    try {
      await rename(sourcePath, destinationPath);
    } catch (error: unknown) {
      if (
        process.platform === 'win32' &&
        isNodeError(error) &&
        error.code !== undefined &&
        ['EEXIST', 'EPERM'].includes(error.code)
      ) {
        await rm(destinationPath, { force: true });
        await rename(sourcePath, destinationPath);
        return;
      }
      throw error;
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    try {
      const handle = await open(path, fsConstants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (isWindowsFsyncPermissionError(error)) {
        return;
      }
      if (
        isNodeError(error) &&
        error.code !== undefined &&
        ['EINVAL', 'EISDIR', 'EPERM', 'EBADF'].includes(error.code)
      ) {
        return;
      }
      throw error;
    }
  }
}

export interface HttpJsonResponse {
  status: number;
  body: unknown;
  latencyMs: number;
}

export abstract class CoreHttpAdapter {
  abstract getJson(
    url: string,
    headers: Readonly<Record<string, string>>,
    timeoutMs: number,
  ): Promise<HttpJsonResponse>;
}

@Injectable()
export class FetchCoreHttpAdapter extends CoreHttpAdapter {
  async getJson(
    url: string,
    headers: Readonly<Record<string, string>>,
    timeoutMs: number,
  ): Promise<HttpJsonResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref();
    const startedAt = performance.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = { invalidJson: true };
        }
      }
      return {
        status: response.status,
        body,
        latencyMs: performance.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface ReloadAcknowledgement {
  requestId: string;
  hash: string;
  acknowledgedAt: Date;
}

export abstract class ReloadHandshakeAdapter {
  abstract requestReload(hash: string): Promise<ReloadAcknowledgement>;
}

@Injectable()
export class SharedVolumeReloadHandshakeAdapter extends ReloadHandshakeAdapter {
  private readonly requestPath: string;
  private readonly acknowledgementPath: string;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly fileSystem: CoreFileSystem,
  ) {
    super();
    this.requestPath = config.get('SING_BOX_RELOAD_REQUEST_PATH', {
      infer: true,
    });
    this.acknowledgementPath = config.get('SING_BOX_RELOAD_ACK_PATH', {
      infer: true,
    });
    this.timeoutMs = config.get('SING_BOX_RELOAD_TIMEOUT_MS', { infer: true });
  }

  async requestReload(hash: string): Promise<ReloadAcknowledgement> {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error('Reload request hash is invalid');
    }
    const requestId = randomUUID();
    await this.fileSystem.atomicWrite(
      this.requestPath,
      `id=${requestId}\nhash=${hash}\n`,
    );
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      try {
        const acknowledgement = parseKeyValueFile(
          (await this.fileSystem.read(this.acknowledgementPath)).toString(
            'utf8',
          ),
        );
        if (acknowledgement.id !== requestId) {
          await delay(100);
          continue;
        }
        if (acknowledgement.hash !== hash) {
          throw new Error('Reload acknowledgement hash did not match request');
        }
        if (acknowledgement.status !== 'ok') {
          throw new Error(
            `sing-box reload sidecar rejected request: ${
              acknowledgement.message ?? 'unknown error'
            }`,
          );
        }
        return {
          requestId,
          hash,
          acknowledgedAt: new Date(),
        };
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          if (
            error instanceof Error &&
            error.message.startsWith('sing-box reload sidecar')
          ) {
            throw error;
          }
        }
      }
      await delay(100);
    }
    throw new Error(
      `Timed out after ${this.timeoutMs}ms waiting for sing-box reload acknowledgement`,
    );
  }
}

export abstract class XrayReloadHandshakeAdapter {
  abstract requestReload(hash: string): Promise<ReloadAcknowledgement>;
}

@Injectable()
export class SharedVolumeXrayReloadHandshakeAdapter extends XrayReloadHandshakeAdapter {
  private readonly requestPath: string;
  private readonly acknowledgementPath: string;
  private readonly timeoutMs: number;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly fileSystem: CoreFileSystem,
  ) {
    super();
    this.requestPath = config.get('XRAY_RELOAD_REQUEST_PATH', {
      infer: true,
    });
    this.acknowledgementPath = config.get('XRAY_RELOAD_ACK_PATH', {
      infer: true,
    });
    this.timeoutMs = config.get('XRAY_RELOAD_TIMEOUT_MS', { infer: true });
  }

  async requestReload(hash: string): Promise<ReloadAcknowledgement> {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error('Xray reload request hash is invalid');
    }
    const requestId = randomUUID();
    await this.fileSystem.atomicWrite(
      this.requestPath,
      `id=${requestId}\nhash=${hash}\n`,
    );
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      try {
        const acknowledgement = parseKeyValueFile(
          (await this.fileSystem.read(this.acknowledgementPath)).toString(
            'utf8',
          ),
        );
        if (acknowledgement.id !== requestId) {
          await delay(100);
          continue;
        }
        if (acknowledgement.hash !== hash) {
          throw new Error('Xray reload acknowledgement hash did not match request');
        }
        if (acknowledgement.status !== 'ok') {
          throw new Error(
            `Xray reload sidecar rejected request: ${
              acknowledgement.message ?? 'unknown error'
            }`,
          );
        }
        return {
          requestId,
          hash,
          acknowledgedAt: new Date(),
        };
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          if (
            error instanceof Error &&
            error.message.startsWith('Xray reload sidecar')
          ) {
            throw error;
          }
        }
      }
      await delay(100);
    }
    throw new Error(
      `Timed out after ${this.timeoutMs}ms waiting for Xray reload acknowledgement`,
    );
  }
}

function parseKeyValueFile(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        return separator < 1
          ? [line, '']
          : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function isWindowsFsyncPermissionError(error: unknown): boolean {
  const candidate =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : null;
  return (
    process.platform === 'win32' &&
    candidate !== null &&
    (candidate.code === 'EPERM' ||
      (typeof candidate.message === 'string' &&
        candidate.message.includes('EPERM') &&
        candidate.message.includes('fsync')))
  );
}
