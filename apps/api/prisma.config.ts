import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

const apiDirectory = dirname(fileURLToPath(import.meta.url));
loadEnvironment({
  path: [resolve(apiDirectory, '../../.env'), resolve(apiDirectory, '.env')],
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
