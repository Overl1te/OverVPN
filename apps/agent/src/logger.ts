import { join } from 'node:path';
import type { LoggerOptions } from 'pino';

export function buildAgentLoggerOptions(input: {
  level: string;
  logDir?: string;
  retentionDays: number;
}): LoggerOptions {
  if (!input.logDir) {
    return { level: input.level };
  }

  return {
    level: input.level,
    transport: {
      targets: [
        {
          target: 'pino/file',
          options: { destination: 1 },
        },
        {
          target: 'pino-roll',
          options: {
            file: join(input.logDir, 'agent'),
            frequency: 'daily',
            mkdir: true,
            dateFormat: 'yyyy-MM-dd',
            extension: '.log',
            limit: {
              count: Math.max(1, input.retentionDays - 1),
              removeOtherLogFiles: true,
            },
          },
        },
      ],
    },
  };
}
