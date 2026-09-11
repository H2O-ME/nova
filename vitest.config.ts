import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nova-agent/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@nova-agent/ai': fileURLToPath(new URL('./packages/ai/src/index.ts', import.meta.url)),
      '@nova-agent/plugins': fileURLToPath(new URL('./packages/plugins/src/index.ts', import.meta.url)),
      '@nova-agent/tui': fileURLToPath(new URL('./packages/tui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
  },
});
