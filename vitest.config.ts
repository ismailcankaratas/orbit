import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const hasWeb = existsSync('./apps/web/vite.config.ts');

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', include: ['packages/core/test/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'fixtures', include: ['packages/test-fixtures/test/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'server', include: ['apps/server/test/**/*.test.ts'], environment: 'node', testTimeout: 20000 } },
      ...(hasWeb
        ? [{ extends: './apps/web/vite.config.ts', test: { name: 'web', root: './apps/web', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom' } }]
        : []),
    ],
  },
});
