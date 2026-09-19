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
    // 两档：包级 test/，以及嵌套子包（packages/web/ui 的浏览器侧纯函数直测）。
    include: ['packages/*/test/**/*.test.ts', 'packages/*/*/test/**/*.test.ts'],
  },
});
