# NovaAgent 插件系统重构计划（破坏性，一次性交付）

> **状态：已执行（2026-10-01）。** 主体已落地并随本次变更集发布；下文保留原始的施工图与验收口径，作为**为什么这么改**的证据留档，而不是待办清单。
>
> **已落地**：单一 `plugins.entries` 配置树（§3）、`PluginLoader` 的稳定 Entry 与 diff 重挂（§4）、宿主不认插件名（§5）、插件与宿主同权的能力键 `loader` / `pluginRpc` / `pluginConfig` / `executionEnvironment` 与 `Context.scope({isolate, intercept})`（§5）、插件自带设置页（`manifest.page` + `PluginPageDescriptor`）（§6）、`Kernel` 契约瘦身（删 `codeMode()` / `setCodeMode()`）与按名分支的界面/帧全删（§6）、破坏性配置变更无兼容层（§8）。
>
> **仍未收口的项：无。** 两处原挂账都已收口：
>
> 1. **client bundle boot graph 接线**（§6 阶段六）——**已接**。`App.tsx` 在 `[connection, rosterEntries]` 上单飞调一次 `loadBootGraph(rosterEntries)`，逐个报告 `error` 的走 `console.error`。第 0 节表格里那条「假闭环」不再成立：现在 `loadBootGraph` / `entriesToLoad` 有生产调用方，插件 server 半经 `routes` 注册资产前缀并声明 `clientBundle.rev` 后，浏览器首次 `ready` 后就会去取它。
> 2. **§7「删除旧协议测试」——已执行**。`packages/web/test/qqbot-frames.test.ts` 已删除（它引用的 `../src/qqbot-frames.js` 不存在），其覆盖由通用的 `plugin-frames.test.ts` 接替；`packages/cli/test/config.test.ts` 已不再 import `qqBotConfigProblem`；`packages/web/test/manage-frames.test.ts` 已重写，不再驱动 `persistQqBot` / `qqBotSnapshot` / `qqBotRuntime`（改以 `plugins.entries` 行为单位）。`packages/plugins/test/extensions.test.ts`（pinned 已删的 `extensionSpecs` / `loadExtraPlugins`）也已删除。
>
> **执行期另修掉三个真实缺陷**（都不是「旧东西没删」，而是机制本身有洞；三处都在开头的状态块里详述，教训见 §9）：
>
> 1. **行开关按错的键校验**：`describePlugins` 用容器的 `root.roster()`（按插件**自己声明的 `name`** 建索引）去查**行 id**，于是每个 spec 载入的包（行 id `@nova-agent/plugin-context` vs name `context`）都被报成 `disabled`——它的设置页从导航里消失（导航由 `page && enabled` 派生），开关也永远验不过。改为按 `PluginHost.entry(row.id)` 读行。
> 2. **开关改了文件、树却按快照重建**：`buildTree` 读装配时的 `opts.config.plugins.entries`，而写者改的是文件，于是 `reroster` 重建翻转**之前**的树，开关拿自己的陈旧答案报错——两个方向、每一行都失败。改为 `persist.readPluginEntries` 活读（与 `models[]` 同一条：文件是真相，读由拥有文件的壳提供），`buildTree` 的 entries 变成参数。
> 3. **线上 `set_plugin_enabled` 寻址不到扩展行**：`SWITCH_NAME_RE` 只收 `[a-z0-9][a-z0-9_.-]*`，凡是模块 spec 形态的行 id（`@nova-agent/plugin-ptc`、`./local.mjs`）都被拒，而拒绝文案还在怪操作者的输入。改为复用 `plugin_request` 同款的 `PLUGIN_ID_RE`；`set_skill_enabled` 保留窄文法（技能名确实是普通标识符）。
>
> **证据边界不变**：`D:\DeepSeek Harness\resources\app.asar` 是单文件归档，无法读取内部源码；本文所有 dsh 引文都来自仓库内的 checkout `deepseek-harness-master/vendor/loader`，不是安装产物。

