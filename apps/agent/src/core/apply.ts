import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { CoreEngine } from '@overvpn/shared/constants';
import type { AgentApplyRequest, AgentApplyResult } from '@overvpn/shared/schemas';
import type { AgentEnvironment, EnginePaths } from '../config.js';
import { enginePathsFor } from '../config.js';
import { AgentFileSystem, isNodeErrno } from './filesystem.js';
import { requestSharedVolumeReload } from './reload.js';

const ENGINE_LABELS: Record<CoreEngine, string> = {
  SING_BOX: 'sing-box',
  XRAY: 'Xray',
  MTPROXY: 'MTProxy',
};

export type ApplyServiceOptions = {
  env: AgentEnvironment;
  fileSystem?: AgentFileSystem;
};

export class ApplyService {
  private readonly env: AgentEnvironment;
  private readonly fileSystem: AgentFileSystem;
  private appliedRevision = 0;
  private lastConfigHashes = new Map<CoreEngine, string>();

  constructor(options: ApplyServiceOptions) {
    this.env = options.env;
    this.fileSystem = options.fileSystem ?? new AgentFileSystem();
  }

  getAppliedRevision(): number {
    return this.appliedRevision;
  }

  getLastConfigHash(engine: CoreEngine): string | undefined {
    return this.lastConfigHashes.get(engine);
  }

  async apply(desired: AgentApplyRequest): Promise<AgentApplyResult> {
    const engineResults: AgentApplyResult['engineResults'] = [];
    let overallSuccess = true;
    let firstError: string | null = null;
    let lastHash: string | null = null;

    for (const engineState of desired.engines) {
      if (!engineState.enabled) {
        engineResults.push({
          engine: engineState.engine,
          success: true,
          errorMessage: null,
        });
        continue;
      }
      try {
        const hash = await this.applyEngine(
          engineState.engine,
          engineState.config,
          engineState.configHash,
        );
        this.lastConfigHashes.set(engineState.engine, hash);
        lastHash = hash;
        engineResults.push({
          engine: engineState.engine,
          success: true,
          errorMessage: null,
        });
      } catch (error: unknown) {
        overallSuccess = false;
        const message = error instanceof Error ? error.message : 'Unknown apply error';
        firstError ??= message;
        engineResults.push({
          engine: engineState.engine,
          success: false,
          errorMessage: message,
        });
      }
    }

    if (overallSuccess) {
      this.appliedRevision = desired.revision;
    }

    return {
      revision: desired.revision,
      success: overallSuccess,
      configHash: lastHash,
      engineResults,
      errorMessage: firstError,
    };
  }

  async reloadAllKnown(): Promise<{
    success: boolean;
    engineResults: AgentApplyResult['engineResults'];
    errorMessage: string | null;
  }> {
    const engineResults: AgentApplyResult['engineResults'] = [];
    let overallSuccess = true;
    let firstError: string | null = null;

    for (const [engine, hash] of this.lastConfigHashes) {
      try {
        await this.reloadEngine(engine, hash);
        engineResults.push({
          engine,
          success: true,
          errorMessage: null,
        });
      } catch (error: unknown) {
        overallSuccess = false;
        const message = error instanceof Error ? error.message : 'Unknown reload error';
        firstError ??= message;
        engineResults.push({
          engine,
          success: false,
          errorMessage: message,
        });
      }
    }

    return { success: overallSuccess, engineResults, errorMessage: firstError };
  }

  async probeEngineRunning(engine: CoreEngine): Promise<boolean> {
    const paths = enginePathsFor(this.env, engine);
    try {
      const pidRaw = (await this.fileSystem.read(paths.pidPath)).toString('utf8').trim();
      const pid = Number(pidRaw);
      if (!Number.isInteger(pid) || pid <= 0) {
        return false;
      }
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async applyEngine(
    engine: CoreEngine,
    config: unknown,
    providedHash?: string,
  ): Promise<string> {
    const paths = enginePathsFor(this.env, engine);
    const { content, hash } = serializeConfig(config, providedHash);
    const previous = await this.readOptional(paths.configPath);
    const previousHash = previous ? sha256(previous) : null;
    const candidatePath = join(
      dirname(paths.configPath),
      `.${engine.toLowerCase()}.candidate.json`,
    );

    try {
      await this.fileSystem.atomicWrite(candidatePath, content);
      if (previous) {
        await this.fileSystem.atomicWrite(paths.lastKnownGoodPath, previous);
      }
      await this.fileSystem.replace(candidatePath, paths.configPath);
      await this.reloadEngine(engine, hash, paths);
      return hash;
    } catch (applyError: unknown) {
      if (previous !== null && previousHash) {
        try {
          await this.fileSystem.atomicWrite(paths.configPath, previous);
          await this.reloadEngine(engine, previousHash, paths);
        } catch {
          // Preserve original apply error; rollback best-effort.
        }
      }
      await this.fileSystem.remove(candidatePath).catch(() => undefined);
      throw applyError;
    }
  }

  private async reloadEngine(
    engine: CoreEngine,
    hash: string,
    paths: EnginePaths = enginePathsFor(this.env, engine),
  ): Promise<void> {
    if (this.env.SKIP_CORE_RELOAD) {
      return;
    }
    await requestSharedVolumeReload({
      label: ENGINE_LABELS[engine],
      hash,
      requestPath: paths.reloadRequestPath,
      acknowledgementPath: paths.reloadAckPath,
      timeoutMs: paths.reloadTimeoutMs,
      fileSystem: this.fileSystem,
    });
  }

  private async readOptional(path: string): Promise<string | null> {
    try {
      return (await this.fileSystem.read(path)).toString('utf8');
    } catch (error: unknown) {
      if (isNodeErrno(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}

function serializeConfig(
  config: unknown,
  providedHash?: string,
): { content: string; hash: string } {
  let content: string;
  if (typeof config === 'string') {
    content = config;
  } else {
    content = `${JSON.stringify(config, null, 2)}\n`;
  }
  const hash = providedHash ?? sha256(content);
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('configHash must be a 64-char lowercase hex sha256');
  }
  return { content, hash };
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
