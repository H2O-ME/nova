import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nova-agent/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@nova-agent/ai': fileURLToPath(new URL('./packages/ai/src/index.ts', import.meta.url)),
      '@nova-agent/plugins': fileURLToPath(new URL('./packages/plugins/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // 两档：包级 test/，以及嵌套子包（packages/web/ui 的浏览器侧直测）。
    // `.tsx` 必须收：ui 车道是 node 环境下的 SSR-to-string 直测（无 jsdom），
    // 组件渲染断言写在 .tsx 里——只收 .test.ts 会让它们永不执行。
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'packages/*/*/test/**/*.test.{ts,tsx}'],
  },
});