> 本文件原有定位是**交接文档**：给下一个执行模型的任务书。它不是设计草稿，而是按阶段可落地、可验收的施工图。
> 前置结论：Nova 当时**不是** DSH 式插件系统，而是「统一 Plugin 类型 + 多套宿主定制接线」。本次重构的验收标准是**删掉接线**，不是增加门面。

## 0. 为什么必须重写而不是修补

已核实的证据（行号为本次审计时的工作树；**下表列出的每一个文件/符号都已删除或改写**，`plugin-tier.ts` / `extensions.ts` / `web/src/qqbot-frames.ts` 等文件已不存在，保留下来的行号只说明「当时坏在哪」，不要按它们去读今天的源码）：

| 症状 | 位置 | 说明 |
| --- | --- | --- |
| 插件启用判定靠中心名单 | `packages/plugins/src/plugin-tier.ts:41` `CORE_PLUGINS`、`:74` `ADVANCED_PLUGINS`、`:113` `pluginTier(name)`、`:146` `enabledByTier(name, lists)` | 插件「叫什么、什么档、默认开不开」由宿主表决定，插件自己说了不算 |
| 启停是双轨列表 | `packages/cli/src/config.ts:137-144` `plugins.disable` / `plugins.enable` / `plugins.extra` | 同一件事两种表达，且 `disable` 优先，产生「关不掉的插件」 |
| 有第二录取口 | `packages/cli/src/kernel-config.ts:64-76` `impliedOptIns`、`packages/plugins/src/runtime-roster.ts:148` `codeModeOptIn` | `code.mode !== 'native'` 与 `qqbot` 配置块各自「推导」插件开启，必须靠显式 disable 才能压住 |
| 扩展包按名字 switch | `packages/plugins/src/extensions.ts:113-140`（`case 'subagent' / 'context' / 'ptc'`） | 三个扩展包三种导出约定，加插件就要改这个文件 |
| 每次 roster 整表重建 | `packages/plugins/src/runtime-roster.ts:52` `await host.reset()`、`packages/plugins/src/host.ts:84-94` `reset()` | 没有 Entry identity，无法只重挂变化行 |
| 装配后另有裸 `root.plugin` | `packages/plugins/src/runtime-env.ts:200-235` | capability provider 绕过 roster，存在第二套生命周期 |
| 插件运行时由宿主启动 | `packages/cli/src/web-mode.ts:69-75`（QQ 桥）、`:196-197`（`extraPlugins.push(shared.qq.plugin)`） | 宿主按插件身份决定启停，插件被关仍会建桥/拨号 |
| 插件配置段硬编码 | `packages/cli/src/config-expand.ts:50` `PLUGIN_OWNED_SECTIONS = new Set(['qqbot'])` | 宿主源码认识插件名 |
| Web 协议有插件专用帧 | `packages/web/src/qqbot-frames.ts`、`packages/web/src/controller-options.ts`（`persistQqBot` / `qqBotSnapshot` / `testQqBot` / `recheckQqBot` / `qqBotRuntime`） | 每个插件都要加一族帧和一个 controller 字段 |
| UI 直接按插件名分支 | `packages/web/ui/src/App.tsx`（`off('qqbot')` 决定设置导航）、`packages/web/ui/src/chrome-view.ts:61`（`row.name === 'ptc'`） | 前端知道插件名 |
| 客户端插件加载是假闭环 | `packages/web/ui/src/plugins/client-loader.ts:220` 定义 `loadBootGraph`，全仓**只有这一处**匹配，生产入口从不调用 | 声明了能力但没接线（**已接线**：`App.tsx` 现在单飞调用它——这一行的**文件仍在**，是上表里唯一「行号仍可读、但结论已被推翻」的一条） |

