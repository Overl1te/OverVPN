import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { CORE_ENGINES } from '@overvpn/shared/constants';
import {
  agentApplyRequestSchema,
  agentCoresCommandSchema,
  agentStatusResponseSchema,
  type AgentStatusResponse,
} from '@overvpn/shared/schemas';
import type { AgentEnvironment } from './config.js';
import { resolveAgentHostname, resolveAgentVersion } from './config.js';
import type { ApplyService } from './core/apply.js';
import { buildAgentLoggerOptions } from './logger.js';
import type { PanelLoop } from './panel/loop.js';

export type AgentApp = {
  app: FastifyInstance;
  apply: ApplyService;
  panelLoop: PanelLoop;
};

export async function buildServer(input: {
  env: AgentEnvironment;
  apply: ApplyService;
  panelLoop: PanelLoop;
}): Promise<AgentApp> {
  const app = Fastify({
    logger: buildAgentLoggerOptions({
      level: input.env.LOG_LEVEL,
      logDir: input.env.LOG_DIR,
      retentionDays: input.env.LOG_RETENTION_DAYS,
    }),
    trustProxy: true,
  });

  const requireNodeToken = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const expected = input.panelLoop.getNodeToken() ?? input.env.NODE_TOKEN;
    if (!expected) {
      return reply.code(503).send({
        error: 'NODE_TOKEN_UNAVAILABLE',
        message: 'Agent has not registered with the panel yet',
      });
    }
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Bearer NODE_TOKEN required',
      });
    }
    const token = header.slice('Bearer '.length).trim();
    if (token !== expected) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid NODE_TOKEN',
      });
    }
  };

  app.get('/health', async () => ({
    status: 'ok',
    service: 'overvpn-agent',
    version: resolveAgentVersion(input.env),
  }));

  app.get('/v1/status', { preHandler: requireNodeToken }, async () => {
    const engines = [];
    for (const engine of CORE_ENGINES) {
      engines.push({
        engine,
        running: await input.apply.probeEngineRunning(engine),
      });
    }
    const credentials = input.panelLoop.getCredentials();
    const body: AgentStatusResponse = agentStatusResponseSchema.parse({
      proxyServerId: credentials.proxyServerId,
      hostname: resolveAgentHostname(input.env),
      agentVersion: resolveAgentVersion(input.env),
      engines,
      appliedRevision: input.apply.getAppliedRevision(),
    });
    return body;
  });

  app.post('/v1/apply', { preHandler: requireNodeToken }, async (request, reply) => {
    const desired = agentApplyRequestSchema.parse(request.body);
    request.log.info(
      {
        revision: desired.revision,
        engines: desired.engines.map((engine) => ({
          engine: engine.engine,
          enabled: engine.enabled,
          configHash: engine.configHash ?? null,
        })),
      },
      'Apply request received',
    );
    const result = await input.apply.apply(desired);
    request.log.info(
      {
        revision: result.revision,
        success: result.success,
        configHash: result.configHash,
        errorMessage: result.errorMessage,
        engineResults: result.engineResults,
      },
      'Apply request finished',
    );
    return reply.code(result.success ? 200 : 500).send(result);
  });

  app.post('/v1/cores', { preHandler: requireNodeToken }, async (request) => {
    const command = agentCoresCommandSchema.parse(request.body);
    request.log.info({ command }, 'Cores command accepted');
    // Stub until gate-integrate wires enable/disable/update lifecycle.
    return {
      ok: true,
      action: command.action,
      engines: command.engines,
      message: 'cores command accepted (stub)',
    };
  });

  app.post('/v1/reload', { preHandler: requireNodeToken }, async (request, reply) => {
    request.log.info('Reload-all request received');
    const result = await input.apply.reloadAllKnown();
    request.log.info({ result }, 'Reload-all finished');
    return reply.code(result.success ? 200 : 500).send(result);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error && typeof error === 'object' && 'name' in error) {
      const name = (error as { name?: string }).name;
      if (name === 'ZodError') {
        return reply.code(400).send({
          error: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: error,
        });
      }
    }
    request.log.error({ err: error }, 'Unhandled agent error');
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    return reply.code(statusCode).send({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unexpected agent error',
    });
  });

  return {
    app,
    apply: input.apply,
    panelLoop: input.panelLoop,
  };
}
