---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/tui-app': minor
'@nova-agent/cli': minor
---

把终端界面（TUI）从 cli 的内置功能改造为**配置驱动的动态 surface 插件**——兑现「`nova --tui` 是一个插件，不是 cli 源码里硬挂的内部 surface」。

这次是对 `tui-surface-restore` 那一份 changeset 描述的机制的**结构改造**（机制变了，功能没变）：TUI 不再是 cli 自带的 surface，而是 `tui-app` 通过公共 `AgentSurface` 契约导出的一个插件，由 `~/.nova/config.json` 的 `surfaces` 行点名后动态加载。参照系是 dsh：host 源码永不点名 `@deepseek-harness-tui/dsh-tui`，它在 `cordis.yml` 的 `plugins` 行里被动态解析。

- **`@nova-agent/core`**：`AgentSurface*` 契约从 `kernel.ts` 拆出到 `surface.ts`，kernel.ts 收为纯 barrel（结构预算要求拆不要求抬）。契约仍是纯类型、零实现，core 不认识任何具体 surface。
- **`@nova-agent/plugins`**：新增 `surface-registry.ts`——`createSurfaceRegistry()`（数组注册表）+ `loadSurfacePlugins(specs, cwd)`（动态 `import()`、`default ?? surface` 具名导出、`isAgentSurface` 校验 `{name,claim,start}` 三件齐备、缺一即启动失败）。`resolveModuleSpec` 与 `loadExtraPlugins` 共用同一原语。`surfaces` ServiceKey 仍声明、仍**无容器提供者**（刻意死缝：注册表必须先于内核装配存在，而容器是内核装配的产物——往容器里 provide 一个「内核还没装好时就要用」的东西自相矛盾）。
- **`@nova-agent/tui-app`**：新增 `src/surface.ts` 插件入口——`export const tuiSurface: AgentSurface`，`claim` 读 `flags.tui && !flags.repl && interactive`，`start` 走 `startTuiSurface(runtime)`。package.json 新增 `"./surface"` 子路径导出，tsdown `entry` 加 `src/surface.ts`。`answersQuestions: true` 由 surface 自己声明。
- **`@nova-agent/cli`：`cli` 的白名单从 `[plugins, ai, core, qqbot, web, tui, tui-app]` 收窄到 `[plugins, ai, core, qqbot, web]`——`tui`/`tui-app` 刻意不在列**。这是 dsh 模型：host 源码不点名 surface 包。`dep-direction.mjs` 的正则扫**全文件文本**（含注释与字符串），所以 cli 源码里**零** `@nova-agent/tui`/`@nova-agent/tui-app` 字面量——`grep` 已验。`tui-mode.ts` 删除；`tui` 的 `SurfaceEntry` 与 `import('./tui-mode.js')` 从 `surfaces.ts` 删除。
- **`cli/src/surface-host.ts`（新增）**：`buildSurfaceRuntime(surface, m, argv)` 是**任何动态加载 surface 的通用装配点**（调用点 ③）——`runSurface()` 调 `surface.start(runtime)`，host 装内核。`userQuestions` 从 `surface.answersQuestions ?? surface.interactive` 推导（不再手抄），TUI 路径因此与 `repl`/`web` 同源——这正是 `tui-surface-restore` 漏的那一行，如今由 surface 自己声明、host 读取。`toAgentSurfaceRequest`/`toCommandPorts`/`toFlags`/`toDiagnostic` 适配。
- **`cli/src/surfaces.ts`（重写）**：`loadDynamicSurfaces(config, cwd, argv, registry)`——`config.surfaces` 缺省→`[]`；否则 `loadSurfacePlugins` + `registry.register` + 适配成 `SurfaceEntry`（claim/start → `runSurface`）。`resolveSurface(m, extras=[])` 把动态 surface 放在 SUBCOMMAND 与 DEFAULT 之间。先序遍历保留：子命令仍最高、`--repl` 仍强过 opt-in、浏览器仍兜底。
- **`cli/src/config.ts`**：`surfaces: z.array(z.string().min(1)).optional()`，schema 仍是 `.strict()`。注释用裸名「tui-app 包的 ./surface 子路径」——不含 `@nova-agent/` 字面量，正则安全。
- **`cli/src/index.ts`**：`main()` 先 `createSurfaceRegistry()` + `loadDynamicSurfaces(config, process.cwd(), args, registry)` 再 `resolveSurface`。`--tui` 未在 `surfaces` 配置时给一条引导错误（点名「tui-app 包的 ./surface 子路径」），而非静默回落到 web——一个显式 opt-in 不该静默选错端。
- **`cli/package.json`**：从 dependencies 删除 `@nova-agent/tui` 与 `@nova-agent/tui-app`——cli 不再静态依赖 surface 包。

**测试**：`cli/test/surfaces.test.ts` 重写（注入一个 fake tui surface 作 `extras`，钉死动态层优先级与回落，7 个用例）；`plugins/test/surface-registry.test.ts` 新增（真实临时 `.mjs` 模块：default/surface 具名导出、no-export 拒绝、import 抛错拒绝、相对路径，9 个用例）；`tui-app/test/surface.test.ts` 新增（claim 的四个方向直测，6 个用例）。

**门禁证据**：`pnpm gates` → 「依赖方向：8 个包全部符合白名单」「行数预算：409 个 src 文件全部在上限内」；`pnpm verify` → build/typecheck 全 Done、175 文件 2034 测试通过（+16）；`grep @nova-agent/tui packages/cli/src` 零命中。**「cli 不能静态依赖 surface 包」是机检红线**，不再靠约定。

**未解决**：①根 `package.json` 尚未加 `@nova-agent/tui-app` 工作区依赖——裸 spec `@nova-agent/tui-app/surface` 在 monorepo dev 下从仓库根解析是否走通，需 `pnpm build` 后真机 `pnpm nova --tui` 验证（需 `~/.nova/config.json` 的 `surfaces` 行声明）；②TUI 真机验收仍无法自动化（`tui-surface-restore` 的第三条理由延续）；③调用点 ① ② 的 `userQuestions` 仍各自手传（repl/web 显式 `true`，exec/qqbot 默认 `false`）——只有 ③ 从 surface 声明推导，因为它服务第三方 surface。