对照 DSH（证据来自 checkout `deepseek-harness-master/vendor/loader`，**不是**安装产物）：稳定配置行 `EntryOptions{id,name,config,group,disabled,inject}`、`Entry.refresh/update` 在差异时 partial-dispose 后重挂、`Tree` 的 `create/update/remove/import`、`Group` 差异更新、HMR 用 `runExclusive` 串行事务并 `watchConfig`。真正回收资源的是 Cordis Fiber 的 `ctx.effect()` 逆序 disposer。

> ⚠️ 证据边界：`D:\DeepSeek Harness\resources\app.asar\dsh` **不存在**；`app.asar` 是约 121 MB 的单文件归档，无法读取内部源码。任何「已安装版如何实现」的断言都不可核验，报告中不得声称。

## 1. 目标模式（Target Model）

一句话：**插件树是唯一的组合真相；Loader 是唯一的生命周期所有者；宿主只提供能力，不认识插件。**

四条不可协商的规则：

1. **一个插件 = 一个稳定 Entry**。`id` 是身份，跨 reconcile 不变。配置、启用状态、fiber 都挂在 Entry 上。
2. **禁用 = 不激活**。disabled Entry 保留 manifest 行（面板要能重新打开），但不创建 fiber、不执行 `apply`、不产生任何外部副作用。
3. **资源归 fiber**。socket / worker / timer / watcher / route / RPC handler / 工具 / 命令 / 服务 / UI contribution，全部在 `ctx.effect()` 内注册，卸载即逆序释放。宿主不得为某个插件写 start/stop 补丁。
4. **宿主不认插件名**。宿主提供通用能力（provider、session、config、routes、RPC、boot graph），插件通过 `inject` 消费。全仓业务代码中不得出现 `name === 'qqbot'` 这类判据。

### 明确不做（Non-goals）

- **不做 Node 模块代码热替换**：本次只支持配置树热重挂载（Entry 增删改 + fiber 重挂）。不做 import cache 失效、不做模块依赖图。文档与 changeset 必须如实写明，**不得把重复 import 称作代码热更新**。
- **不做旧配置/旧 API 兼容**：用户已明确授权破坏性变更。不写 migration 层、不读旧字段、不留 deprecated 别名。
- **不做大规模新测试**：见 §7，测试刻意少而准。
- **不动真实用户数据**：`~/.nova/config.json`、`~/.nova/sessions/`、`~/.nova/plugins/` 不得被测试或脚本改写（测试一律用 `mkdtemp` 临时 home）。

## 2. 模块边界（重构后的职责）

依赖方向仍受 `scripts/dep-direction.mjs` 白名单管辖，重构不得新增反向边。

| 包 | 重构后职责 | 不得包含 |
| --- | --- | --- |
| `core` | 插件协议（`Plugin`/`Config`/`inject`）、Context/Fiber/ServiceStore/EventRegistry、**PluginLoader**、ServiceKey/EventKey、宿主能力契约类型 | cli/web/qqbot/ptc 任何具体知识；PluginLoader 不认识 socket、不 import 具体插件 |
| `plugins` | 插件树装配、发现（spec → import → unwrap → validate）、内置插件与 capability provider、默认插件树 | 按插件名的 switch/工厂；插件显示名的中心表；`enable/disable` 双轨 |
| `cli` | 配置读取与校验、surface 选择、宿主能力创建（provider、config 端口、日志） | 插件运行时启停；按插件名分支；`PLUGIN_OWNED_SECTIONS` 之类的插件白名单 |
| `web` | 通用 HTTP/WS、roster 下发、**通用插件 RPC**、client bundle boot graph、通用设置壳 | QQ/PTC 字段与帧；按插件名渲染页面 |
| `qqbot` | 自己的 config schema、runtime（start/stop/status/probe）、RPC op、routes、settings manifest、client bundle | 依赖 cli/web 源码；假定宿主会替它启动 |
| `plugin-ptc` / `plugin-subagent` / `plugin-context` | 标准 Plugin 导出 + 自身 config schema + client contribution（如需） | 通过宿主工厂函数注入依赖 |
| `web/ui` | 只消费 roster/manifest/contribution registry | 按插件名硬编码的页面、状态字段、CSS |

