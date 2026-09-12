import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/test/**/*.test.ts', 'apps/server/src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@storytime/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
});
