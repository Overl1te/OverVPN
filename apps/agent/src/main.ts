import { config as loadDotenv } from 'dotenv';
import { loadEnvironment, parseListenTarget, resolveAgentVersion } from './config.js';
import { ApplyService } from './core/apply.js';
import { PanelLoop } from './panel/loop.js';
import { buildServer } from './server.js';

loadDotenv();

async function main(): Promise<void> {
  const env = loadEnvironment();
  const listen = parseListenTarget(env.AGENT_LISTEN);
  const apply = new ApplyService({ env });

  const bootstrapLogger = {
    info: (obj: unknown, msg?: string) => {
      console.info(msg ?? '', obj);
    },
    warn: (obj: unknown, msg?: string) => {
      console.warn(msg ?? '', obj);
    },
    error: (obj: unknown, msg?: string) => {
      console.error(msg ?? '', obj);
    },
  };

  const panelLoop = new PanelLoop(env, apply, bootstrapLogger);
  const { app } = await buildServer({ env, apply, panelLoop });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down agent');
    panelLoop.stop();
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: listen.host, port: listen.port });
  app.log.info(
    {
      listen: `${listen.host}:${listen.port}`,
      version: resolveAgentVersion(env),
      panelUrl: env.PANEL_URL,
      skipCoreReload: env.SKIP_CORE_RELOAD,
    },
    'OverVPN agent listening',
  );

  // Background register/heartbeat/desired pull — failures are logged, not fatal.
  void panelLoop.start().catch((error: unknown) => {
    app.log.warn({ err: error }, 'Panel loop failed to start');
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