## 3. 目标配置模型

`~/.nova/config.json` 的插件部分收敛为**一个 Entry 列表**，行级配置交给插件自己的 schema：

```jsonc
{
  "plugins": {
    "entries": [
      { "id": "bash",     "enabled": true,  "config": { "timeoutMs": 60000 } },
      { "id": "todo",     "enabled": true },
      { "id": "subagent", "enabled": false },
      { "id": "@nova-agent/plugin-ptc", "enabled": true, "config": { "mode": "both" } },
      { "id": "@nova-agent/qqbot",      "enabled": false,
        "config": { "appId": "123", "clientSecret": "{env:QQBOT_SECRET}" } },
      { "id": "./my-plugin.mjs", "enabled": true, "config": {} }
    ]
  }
}
```

规则：

- `id` 唯一且稳定；重复 id 报错。
- `enabled` 是**唯一**启停字段。删除 `plugins.enable`、`plugins.disable`、`plugins.extra`。
- 顶层不再有 `qqbot` 段、不再有 `tools.code` 专属段；PTC 的 mode 进它自己的行 `config`。
- `config` 由插件行的 `Config` schema（core 的 `ConfigSchema`，结构兼容 standard-schema）校验，校验失败点名 `id`。
- 未知 Entry 字段、未知顶层键：zod `.strict()` 报错（保持现有纪律）。
- Entry 由谁提供（内置 / 扩展包 / 第三方 spec）不影响配置形状——这正是「加插件不必改源码」的判据。

内置默认 Entry 树由 `plugins` 包提供（纯数据），用户配置按 `id` 覆盖其 `enabled`/`config`。**不再有「靠别的字段推导插件开启」的第二录取口**——`impliedOptIns`、`codeModeOptIn` 整体删除。

## 4. Loader 契约（阶段二核心交付）

```ts
/** 一行插件树的声明。id 跨 reconcile 稳定。 */
export interface PluginEntryOptions {
  readonly id: string;          // 稳定身份；也用于日志、错误、RPC 命名空间
  readonly plugin: AnyPlugin;   // core 的 Plugin（对象/函数/类）
  readonly config?: unknown;    // 交给 plugin.Config 校验的原始值
  readonly disabled?: boolean;
}

export interface PluginEntry {
  readonly id: string;
  readonly plugin: AnyPlugin;
  readonly config: unknown;
  readonly disabled: boolean;
  readonly fiber?: Fiber;       // disabled 行没有 fiber
}

export class PluginLoader {
  constructor(context: Context);
  list(): readonly PluginEntry[];
  get(id: string): PluginEntry | undefined;
  create(options: PluginEntryOptions): Promise<PluginEntry>;
  update(id: string, patch: Omit<PluginEntryOptions, 'id'>): Promise<PluginEntry>;
  remove(id: string): Promise<void>;
  /** 声明式收敛：desired tree → 增/改/删，未变化行保留 identity 与 fiber。 */
  reconcile(options: readonly PluginEntryOptions[]): Promise<void>;
  /** 串行事务：手动开关、workspace 切换、配置重载共用同一队列。 */
  transaction<T>(body: () => Promise<T>): Promise<T>;
  dispose(): Promise<void>;
}
```

语义要求（每条都要有对应测试，见 §7）：

1. `reconcile` 只对**变化**的行动手：`plugin`/`config`/`disabled` 三者皆同则保留 fiber。
2. `disabled` 行：不创建 fiber、不跑 `apply`；`list()` 仍返回它（面板要行）。
3. 变化行的更新顺序：dispose 旧 fiber → activate 新 fiber；**失败时恢复旧行**，并把原始错误作为 `cause`；恢复也失败则抛 `AggregateError`（两个错误都要可见）。
4. `transaction` 串行化一切变更入口，防止「面板点击」与「配置重载」交错。
5. `dispose` 逆序卸载全部行。
6. Loader **不认识** socket/worker/QQ/PTC；它只做 Entry 生命周期。资源回收由 `ctx.effect()` 保证。

