import { randomUUID } from 'node:crypto';
import { constants as fsConstants, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export class AgentFileSystem {
  read(path: string): Promise<Buffer> {
    return readFile(path);
  }

  async atomicWrite(path: string, content: string | Buffer): Promise<void> {
    const directory = dirname(path);
    const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
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

  private async renameReplacing(sourcePath: string, destinationPath: string): Promise<void> {
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

export function isNodeErrno(error: unknown): error is NodeJS.ErrnoException {
  return isNodeError(error);
}
