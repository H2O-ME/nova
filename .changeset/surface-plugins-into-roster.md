---
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

**修复：配置声明的 surface 插件现在会作为普通插件行进入 `/plugins`，可以被列出与开关。**

现象：在 `~/.nova/config.json` 的 `surfaces` 里声明 `@nova-agent/tui-app/surface` 后，`nova --tui` 能走，但 webui 的插件管理页**始终看不到**它——既不能确认它已加载，也无法通过开关关掉。

根因是装配链路的一处接线缺口，而不是设计意图缺失：

- plugins 侧早已就绪：`createAgentKernel` 的 `opts.surfaces`（`{ registry, loaded }`）会经由 `runtime-env` 提供 `surfaces` 容器服务，再由 `runtime-roster` 把每个已加载的 surface 用 `surfacePlugin` 包装成**普通插件行**（origin `surface`，落入 tier 表与开关）。"配置过的 surface 应出现在 `/plugins`" 是一条已写明的契约。
- 但 cli 的三个装配点**都没把这个 payload 传进去**：`buildSurfaceRuntime`（动态 surface 路径）、`bootKernel`（exec / repl / qqbot）、`WebController.create`（`nova --web`）。于是 `opts.surfaces` 恒为 `undefined`，那条"surface → 插件行"的逻辑永远走不到——`/plugins` 自然看不到它。

本次打通整条透传链：

- `core` 新增 `SurfaceRows` 类型（`{ registry: SurfaceRegistry; loaded: readonly AgentSurface[] }`），`runtime-assembly` 的 `CreateKernelOptions.surfaces` 改用它，避免三处手写同形联名。
- `cli/src/surfaces.ts` 的 `loadDynamicSurfaces` 现返回 `LoadedSurfaces`（`{ entries, rows }`），把已加载的 surfaces 和共享 registry 一并暴露；`index.ts` 将其注入 `SurfaceRequest.surfaces`。
- 四个装配点（`bootKernel` / `buildSurfaceRuntime` / `startWeb` / 动态 surface 的 `runSurface`）从 `SurfaceRequest.surfaces` 读取并透传给 `createAgentKernel({ surfaces })`。
- `web` 的 `ControllerOptions` 增加 `surfaces?`，`WebController.create` 转发给 `createAgentKernel`。

### 回归守卫

`packages/plugins/test/surface-registry.test.ts` 新增用例：给 `createAgentKernel` 传入 `surfaces: { registry, loaded }`，断言 `kernel.roster()` 里有该 surface 的行（`origin: 'surface'`），且 surface 的插件行注册到**同一个** registry 实例。改回旧行为（谁都不传 `surfaces`）该用例即红。
