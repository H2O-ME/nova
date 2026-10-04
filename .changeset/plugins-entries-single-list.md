---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
'@nova-agent/web': minor
'@nova-agent/qqbot': minor
---

插件配置只剩一张表：`plugins.entries[] = { id, enabled?, config? }` 取代 `plugins.disable` / `plugins.enable` / `plugins.extra`，顶层 `qqbot` 块与 `tools.code` 段一并删除。**没有兼容层、没有迁移脚本**——旧配置里的这些键现在会被 zod `.strict()` 点名拒绝（`packages/cli/src/config.ts`），这正是想要的：静默忽略一个键等于「设置看起来还在、其实什么都没做」。

- **一行就是一个插件**：`id` 是内置插件的名字，或一个模块 spec；`plugins/src/plugin-tree.ts` 的 `buildTree` 先放全部进程内内置插件，其余 id 一律按 `plugins/src/module-spec.ts` 的**同一处**规则解析（路径按工作目录、裸包名先交给 Node、只有产品解析不到才落到 `~/.nova/plugins/node_modules/`）。加一个插件＝加一行。
- **`enabled` 是唯一的开关，插件自己说自己的档**：档位来自插件自己的 `PluginManifest.tier`（`core/src/plugin/types.ts`），默认态只有 `enabledByDefault(tier)` / `isRequiredTier(tier)` 两个函数。删掉的是三张按名字的中心名单（`CORE_PLUGINS` / `ADVANCED_PLUGINS` / 显示标签）、按名字 switch 的扩展工厂、`plugin-tier.ts`、`roster-filter.ts`、`impliedOptIns` / `codeModeOptIn`，以及「`tools.code.mode !== 'native'` ⇒ ptc 开」「配置里有 `qqbot` 块 ⇒ qqbot 开」这两条越权推导。宿主从此**不认识任何插件名**，只认识「一行」；没有 manifest 的第三方插件按 `standard` fail-open（划进 core 会让它永久不可关）。
- **行里的 `config` 归那个插件自己**：由它的 `Config` schema 校验，内核不知道 bash 有没有超时。新增 `core/src/plugin/schema.ts` 的 `objectConfig`——一个结构化的 standard-schema，所以插件可以带 zod 而 NovaAgent 的包仍然零依赖；每个字段都**可选**（`{}` 是合法的一行），但**未知键一律点名拒绝**。
- **一行坏掉只坏一行**：`{env:NAME}` 展开逐行生效（`cli/src/config-expand.ts`），插件行里的未解析引用降级成诊断而不是致命错误——核心段的引用照旧拦住启动。于是某个插件的密钥没设置，不再把浏览器界面、REPL 与 `exec` 一起拖死。
- **读写同一个字段**：`cli/src/config-write.ts` 的 `setPluginEntry(id, patch)` 是启动路径与设置面板的共同写者（`config` **逐键合并**：省略＝保持原样，`null`＝删掉这个键），`nova plugin add|remove|list` 也写它。旧模型下 `plugin add` 把包装进 `plugins.extra`、面板写着 `plugins.disable`，于是 `nova plugin list` 与面板能对「什么在跑」各说各话。
- **`nova qqbot` 的后果（有意为之）**：`@nova-agent/qqbot` **不在 `SHIPPED_PACKAGES`（`packages/plugins/src/plugin-tree.ts`，只含 `plugin-subagent` / `plugin-context` / `plugin-ptc`）里**——它是第三方插件编写示范，包只依赖 core（而非 plugins 反过来依赖它），凭据与设置住在它自己那一行的 `config` 里。所以要用它得自己在 `plugins.entries` 写一行并填 `appId` / `clientSecret`；行不给就**没有通道**，`nova qqbot` 点名拒绝而不是挂起等待。

`cli/src/kernel-config.ts` 的 `toKernelConfig` 因此退化成直通（只挑 `plugins.entries`），三处配置投影一并删除。
