import {
  agentDesiredStateSchema,
  agentHeartbeatRequestSchema,
  agentRegisterRequestSchema,
  agentRegisterResponseSchema,
  agentStatsRequestSchema,
  agentApplyResultSchema,
  type AgentDesiredState,
  type AgentHeartbeatRequest,
  type AgentRegisterRequest,
  type AgentRegisterResponse,
  type AgentStatsRequest,
  type AgentApplyResult,
} from '@overvpn/shared/schemas';
import type { AgentEnvironment } from '../config.js';
import { joinPanelUrl, panelNodePath } from '../config.js';
import { redactLogData } from '../log-redact.js';

export type PanelClientLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export class PanelClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'PanelClientError';
  }
}

export class PanelClient {
  constructor(
    private readonly env: AgentEnvironment,
    private readonly resolveNodeId: () => string,
    private logger?: PanelClientLogger,
  ) {}

  setLogger(logger: PanelClientLogger): void {
    this.logger = logger;
  }

  async register(token: string, body: AgentRegisterRequest): Promise<AgentRegisterResponse> {
    const payload = agentRegisterRequestSchema.parse(body);
    const response = await this.request(panelNodePath(this.resolveNodeId(), 'register'), {
      method: 'POST',
      token,
      body: payload,
    });
    return agentRegisterResponseSchema.parse(response);
  }

  async heartbeat(token: string, body: AgentHeartbeatRequest): Promise<unknown> {
    const payload = agentHeartbeatRequestSchema.parse(body);
    return this.request(panelNodePath(this.resolveNodeId(), 'heartbeat'), {
      method: 'POST',
      token,
      body: payload,
    });
  }

  async pullDesired(token: string): Promise<AgentDesiredState | null> {
    const response = await this.request(panelNodePath(this.resolveNodeId(), 'desired'), {
      method: 'GET',
      token,
      allowNotFound: true,
    });
    if (response === null) {
      return null;
    }
    return agentDesiredStateSchema.parse(response);
  }

  async pushStats(token: string, body: AgentStatsRequest): Promise<unknown> {
    const payload = agentStatsRequestSchema.parse(body);
    return this.request(panelNodePath(this.resolveNodeId(), 'stats'), {
      method: 'POST',
      token,
      body: payload,
    });
  }

  async pushApplyResult(token: string, body: AgentApplyResult): Promise<unknown> {
    const payload = agentApplyResultSchema.parse(body);
    return this.request(panelNodePath(this.resolveNodeId(), 'apply-result'), {
      method: 'POST',
      token,
      body: payload,
    });
  }

  private async request(
    path: string,
    options: {
      method: 'GET' | 'POST';
      token: string;
      body?: unknown;
      allowNotFound?: boolean;
    },
  ): Promise<unknown> {
    const url = joinPanelUrl(this.env.PANEL_URL, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.env.PANEL_TIMEOUT_MS);
    timeout.unref();
    const startedAt = performance.now();
    this.logger?.info(
      {
        method: options.method,
        path,
        url,
        request: redactLogData(options.body ?? null),
      },
      'Panel request',
    );
    try {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${options.token}`,
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = { raw: text.slice(0, 2000) };
        }
      }
      const latencyMs = Math.round(performance.now() - startedAt);
      if (options.allowNotFound && response.status === 404) {
        this.logger?.info(
          {
            method: options.method,
            path,
            status: 404,
            latencyMs,
            response: null,
          },
          'Panel response (not found)',
        );
        return null;
      }
      if (!response.ok) {
        this.logger?.warn(
          {
            method: options.method,
            path,
            status: response.status,
            latencyMs,
            response: redactLogData(parsed),
          },
          'Panel request failed',
        );
        throw new PanelClientError(
          `Panel ${options.method} ${path} failed with HTTP ${response.status}`,
          response.status,
          parsed,
        );
      }
      this.logger?.info(
        {
          method: options.method,
          path,
          status: response.status,
          latencyMs,
          response: redactLogData(parsed),
        },
        'Panel response',
      );
      return parsed;
    } catch (error: unknown) {
      if (error instanceof PanelClientError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Panel request failed';
      this.logger?.warn(
        {
          method: options.method,
          path,
          latencyMs: Math.round(performance.now() - startedAt),
          error: message,
        },
        'Panel transport error',
      );
      throw new PanelClientError(message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
