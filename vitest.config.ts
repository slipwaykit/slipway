import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against TypeScript source, so `pnpm test` needs no prior build.
    alias: {
      '@slipwaykit/core': source('./packages/core/src/index.ts'),
      '@slipwaykit/adapter-mock': source('./packages/adapters/mock/src/index.ts'),
      '@slipwaykit/adapter-sep24': source('./packages/adapters/sep24/src/index.ts'),
    },
  },
  test: {
    // Rule 7: tests pass offline with no credentials. Any adapter that reaches
    // the network during a test is a bug, not a flake.
    environment: 'node',
    setupFiles: ['./test/no-network.setup.ts'],
    include: ['packages/**/test/**/*.test.ts', 'backend/test/**/*.test.ts', 'frontend/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**/*.ts', 'backend/src/**/*.ts'],
    },
  },
});