`PluginHost` 退化为薄投影：持有同一 `PluginLoader`，对外只暴露 `tools` / `toolEntries` / `commandEntries` / `permissionFor` / `agentHooks` / `roster`。**删除** `pending` 数组、`use()`+`activate()` 两步式、`reset()` 整表重建。

`runtime-roster.ts` 改为：构造候选 Entry（内置 + 扩展 + 第三方 + surface）→ `loader.reconcile(entries)` → 写 manifest。**不再** `host.reset()`，**不再**按名字 switch，**不再** `enable/disable` 过滤。

## 5. 通用扩展能力（阶段三～六）

### 5.1 插件发现（`plugins` 包）

统一为：`spec → resolveModuleSpec → dynamic import → unwrap(default|plugin) → validate(Plugin) → Entry{id, plugin, config}`。禁止按名字 switch/工厂。三个扩展包各自 `export default` 一个标准 `Plugin`，通过 `inject` 消费能力服务（如 `execution-environment`）而不是接收宿主构造的 options。

### 5.2 宿主能力服务（`core` 声明，`plugins` 提供）

已确认需要的通用能力（新增，替代「宿主为插件准备 options」）：

- `execution-environment`：`provider`、`tools()`、`hooks()`、`systemPrompt`、`rootDir()`、`maxTurns?`、`onSubagentProgress()`、`codeConfig`。供 subagent / ptc 这类执行插件消费。
- `plugin-rpc`：插件注册 namespaced handler，`register` 返回 disposer，随 fiber 撤销。

### 5.3 Web 通用插件桥（`web` 包）

- **协议**：新增通用帧 `plugin_request { id, plugin, op, payload }` ↔ `plugin_response { id, plugin, result? | error? }`；**删除** `qqbot` / `save_qqbot` / `test_qqbot` / `qqbot_test` 专用帧。
- **校验**：插件存在性、op 存在性、payload 大小上限、错误隔离（单插件抛错不得断 WS、不得影响他插件）在宿主统一做一次。
- **roster/ready**：下发 manifest（含 `clientBundle`、settings 描述、脱敏 snapshot）。disabled 插件不下发 bundle。
- **boot graph**：修掉假闭环——生产入口在首次 `ready` 后单飞调用一次 `loadBootGraph(roster)`；启用插件并行加载、禁用跳过、单个失败隔离。
- **客户端注册表**：把 `window.__NovaPlugins__: Record<string, unknown>` 换成**typed contribution registry**（fence renderer、settings page、commands、views），注册返回 disposer。`fence-renderers.ts` 的私有 Map 必须改为宿主注入的同一实例，否则动态 bundle 接不进来。
- **导航**：App/SettingsPanel 由活跃 roster + manifest 动态生成，删除按插件名的 `off('qqbot')` / `row.name === 'ptc'`。

## 6. 阶段拆分与文件清单

每个阶段**独立可编译**；阶段末必须 `pnpm build && pnpm typecheck` 通过再进下一阶段。

### 阶段一 · 配置与类型收敛（不改运行时行为语义之外的）
- `packages/cli/src/config.ts`：`plugins` 改为 `{ entries: [...] }`；删 `qqbot`、`tools.code` 专属段。
- `packages/cli/src/kernel-config.ts`：删 `impliedOptIns` 与两处推导；改为投影 entries。
- `packages/plugins/src/runtime-assembly.ts`：`KernelConfig.plugins` 换形。
- `packages/core/src/plugin/types.ts`：`PluginBase` 增 manifest/默认启用声明（若 Loader 需要）。
- 验收：全仓 `rg "plugins\.(enable|disable|extra)|impliedOptIns|codeModeOptIn" packages` 为空。

