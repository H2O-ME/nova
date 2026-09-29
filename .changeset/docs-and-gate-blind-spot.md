---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
'@nova-agent/web': patch
'@nova-agent/cli': patch
---

文档与代码对账、两条死代码清理、结构门禁补上最大的盲区、一条会偶发变红的测试。

**文档与事实相反（4 处）。** `README.md` 的测试徽章写 `986 passing`（实际 1755）、指向 `AGENTS.md §10`（该文件只有 §1–§8，公共 API 面是 §8）、并宣称「内核装配只有一个点…四个 runner 全部经它装配」——而 `bootKernel` 只有 3 个调用点，`web/src/controller.ts` 的 `WebController.create()` **直接调 `createAgentKernel`**，权威文档 §4 早已把这件事写成「内核装配有两个调用点，不是唯一装配点」。README 现在照实说：`nova` 的默认形态恰恰是唯一绕过 `bootKernel` 的那个。`AGENTS.md` §8 第 3 条写 `SessionEvent` 的 **9** 个事件类型，与同文件 §5 的「共 10 个变体」及代码矛盾，已改为 10；§5 把子代理进度回调的接线点记成 `runtime-roster.ts`，实际在 `runtime-builtins.ts` 的 `kernelPlugins()`（roster 只是调用者）。README 的 smoke 项数由 20 改为 21——`scripts/smoke-web.mjs` 有 22 处 `check()`，其中握手那条是 `check(..., true)` 的**恒真断言**，不是检查。

**`docs/` 与门禁盲区。** `structure-budget.mjs` 与 `dep-direction.mjs` 原先只扫单层 `packages/<包>/src`，于是 `packages/web/ui/src`——全仓最大的一块代码（172 个文件、24,613 行）、且是一个**真实 pnpm 工作区成员**——既无行数上限、也无依赖方向检查，`pnpm gates` 会照样报「全部在上限内」。两者改为扫 `packages/<包>/src` **及其嵌套成员的 `src/`**（嵌套成员按宿主包的白名单管辖），172 个新条目一次性入账，受管文件数 210 → 382。顺带查实一处**幽灵依赖**：`packages/web/ui` 的 `package.json` 没声明 `@nova-agent/core`，而 `ui/src/types.ts` / `rightbar/files-model.ts` / `rightbar/terminal-model.ts` 都在 import 它——它此前只是靠父目录 `packages/web/node_modules/@nova-agent/core` 这个 junction 才解析得到，`@nova-agent/core` 从 `web` 消失的那一天就会断。已补上 `workspace:*`。

**两条死代码。** `roster-filter.ts` 的 `applyRoster()` 全仓零调用点（真正在用的是同文件 `loadableRoster`），且它是「按名过滤」的第二份实现——按单一实现纪律删除，连同 `roster.ts` 的再导出。`builtin/index.ts` 的 `trustedReadRoots` 文档注释仍在描述「browser uploads land in `~/.nova/cache/uploads/`」，而那个目录**已被刻意删除**（有路径的文件一律走 `@path` 引用），注释改为说明「今天没有调用点，`spillReadRoot` 是唯一在册的 trusted read root」。

**偶发变红的测试。** `web/test/controller.test.ts` 有三处用固定 `setTimeout(20/30ms)` 等一轮跑完，而不是同文件已有的 `conn.waitFor(...)`。全量并发下机器一慢就丢事件，实测 5 次全量里有 1 次失败：`expected [ 'user_message', 'phase', …(4) ] to include 'message'`（单跑该文件 5/5、单跑 web 车道 12/12 均通过，故是测试自身的竞态而非产品缺陷）。三处改为等待真实事件。

`AGENTS.md` §8 第 5 条另加一条限定：`AgentSurface` / `AgentSurfaceKernel`、`surfaces` 服务键与 `pluginLoaded` 事件键**已导出但尚无提供者或消费者**，签名变更照样要升位，但在有人消费之前不作为可依赖的公共面——此前它们同时出现在「公共 API 面」与「死缝」两处，是文档内部的自相矛盾。

顺带修掉两处合并残留的格式（`runtime-builtins.ts:34`、`controller.ts:180` 各有两个语句挤在同一行）。
