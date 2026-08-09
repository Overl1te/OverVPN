import { CORE_ENGINES, type CoreEngine } from '@overvpn/shared/constants';
import type { AgentApplyRequest } from '@overvpn/shared/schemas';
import type { AgentEnvironment } from '../config.js';
import { resolveAgentHostname, resolveAgentVersion, resolveStatePath } from '../config.js';
import type { ApplyService } from '../core/apply.js';
import { HostLoadSampler } from '../host-load-sampler.js';
import { PanelClient, PanelClientError } from './client.js';
import { loadAgentState, saveAgentState, type AgentState } from '../state.js';

export type RuntimeCredentials = {
  proxyServerId?: string;
  nodeToken?: string;
  heartbeatIntervalSec: number;
};

export class PanelLoop {
  private readonly panel: PanelClient;
  private readonly statePath: string;
  private readonly hostLoad: HostLoadSampler;
  private credentials: RuntimeCredentials;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastError: string | null = null;

  constructor(
    private readonly env: AgentEnvironment,
    private readonly apply: ApplyService,
    private logger: {
      info: (obj: unknown, msg?: string) => void;
      warn: (obj: unknown, msg?: string) => void;
      error: (obj: unknown, msg?: string) => void;
    },
  ) {
    this.panel = new PanelClient(
      env,
      () => {
        const id = this.credentials.proxyServerId ?? this.env.NODE_ID;
        if (!id) {
          throw new Error('NODE_ID is required for panel API calls');
        }
        return id;
      },
      this.logger,
    );
    this.statePath = resolveStatePath(env);
    this.hostLoad = new HostLoadSampler(env.HOST_PROC);
    this.credentials = {
      proxyServerId: env.NODE_ID,
      nodeToken: env.NODE_TOKEN,
      heartbeatIntervalSec: env.HEARTBEAT_INTERVAL_SEC,
    };
  }

  setLogger(logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  }): void {
    this.logger = logger;
    this.panel.setLogger(logger);
  }

  getCredentials(): RuntimeCredentials {
    return { ...this.credentials };
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getNodeToken(): string | undefined {
    return this.credentials.nodeToken;
  }

  async start(): Promise<void> {
    const persisted = await loadAgentState(this.statePath);
    this.mergeState(persisted);

    if (!this.credentials.nodeToken && this.env.INSTALL_TOKEN) {
      await this.registerWithInstallToken();
    }

    if (!this.credentials.nodeToken) {
      this.logger.warn(
        {},
        'No NODE_TOKEN available yet; local API auth will reject until register succeeds',
      );
    }

    this.running = true;
    await this.tick();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (!this.running) {
      return;
    }
    const delayMs = Math.max(5, this.credentials.heartbeatIntervalSec) * 1000;
    this.timer = setTimeout(() => {
      void this.tick()
        .catch((error: unknown) => {
          this.logger.warn({ err: error }, 'Panel loop tick failed');
        })
        .finally(() => this.schedule());
    }, delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (!this.credentials.nodeToken && this.env.INSTALL_TOKEN) {
      await this.registerWithInstallToken();
    }
    const token = this.credentials.nodeToken;
    if (!token) {
      return;
    }

    const engines = await this.collectEngineStatus();
    const load = this.hostLoad.sample();
    try {
      await this.panel.heartbeat(token, {
        status: this.lastError ? 'ERROR' : 'ONLINE',
        engines,
        load,
        errorMessage: this.lastError,
      });
      this.lastError = null;
      this.logger.info({ engines: engines.length, load }, 'Heartbeat sent');
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : 'Heartbeat failed';
      this.logger.warn({ err: error }, 'Heartbeat failed (will retry)');
      return;
    }

    if (!this.env.PULL_DESIRED_ENABLED) {
      return;
    }

    try {
      const desired = await this.panel.pullDesired(token);
      if (!desired) {
        return;
      }
      if (desired.revision <= this.apply.getAppliedRevision()) {
        return;
      }
      this.logger.info({ revision: desired.revision }, 'Pulling desired state from panel');
      const result = await this.apply.apply(desired as AgentApplyRequest);
      try {
        await this.panel.pushApplyResult(token, result);
      } catch (error: unknown) {
        this.logger.warn({ err: error }, 'Failed to push apply-result to panel');
      }
      if (!result.success) {
        this.lastError = result.errorMessage ?? 'Desired-state apply failed';
      }
    } catch (error: unknown) {
      if (error instanceof PanelClientError && error.status === 404) {
        return;
      }
      this.logger.warn({ err: error }, 'Desired-state pull failed');
    }
  }

  private async registerWithInstallToken(): Promise<void> {
    const installToken = this.env.INSTALL_TOKEN;
    if (!installToken) {
      return;
    }
    if (!this.env.AGENT_BASE_URL) {
      this.logger.warn({}, 'INSTALL_TOKEN set but AGENT_BASE_URL missing; skipping register');
      return;
    }
    try {
      const response = await this.panel.register(installToken, {
        hostname: resolveAgentHostname(this.env),
        agentBaseUrl: this.env.AGENT_BASE_URL,
        agentVersion: resolveAgentVersion(this.env),
        capabilities: {
          engines: [...CORE_ENGINES],
          os: process.platform,
          arch: process.arch,
        },
      });
      this.mergeState({
        proxyServerId: response.proxyServerId,
        nodeToken: response.nodeToken,
        heartbeatIntervalSec: response.heartbeatIntervalSec,
      });
      await saveAgentState(this.statePath, {
        proxyServerId: this.credentials.proxyServerId,
        nodeToken: this.credentials.nodeToken,
        heartbeatIntervalSec: this.credentials.heartbeatIntervalSec,
      });
      this.logger.info(
        { proxyServerId: response.proxyServerId, status: response.status },
        'Registered with panel',
      );
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : 'Register failed';
      this.logger.warn({ err: error }, 'Panel register failed (will retry)');
    }
  }

  private mergeState(state: AgentState): void {
    if (state.proxyServerId) {
      this.credentials.proxyServerId = state.proxyServerId;
    }
    if (state.nodeToken) {
      this.credentials.nodeToken = state.nodeToken;
    }
    if (state.heartbeatIntervalSec) {
      this.credentials.heartbeatIntervalSec = state.heartbeatIntervalSec;
    }
  }

  private async collectEngineStatus(): Promise<Array<{ engine: CoreEngine; running: boolean }>> {
    const result: Array<{ engine: CoreEngine; running: boolean }> = [];
    for (const engine of CORE_ENGINES) {
      result.push({
        engine,
        running: await this.apply.probeEngineRunning(engine),
      });
    }
    return result;
  }
}