### 阶段二 · PluginLoader 落地
- `packages/core/src/plugin/loader.ts`（新）：按 §4 实现；修正事务、恢复、identity。
- `packages/core/src/plugin/index.ts`：导出 Loader 与类型。
- `packages/plugins/src/host.ts`：改为 Loader 投影，删 `pending`/`reset`。
- `packages/plugins/src/runtime-roster.ts`：改 `reconcile`。
- 验收：同一 Entry 重复 reconcile 不重复注册；disabled 不激活；更新失败可恢复。

### 阶段三 · 扩展插件标准化
- `packages/plugins/src/extensions.ts`：删 `switch(name)` 与三个 options 投影；只做 spec→import→unwrap→validate。
- `packages/plugin-subagent/src/index.ts`、`plugin-context/src/index.ts`、`plugin-ptc/src/index.ts`：一律 `export default` 标准 Plugin，`inject` 消费 `execution-environment`，自身 `Config` 收行配置。
- `packages/plugins/src/plugin-services.ts`（新）：提供 `execution-environment`、`plugin-rpc`。
- 验收：`extensions.ts` 中无 `case 'subagent'|'context'|'ptc'`；删掉任一扩展包宿主仍能启动。

### 阶段四 · 内置插件与 provider 全量入树
- `packages/plugins/src/plugin-tier.ts`：删 `CORE_PLUGINS`/`ADVANCED_PLUGINS`/`enabledByTier`/`impliedOptIns`；显示信息移到插件自身 manifest（或保留纯 label 表但**不参与启停**）。
- `packages/plugins/src/builtin/*`、`packages/plugins/src/services.ts`：全部走 Entry。
- `packages/plugins/src/runtime-env.ts`：删裸 `root.plugin(...)`；provider 也成为 Entry。
- `packages/plugins/src/runtime-switch.ts`：删双列表写入逻辑，改为 Entry patch（`setEntryEnabled(id, enabled)`）。
- 验收：新增第三方插件无需改 `plugins` 源码即可加载/配置/禁用/卸载。

### 阶段五 · QQ 与 PTC 去特例化
- 删除/重写：`packages/cli/src/qqbot-surface.ts`、`qqbot-api.ts`、`qqbot-credentials.ts`、`web-mode.ts` 的 QQ 装配、`config-expand.ts` 的 `PLUGIN_OWNED_SECTIONS`。
- QQ 侧：`packages/qqbot/src/**` 自持 config schema、runtime start/stop/status/probe、RPC op、routes、settings manifest、client bundle；**WebSocket 必须在插件 fiber 内启动**（关插件即 `stop`）。
- 删除：`packages/web/src/qqbot-frames.ts` 及 `controller-options.ts`/`controller.ts`/`manage-frames.ts`/`frame-router.ts`/`frame-host.ts`/`client-frames.ts`/`server-frames.ts` 中的 QQ 字段与帧。
- PTC：删 `core` 的 `PtcMode` 宿主契约、Web 的 `codeMode`/`set_code_mode`、CLI 的 `tools.code` 投影；mode 归 `plugin-ptc` 自己的 config 与 RPC。
- UI：删 `settings/QqbotSection.tsx`、`QqbotGuide.tsx`、`settings/qqbot-view.ts`、`frame-actions.ts`/`state.ts` 的 qqbot 字段、`App.tsx` 的 QQ 导航分支、`chrome-view.ts` 的 PTC 判据。
- 验收：`rg "name === '(qqbot|ptc|subagent)'|case '(qqbot|ptc|subagent)'" packages` 为空；QQ/PTC 缺包或 disabled 时 WebUI 正常启动。

### 阶段六 · Web 通用插件桥
- 新增 `packages/web/src/plugin-rpc.ts`；协议改通用 `plugin_request/plugin_response`。
- `packages/web/ui/src/plugins/*`：typed registry + 真实接线 `loadBootGraph`。
- `packages/web/ui/src/App.tsx`、`settings/SettingsPanel.tsx`：导航由 roster/manifest 生成。
- 验收：未知插件/未知 op/坏 payload/超限 payload 统一拒绝；单插件错误隔离；disabled 插件不加载 bundle。

