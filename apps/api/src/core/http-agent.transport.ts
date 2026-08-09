import { Injectable, Logger } from '@nestjs/common';
import type {
  AgentApplyRequest,
  AgentApplyResult,
} from '@overvpn/shared/schemas';
import { agentApplyResultSchema } from '@overvpn/shared/schemas';

export interface HttpAgentApplyOutcome {
  ok: boolean;
  status: number;
  result: AgentApplyResult | null;
  error: string | null;
}

@Injectable()
export class HttpAgentTransport {
  private readonly logger = new Logger(HttpAgentTransport.name);

  async postApply(options: {
    agentBaseUrl: string;
    nodeToken: string;
    body: AgentApplyRequest;
    timeoutMs?: number;
  }): Promise<HttpAgentApplyOutcome> {
    const base = options.agentBaseUrl.replace(/\/+$/, '');
    const url = `${base}/v1/apply`;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref();
    const startedAt = performance.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.nodeToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options.body),
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = null;
        }
      }
      const resultParse = agentApplyResultSchema.safeParse(parsed);
      const result = resultParse.success ? resultParse.data : null;
      const ok = response.ok && (result?.success ?? true);
      if (!ok) {
        this.logger.warn(
          `Agent apply failed at ${url}: status=${String(response.status)} latencyMs=${String(
            Math.round(performance.now() - startedAt),
          )}`,
        );
      }
      return {
        ok,
        status: response.status,
        result,
        error: ok
          ? null
          : (result?.errorMessage ??
            `Agent apply HTTP ${String(response.status)}`),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Agent apply transport error at ${url}: ${message}`);
      return {
        ok: false,
        status: 0,
        result: null,
        error: message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
