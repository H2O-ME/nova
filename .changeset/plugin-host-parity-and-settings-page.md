---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
'@nova-agent/web': minor
'@nova-agent/plugin-ptc': minor
'@nova-agent/qqbot': minor
---

插件拿到与宿主**同一组**能力，宿主不再为每项能力准备一套精选 API。能力键的唯一定义处仍是 `core/src/plugin/capabilities.ts`，四个新成员各自只是一个 provider（`plugins/src/plugin-services.ts` 与 `host.ts`）：

- **`loader` → `PluginLoader`**（键定义从 `loader.ts` 搬进 `capabilities.ts`）：`create` / `update` / `remove` / `reconcile` / `transaction`——一个插件能在运行时管理**别的行**。它随 `PluginHost` 构造即 provide，所以插件拿到的实例与宿主**是同一个**。
- **`pluginRpc` → `PluginRpc`**：插件声明自己的命名空间（`register(name, handler)`，disposer 挂在它自己的 fiber 上），界面侧 `invoke(name, op, payload)` 调用。**被关掉的插件没有命名空间**，所以它什么也不回答——宿主因此不需要为任何插件准备请求族，新增的 `web/src/plugin-frames.ts` 用**一对**通用帧 `plugin_request` / `plugin_response`（带 `id` 关联）承载全部插件交互，payload 是 `unknown`。
- **`pluginConfig` → `PluginConfigPort`**：`readEntry(id)` 返回**文件里写的那一份**（`{env:NAME}` 因此按**名字**回显，而不是把密钥漏出去），`setEntry(id, patch)` upsert 那一行并**立刻重 roster**。放在端口里而不是每个调用点，是为了让「存了却没生效」不可能发生：保存与生效是一步。
- **`executionEnvironment` → `ExecutionEnvironment`**：活的 provider、活的工具注册表、组合后的钩子、persona、工作区根与进度汇（都按调用时求值，不是装配时快照）。于是 `subagent` / `ptc` 这类执行类插件从「内核点名构造的工厂」变成「`inject` 一个服务的普通包」。
- **`Context.scope({ isolate, intercept })` 与 `Context.labelled(id)`**（`core/src/plugin/context.ts`，转写 dsh `vendor/loader/src/config/isolate.ts`）：`isolate` 给一个服务名分叉出私有 provider，`intercept` 包裹任意服务的实现（替换或仅做观测）。**刻意没有「可拦截服务」白名单**——store 里每个键都能被包裹，工具与 agent 循环自己的缝也不例外，因为它们就是普通服务。

**插件自带的设置页**：插件在 manifest 里声明 `page: true`（`PluginManifest.page`，`core/src/plugin/types.ts`），浏览器侧的 roster 行带上 `page?: boolean`（`WireRosterEntry.page`），导航就多出它一节。点进去时界面发一条 `plugin_request`（`op: 'page'`），插件回一个 `PluginPageDescriptor`（`core/src/plugin/settings-page.ts` 的 `{ title, intro?, guide?, status?, fields?, actions? }`，字段是 `text` / `secret` / `select` / `switch` 四种原语，行为是具名动作）。宿主只提供一个渲染器 `web/ui/src/settings/PluginPageSection.tsx`，`pagePlugins(rows)`（`settings/plugin-state.ts`）从**活 roster** 筛出 `page === true && enabled !== false && state === 'active'` 的行——导航与「谁真的开着」同源。判据是**白名单而不是 `state !== 'failed'` 黑名单**：一节页要靠那个插件自己的 `pluginRpc` 命名空间回答 `page`，而命名空间**挂在 fiber 上**——`pending` / `loading` 还没跑 `apply`、`disposed` 已拆、未知相位同样没有命名空间，所以「没报故障」≠「有活 fiber」，只有 `active` 能答。`enabled` 与 `state` 答**两个问题**：`enabled` 是**操作者意图**的事实（`apply()` 抛错的行 `enabled` **仍是 `true`**），`state` 是**活性**事实。**写进哪个键由插件自己的 `Config` schema 说了算，界面不认识任何插件的字段名**，所以第三方插件能给出与内置插件同等质量的设置面板而不需要改宿主源码。

`plugin-ptc` 借这条缝把执行模式收回自己：`PtcMode` / `PTC_SETTING_KEYS` / `ptcPage(...)` 现在都定义在 `packages/plugin-ptc/src/settings.ts`，`mode` 是它自己那一行 `config` 的一个字段，RPC 命名空间在 mode 检查**之前**注册（关掉 `run_code` 不等于连设置也不能改）。`qqbot` 同样把凭据、拨号、探针与连接读数全搬进包内 `src/plugin.ts` 的 fiber 与它自己的设置页描述符。