### 阶段七 · 删除残留与文档
- 删除旧 writer：`cli/src/config-write.ts` 的 `flipSwitch`/`setPluginsEnabled` 双轨写入。
- 更新 `AGENTS.md` §3（配置）、§4（架构）、§5（插件分层与容器）。
- 更新 `docs/dsh-parity-inventory.md`：`ui-plugin-manager` 条改为 Entry/Loader 机制；修正 client loader 假闭环记录；把 N1（无浏览器插件加载器）改为实际状态。
- 新增 `.changeset/*.md`（中文）：说明破坏性配置/API/插件协议变更，并写明**不支持代码热替换**。

## 7. 测试策略（刻意少而准）

仓库测试已经过多。**本次净增测试控制在 ~6 组**，同时删除因旧协议失效的测试。

保留/新增（每组一个文件，断言契约不变量，不断文案）：

1. `core` Loader：`reconcile` 保留未变化行的 fiber；disabled 不激活；effect 逆序释放；更新失败恢复旧行；`transaction` 串行。
2. `plugins` 发现：标准 `default` 导出被接受；坏导出被拒；缺插件不阻塞宿主；`extensions` 不含名字 switch（守卫断言）。
3. `plugins` 启停：一个普通插件的 enable/disable/re-enable 往返（**只测一个插件**，证明通用机制，不复制到每个插件）。
4. `web` 通用 RPC：未知插件/未知 op/坏 payload/超限 payload 拒绝；单插件抛错不断链。
5. `web/ui` boot graph：启用加载、禁用跳过、单个失败隔离；生产入口调用一次（可测的接线断言）。
6. 秘密：插件 snapshot 不含 secret。

删除：所有只验证旧 `enable/disable` 双轨、旧 `qqbot` 帧、旧 `PTC` 宿主字段、旧 `activate` 协议的测试文件与用例。

不做：不为每个插件写一套启停测试；不加 QQ/PTC 专用 Web e2e；不写代码 HMR 测试（未实现）。

