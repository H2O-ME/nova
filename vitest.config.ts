import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Ordered array, not an object map: object keys give no matching-order
    // guarantee, and `@nova-agent/core/totals` must resolve BEFORE the
    // `@nova-agent/core` prefix rule turns it into `…/index.ts/totals`.
    alias: [
      { find: /^@nova-agent\/core\/totals$/, replacement: fileURLToPath(new URL('./packages/core/src/totals.ts', import.meta.url)) },
      { find: '@nova-agent/core', replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
      { find: '@nova-agent/ai', replacement: fileURLToPath(new URL('./packages/ai/src/index.ts', import.meta.url)) },
      { find: '@nova-agent/plugins', replacement: fileURLToPath(new URL('./packages/plugins/src/index.ts', import.meta.url)) },
      // Same source plane as the three above: `pnpm check` does NOT build, and
      // without this the cli suites resolve the qqbot plugin to the LAST BUILT
      // dist — any public member added to qqbot/src turned every cli test that
      // touches the channel red in the fast ring while staying green in the
      // full one (which builds first). Tests read source, never stale output.
      { find: '@nova-agent/qqbot', replacement: fileURLToPath(new URL('./packages/qqbot/src/index.ts', import.meta.url)) },
      // Extension packages, same source-plane rule: tests read their sources,
      // never a possibly stale dist.
      { find: '@nova-agent/plugin-subagent', replacement: fileURLToPath(new URL('./packages/plugin-subagent/src/index.ts', import.meta.url)) },
      { find: '@nova-agent/plugin-context', replacement: fileURLToPath(new URL('./packages/plugin-context/src/index.ts', import.meta.url)) },
      { find: '@nova-agent/plugin-ptc', replacement: fileURLToPath(new URL('./packages/plugin-ptc/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    /**
     * 为什么不是 vitest 的默认 5000ms：**本仓的测试按设计真做 I/O**。
     *
     * 普查（各包的 `test/` 目录）里属这一族的用例，等的都是测试线程外的真实
     * 系统资源：`plugin-ptc` 的 code runtime 与 `plugins` 的 search 起真 worker
     * 线程；`plugins` 的 bash 用例与 `web` 的 rightbar/session frames 夹具 spawn
     * 真 shell / 真 `git`；`web` 的 launch-web / server / port 绑真 localhost 端口
     * 并走真 HTTP/WS 往返；`plugins/runtime.test.ts` 建真内核（写会话日志、扫
     * skills、探 PATH）。**这份墙钟属于这台机器，不属于被测行为**——5s 是「纯逻辑
     * 用例的地板」，不是「I/O 用例的地板」，用它判 I/O 用例就是把环境误报成挂起。
     *
     * 实测（本机 i5-10210U，4 物理核 / 8 逻辑核；数字是 lane 并发下的墙钟）：
     *   git --version 1757ms   git init 3179-5353ms   git commit 2838-4380ms
     *   两条 bash 用例：lane 下 5581/7572ms，隔离 2515/2914ms，串行 2476/2893ms
     *   全量并发：bash `seq 1 500` 11943ms、listDirectory 10284ms、git clone
     *   9360ms —— 它们都**通过**了自己 20s/60s 的局部预算
     *   默认 5000ms 下真正翻红的都是同一根因、四个不同文件：launch-web 6753ms、
     *   plugins/runtime 5293ms 与 5627ms、web/controller 5391ms、web/port 5114ms
     * —— 逐个给用例加常数因此是打地鼠（普查已见 9 个文件），这里一处收口。
     *
     * 30_000 与已落地的两处具名常量同值（rightbar-frames / session-frames 的
     * `GIT_FIXTURE_TIMEOUT_MS`、plugins.test.ts 的 `BASH_SPAWN_TEST_TIMEOUT_MS`），
     * 于是「环境墙钟」在本仓只有一个数；subject 自己的预算更长的用例继续在用例上
     * 显式写更大的数（如 session-frames 的 60_000），局部例外仍然可见。
     * **它不是把灯拔掉**：断言一条没动（超时只吸收环境，断言仍管行为），真挂起仍在
     * 30s 内报出——比 5s 晚，但远在分钟级以内；`pnpm test` 全量从 ~3 分钟起算，
     * 这个上限也换不来「让并发消失」。
     */
    testTimeout: 30_000,
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
