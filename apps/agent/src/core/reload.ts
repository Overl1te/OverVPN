import { randomUUID } from 'node:crypto';
import type { AgentFileSystem } from './filesystem.js';
import { isNodeErrno } from './filesystem.js';

export type ReloadAcknowledgement = {
  requestId: string;
  hash: string;
  acknowledgedAt: Date;
};

export async function requestSharedVolumeReload(input: {
  label: string;
  hash: string;
  requestPath: string;
  acknowledgementPath: string;
  timeoutMs: number;
  fileSystem: AgentFileSystem;
}): Promise<ReloadAcknowledgement> {
  if (!/^[a-f0-9]{64}$/.test(input.hash)) {
    throw new Error(`${input.label} reload request hash is invalid`);
  }
  const requestId = randomUUID();
  await input.fileSystem.atomicWrite(input.requestPath, `id=${requestId}\nhash=${input.hash}\n`);
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const acknowledgement = parseKeyValueFile(
        (await input.fileSystem.read(input.acknowledgementPath)).toString('utf8'),
      );
      if (acknowledgement.id !== requestId) {
        await delay(100);
        continue;
      }
      if (acknowledgement.hash !== input.hash) {
        throw new Error(`${input.label} reload acknowledgement hash did not match request`);
      }
      if (acknowledgement.status !== 'ok') {
        throw new Error(
          `${input.label} reload sidecar rejected request: ${
            acknowledgement.message ?? 'unknown error'
          }`,
        );
      }
      return {
        requestId,
        hash: input.hash,
        acknowledgedAt: new Date(),
      };
    } catch (error: unknown) {
      if (!isNodeErrno(error) || error.code !== 'ENOENT') {
        if (error instanceof Error && error.message.startsWith(`${input.label} reload`)) {
          throw error;
        }
      }
    }
    await delay(100);
  }
  throw new Error(
    `Timed out after ${input.timeoutMs}ms waiting for ${input.label} reload acknowledgement`,
  );
}

function parseKeyValueFile(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        return separator < 1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