## 8. 验证口径（收尾必跑）

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm gates          # dep-direction + structure-budget
git diff --check
```

结构门禁注意：`scripts/structure-budget.json` 按文件行数设上限。拆分/新增文件后若超限，用 `pnpm gates:update <子串>`，**增长必须显式可见**（它会打印 `RAISED`）。依赖方向：`plugins` 仍只许依赖 core 与三个扩展包（spec 表 + 运行时 `import()`），不得改成静态 import 实现。

人工判定（重构是否成功的真正标准）：

```bash
# 这三条今天仍非空——命中全部是「注释尚未跟上」或「旧协议的测试还没删」，
# 没有一处是活的实现（活实现里没有按插件名的判据，没有双轨列表，没有推导录取口）。
rg "name === '(qqbot|ptc|subagent)'|case '(qqbot|ptc|subagent)'" packages
rg "plugins\.(enable|disable|extra)|impliedOptIns|codeModeOptIn" packages
rg "PLUGIN_OWNED_SECTIONS|qqBotRuntime|persistQqBot|qqBotSnapshot" packages
```

**第一条的命中要分清两类**：`packages/cli/src/repl-progress.ts` 与 `packages/web/ui/src/chat/process-summary.ts` 里的 `name === 'subagent'` 判的是**工具名**（折叠子代理进度），不是插件名——留着是对的，别照着这条 grep 去「修」它们。真正需要处理的是 `**/test/**` 里按插件名找 roster 行的夹具（`manage-frames.test.ts`）。
**第二条的命中分三类**：①**旧 CHANGELOG**（`packages/*/CHANGELOG.md`）——历史记录，**不要改**；②**测试文件里的夹具与注释**（`cli/test/*`、`plugins/test/*`）——按 §7 删除或改写；③**源码注释尚未跟上**，逐条列在这里供后续清理（都是注释，不是行为）：
`packages/plugins/src/runtime.ts:12-13`（头部仍写「`plugins.extra` from config, minus `plugins.disable`」）、`packages/plugins/src/runtime-env.ts:337`、`packages/plugins/src/module-spec.ts:2`、`packages/plugins/src/surface-registry.ts:60`、`packages/core/src/paths.ts:32`、`packages/web/src/controller-options.ts:55`、`packages/web/src/client-frames.ts:129`、`packages/web/ui/src/settings/PluginsSection.tsx:15-17`（仍描述 `disable` / `enable` 两张表）、`packages/plugin-context/src/index.ts:14`（「off until `plugins.enable` names it」）。
**第三条的命中**只剩 `packages/web/test/qqbot-frames.test.ts` 与 `packages/web/test/manage-frames.test.ts`——即上面状态块记的那两处未删测试。

**加一个新插件的成本应当是**：写一个包 → `export default` 一个标准 Plugin（声明 `Config`、`inject`、manifest、可选 clientBundle）→ 在配置里加一行 Entry。**不需要**修改 `core`、`plugins`、`cli`、`web` 的任何源码。任何仍需要改宿主源码的插件，都说明本次重构没做完。

## 9. 交接注意（给下一个执行模型）

- **不要用 wrapper 兜**：给 Loader 加一层适配、给宿主加一个 `if (pluginName === ...)`，都会保留两套协议，属于本次明确要消灭的「负向适配」。
- **一次一个阶段，阶段末必须编译通过**；不要把配置、Loader、Web 协议同时改到一个不可编译的中间态（上一轮 WIP 就是这样坏掉的）。
- **不要并发改同一批文件**：`runtime-roster.ts` / `host.ts` / `runtime-env.ts` 是热点，串行改（`extensions.ts` 已删除，`plugin-tree.ts` 接手了它的职责）。
- **DONE 的判据是删代码**：每个阶段的主要指标是删除了多少宿主特例接线，而不是新增了多少抽象。
- **半途而废最贵的是「删了实现、留下测试与注释」**：本轮就留下了三处引用已删模块的测试（现已按 §7 全部删除/改写）与九处过期注释。删实现时**同一次提交里**改掉它的测试与注释，否则下一个人会以为那些机制还在。
- **本轮最值得记住的三条教训**（都是「声明与实现相反」这一族，只有把两端放在一起读才发现得了）：
  1. **同一个东西有两个键，就一定有一处按错的键查。** 行按 entry id 认，fiber 按插件自己声明的 `name` 认；`@nova-agent/plugin-context` ≠ `context`，于是「按名字查容器」的每一处都悄悄失配（`describePlugins` 报假 `disabled`、`setPluginEnabled` 验不过）。**新代码要问「我拿的是行还是 fiber」并只走那一种查询**（`PluginHost.entry(id)` / `ErrorOf(id)` 是行侧的唯二入口）。
  2. **写文件而读快照 = 开关永远验不过。** 只要有一个端口能改配置，装配期的 `opts.config` 就是陈旧的；拥有文件的那一层必须同时提供**活读**（`models[]` 早已这么做，插件 entries 当时漏了）。**判据**：任何「写完立刻重读以验证」的路径，都要先问自己读的是不是同一个真相来源。
  3. **校验文法要按**数据的真实形态**写，别按「它看起来像个名字」。** 行 id 是模块 spec（`@scope/name`、`./x.mjs`），技能名才是标识符；一条 `[a-z0-9]` 锚定的正则会静默排除所有扩展行，而拒绝文案还会把责任推给操作者的输入。
- 未提交的上一轮 WIP 保存在 `git stash@{0}`（消息以 `nova plugin-architecture destructive refactor WIP` 开头），可作为参考实现，但**不要直接 pop 到干净树上**——它是三方混合且不可编译的中间态。
