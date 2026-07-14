import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@overvpn/shared/constants',
        replacement: path.resolve(rootDir, '../../packages/shared/src/constants.ts'),
      },
      {
        find: '@overvpn/shared/schemas',
        replacement: path.resolve(rootDir, '../../packages/shared/src/schemas.ts'),
      },
      {
        find: '@overvpn/shared/support-integrity',
        replacement: path.resolve(rootDir, '../../packages/shared/src/support-integrity.ts'),
      },
      {
        find: '@overvpn/shared/support-seal',
        replacement: path.resolve(rootDir, '../../packages/shared/src/support-seal.ts'),
      },
      {
        find: '@overvpn/shared',
        replacement: path.resolve(rootDir, '../../packages/shared/src/index.ts'),
      },
      { find: '@', replacement: path.resolve(rootDir, 'src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
