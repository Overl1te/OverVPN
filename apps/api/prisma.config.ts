import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'prisma/config';

const apiDirectory = dirname(fileURLToPath(import.meta.url));
loadEnvironment({
  path: [resolve(apiDirectory, '../../.env'), resolve(apiDirectory, '.env')],
  quiet: true,
});

// prisma generate / unit tests need a URL even when .env is absent (CI sets DATABASE_URL).
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://overvpn:generate-only@127.0.0.1:5432/overvpn?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
