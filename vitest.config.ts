import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nova-agent/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@nova-agent/ai': fileURLToPath(new URL('./packages/ai/src/index.ts', import.meta.url)),
      '@nova-agent/plugins': fileURLToPath(new URL('./packages/plugins/src/index.ts', import.meta.url)),
      // Same source plane as the three above: `pnpm check` does NOT build, and
      // without this the cli suites resolve the qqbot plugin to the LAST BUILT
      // dist — any public member added to qqbot/src turned every cli test that
      // touches the channel red in the fast ring while staying green in the
      // full one (which builds first). Tests read source, never stale output.
      '@nova-agent/qqbot': fileURLToPath(new URL('./packages/qqbot/src/index.ts', import.meta.url)),
      // Extension packages, same source-plane rule: tests read their sources,
      // never a possibly stale dist.
      '@nova-agent/plugin-subagent': fileURLToPath(new URL('./packages/plugin-subagent/src/index.ts', import.meta.url)),
      '@nova-agent/plugin-context': fileURLToPath(new URL('./packages/plugin-context/src/index.ts', import.meta.url)),
      '@nova-agent/plugin-ptc': fileURLToPath(new URL('./packages/plugin-ptc/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    /**
     * Every suite runs with `~/.nova` redirected to a throwaway directory.
     *
     * Installed here, globally, because the alternative — a rule each test
     * author must remember — was already forgotten by five suites that built
     * real kernels against a temp workspace while their session logs, spill
     * caches and config went to the developer's actual home. Hundreds of junk
     * session files accumulated in `~/.nova/sessions` from ordinary `pnpm test`
     * runs. Isolation a test cannot forget is the only kind worth having.
     */
    setupFiles: ['./packages/test-setup.ts'],
    // 两档：包级 test/，以及嵌套子包（packages/web/ui 的浏览器侧直测）。
    // `.tsx` 必须收：ui 车道是 node 环境下的 SSR-to-string 直测（无 jsdom），
    // 组件渲染断言写在 .tsx 里——只收 .test.ts 会让它们永不执行。
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'packages/*/*/test/**/*.test.{ts,tsx}'],
  },
});
