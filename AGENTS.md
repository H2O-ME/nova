# AGENTS.md — NovaAgent

> 本文件是仓库的**唯一权威文档**（面向人类与 AI 编码 agent）。`README.md` 只是门面页（hero + 三张机制图）。**机制变更就改这里**；每一条都可在源码里复核，行数口径是 `scripts/structure-budget.json` 的 `split('\n').length`（比编辑器少一行是正常的）。

## 1. 这是什么

自研、插件化、轻量化的跨平台本地 agent 运行时：在**当前工作目录**运行，通过任意 OpenAI 兼容端点对接模型，以「一切皆插件」的内核统一扩展工具、斜杠命令、钩子、Skills 与能力服务；界面只是同一内核事件流的消费者。所有数据（配置/会话/缓存/技能）集中在 `~/.nova/`，**运行目录零写入**。

- **运行时**：Node.js ≥ 20；PTC 代码模式额外要求 ≥ 22.19（`stripTypeScriptTypes`）。
- **工具链**：TypeScript（strict）、ESM-only；构建 `tsdown`，测试 `vitest`，lint `oxlint`，包管理 pnpm。
- **平台**：Linux / Windows 为测试目标（macOS 顺带兼容）。路径一律 `node:path` + 抽象层，**禁止硬编码 `/` 或 `\`**。
- **参照系**：pi（分层包结构）、deepseek-harness（一切皆插件 / Cordis 式容器 / WebUI 设计资产）、openai/codex（AGENTS.md 发现链 / 审批 / 可回放会话日志）。

## 2. 常用命令

```bash
pnpm install
pnpm build         # pnpm -r build：各包 tsdown 构建到 dist（连带产出前端产物）
pnpm dev           # tsx 直跑 cli 源码（免构建）
pnpm test          # vitest run（ai 层注入 fetch + SSE fixture，不发真实请求）
pnpm typecheck     # pnpm -r typecheck（逐包 tsc --noEmit）
pnpm lint          # oxlint packages（含 complexity / 长函数 warn）
pnpm gates         # 结构棘轮：依赖方向白名单 + 逐文件行数上限（超限即失败）
pnpm gates:update  # 同步行数上限（下调静默；上调逐条打印 RAISED）
pnpm check         # 快环：lint + gates + --changed 测试（秒级，随手跑）
pnpm verify        # 全环：build + typecheck + test + gates（提交前跑）
pnpm smoke:web     # 真机冒烟 nova --web（会走真 provider，故不发于 verify）
pnpm nova          # 跑 dist：TTY 上默认起浏览器界面
pnpm release       # changeset version + sync root version + commit + tag
```

> ⚠️ `pnpm nova` 跑的是 **`packages/cli/dist`**，改完 `src` 必须 `pnpm build` 才生效（`pnpm dev` 走 tsx 直读源码）。

安装为全局命令：`cd packages/cli && npm link`。

**`nova` 的四种形态**（认领规则见 §4）：

- `nova` → **浏览器界面**（`@nova-agent/web`）：单 Node 进程 = HTTP 静态托管 + 单 WebSocket 内核事件流。启动打印**一次性带 launch token 的 localhost URL**，校验后落 HttpOnly 签名 cookie；绑定地址强制回环。`NOVA_WEB_PORT` 固定端口（前端开发流：先 `nova --web`，再在 `packages/web/ui` 跑 `pnpm dev`，http/ws 全代理）。
- `nova --repl` → **readline 终端形态**（非 TTY 自动回落；`--repl` 是「强制回落」而非兼容 no-op）。
- `nova qqbot` → QQ 机器人（需 `qqbot.appId` / `clientSecret`；对端独立会话，永不交互审批）。
- `nova exec "<task>" --json` → 非交互单次执行（JSONL 事件流；无法交互确认，未放行的审批自动拒绝）。`--json` 下另有控制行 `run_error` 与 `notice`；SIGINT 改为优雅中止。

## 3. 配置（唯一来源 `~/.nova/config.json`）

项目目录里**不需要、也不会产生**任何 `.nova/` 文件。`apiKey` 支持 `{env:NAME}`（未设置即报错，不静默变空串）。schema 是 `packages/cli/src/config.ts` 的 **zod `.strict()`**：未知键（如拼错的 `apporval`）在加载时报错并点名该键。**字段清单以该文件为唯一事实来源**。

```jsonc
{
  "provider": {
    "baseURL": "https://api.example.com/v1",
    "apiKey": "sk-...",              // 或 "{env:MY_KEY}"
    "model": "model-name",
    "temperature": 0.7,               // 可选：0..2，透传
    "maxTokens": 8192,                // 可选：正整数，透传 max_tokens
    "contextWindow": 200000           // 可选：窗口兜底（缺省查 models.dev）
  },
  "approval": "read-only",            // read-only | auto-edit | full
  "notify": true,                     // 可选：系统通知（NOVA_NO_NOTIFY=1 亦可关）
  "systemPrompt": "补充指令…",         // 可选：附加用户指令，注入首条上下文片段
  "maxTurns": 30,                     // 可选：单次任务最大轮数（上限 500）
  "autoCompactTokenLimit": 60000,     // 可选：上轮 prompt tokens 超限自动压缩
  "ui": { "theme": "dark" },          // 可选：REPL 外观（NO_COLOR 恒定无色）
  "plugins": {                        // 可选：插件 roster（配置层扩展点）
    "disable": ["todo"],              // 不加载的内置插件（名字即 /plugins 打印的那个；拼错会告警）
    "extra": ["./my-plugin.mjs"]      // 额外插件模块（路径或包名；加载失败即启动失败）
  },
  "tools": {
    "bash": { "enabled": true, "timeoutMs": 60000, "shellPath": "C:/Program Files/Git/bin/bash.exe" },
    "code": {                          // 可选：PTC 模式（native|ptc|both，缺省 native = 关闭）
      "mode": "ptc",
      "maxParallelSubCalls": 10,       // 单 run_code 内并行子调用上限（≤100）
      "computeMs": 30000,              // CPU 时间预算（busy-time）
      "maxWallMs": 60000,              // 墙钟预算
      "maxOutputBytes": 1048576,       // stdout/stderr 输出上限
      "maxOldGenerationSizeMb": 256    // 堆内存上限
    }
  },
  "qqbot": { "appId": "xxx", "clientSecret": "{env:QQBOT_SECRET}" }
}
```

**`plugins` 是配置层扩展点的正式入口**：不改源码即可关掉任一内置插件或加载自写插件。`extra` 模块须以 `default`（或 `plugin`）导出 `{ name, activate(ctx) }` 形态，走与内置插件**完全相同**的容器 API 与审批门。拼错的 `disable` 名会告警；加载失败的 `extra` 直接让启动失败——静默忽略的扩展比坏掉的启动更糟。

Skills 放 `~/.nova/skills/<name>/SKILL.md`（用户级）或项目级 `.nova/skills/`（只读发现）；frontmatter 仅 `name` / `description`，同名时**项目级优先**。

## 4. 架构

pnpm monorepo，依赖方向由 `pnpm gates` 机检。工作区 **7 个成员**（`packages/*` 加 `packages/web/ui`），其中 **6 个受白名单管辖**：

| 包 | 职责 | 规模 |
| --- | --- | --- |
| `core` | provider 无关的 agent 循环（async generator 事件流）、append-only 消息模型、会话持久化与投影、工具调度、token 预估、请求级修剪、后台 jobs、**插件容器**、**内核句柄与事件协议**、审批与呈现词汇表 | 44 文件 / 6767 行 |
| `plugins` | **插件世界与内核装配**：工具宿主（legacy 公共 API 的兼容门面）、审批引擎、内置工具、skills、**命令目录唯一生产者**、`createAgentKernel`、roster | 35 文件 / 5538 行 |
| `ai` | OpenAI 兼容手写客户端：fetch + SSE 流式、工具调用、重试与断流自愈、usage/缓存命中提取 | 3 文件 / 627 行 |
| `web` | **浏览器 surface 后端**：单 Node 进程 = HTTP 静态托管 + 单 WS 事件流；launch token → HMAC 签名 HttpOnly cookie；自写 RFC6455（**零第三方依赖**） | 17 文件 / 1883 行 |
| `qqbot` | QQ 机器人接入插件（**第三方插件编写示范**，只依赖 core/plugins 公共 API） | 5 文件 / 614 行 |
| `cli` | 产品壳（**surface 装配**）：argv → 装配哪个 surface + 配置发现 + 模型元数据 | 20 文件 / 2935 行 |

前端子包 `packages/web/ui`（private `nova-web-ui`）是浏览器侧，React 18 + Vite 7 + Tailwind 4，**102 文件**。

**依赖方向白名单**（`scripts/dep-direction.mjs` 的 `ALLOW`，即上表的事实来源）：

```
core: []                              ai: [core]
plugins: [core]                       qqbot: [core, plugins]
web: [core, plugins]                  cli: [plugins, ai, core, qqbot, web]
```

该脚本用正则扫描各包 `src/` 下的 **import 语句**（不是 `package.json`）。`core` 零上游；**surface 层（web / qqbot / repl / exec）地位相同**，都用 core/plugins 公共 API。

**包输出形态**：每个包 `exports` 只有 `"."`（`dist/index.*`），tsdown 单入口 `src/index.ts`。两个例外：① `plugins` 另有两个 **spawn-only worker 入口**（`ptc/worker.ts`、`builtin/search-worker.ts`）——固定输出文件名是 `new URL('./worker.mjs', import.meta.url)` 的解析前提，但**不是公共 API**（未进 `exports`）；② `cli/src/index.ts` **零 `export`**，`"."` 暴露的是一个只执行 `main()` 的 bin 脚本，公共面在 `config.ts` / `surfaces.ts` / `command-runner.ts`。

### 可插拔 Surface：两套类型，勿混为一谈

- `core/src/kernel.ts` 导出**纯类型** `AgentSurface { name; start(kernel: AgentSurfaceKernel) }` 与 `AgentSurfaceKernel { agent }`。意图是「官方与第三方 surface 同地位」的公共契约——但**目前没有任何实现引用它**（仅被同样未被提供的 `SurfaceRegistry` 类型引用）。
- **真正的注册表在 `cli/src/surfaces.ts`**：`SURFACES: readonly SurfaceEntry[]`，`SurfaceEntry = { name; interactive?; claim(m): boolean; start(m): Promise<void> }`，参数 `SurfaceRequest { rootDir, config, parsed, interactive }`。**它不使用 `AgentSurface`，也没有 `inject` 概念**；解析是 `SURFACES.find(e => e.claim(m))`——**数组顺序即优先级**，实现按需动态 `import()`。

  1. `qqbot` — `positional[0] === 'qqbot'`
  2. `exec` — `positional[0] === 'exec'`
  3. `web`（interactive）— `!repl && (web || interactive)`
  4. `repl`（interactive）— `repl || !interactive`

  子命令高于 flag，`--repl` 高于默认；`interactive = stdout.isTTY && stdin.isTTY`。**claim 必须覆盖交互与非交互两种 stdio**：`nova --web` 一走管道也必须被 web 认领（真机 smoke 就是这么跑的），否则会被 REPL 抢走。此判据由 `cli/test/surfaces.test.ts` 的认领表直测钉住。

### 内核装配有两个调用点，不是「唯一装配点」

- `plugins/src/runtime.ts:32` 定义 `createAgentKernel(opts)`：把 approval / llm / jobs / sessions / spill / compaction / skills / tools / commands 发布为**可按键替换**的服务插件，并装配 host、审批桥、`PermissionService`、`JobRegistry`、上下文片段。
- **调用点 ①** `cli/src/kernel-boot.ts:81` 的 `bootKernel()`：exec / repl / qqbot 经它装配（provider 由 owning surface 注入）。
- **调用点 ②** `web/src/controller.ts:62` 的 `WebController.create()`：**web 自己装配**，不经 `bootKernel`。`cli/web-mode.ts` 只借 `createProvider` / `toKernelConfig` 交给 `launchWeb`，内核在 `packages/web` 内部建起来。这是**结构性分歧而非疏漏**：web 需要 `modelCatalog` 与 provider 的模型标签/窗口，而 `BootOptions` 装不下这些。因此「`nova` 默认形态走 `bootKernel`」是错的——**默认形态恰恰是唯一绕过它的那个**。

## 5. 核心设计

### 一切皆插件（Cordis 式容器）

内核里没有任何「能力」是硬连线的：工具、斜杠命令、生命周期钩子、能力服务全部经插件容器注册，并且可以**按键替换**。

- **容器**（`core/plugin/`）：`Context`（服务读写 + effect 撤销 + 事件派发）／`Fiber`（插件状态机 `pending→loading→active→failed→disposed`）／`ServiceStore`（按 `key<T>()` 寻址，provider 换代驱动依赖方重载）／`EventRegistry`（五种派发：`emit`、`waterfall`、`parallel`、`serial`、`bail`）。
- **waterfall**：监听器返回非 `undefined` 即胜出；调 `next(...)` 委派并可改写参数（纯变换器按序复合）；不委派也不返回 = 弃权。
- **serial / bail**：第一个决定性裁决即胜出——审批门是 `priority: 1000` 的监听器（`plugins/hooks.ts:100`），所以权限总是先被裁定。
- **effect 撤销**：一切注册走 `ctx.effect()`，返回的 disposer 在插件卸载时**逆序**执行——**正确拆除是构造出来的，不是记得做的**。
- **兼容门面**：历史公共插件 API（`{ name, activate(ctx: PluginContext) }` + `registerTool` / `registerCommand` / `registerHook`）在 `plugins/host.ts` 被适配到容器上——**每个 legacy 注册都变成容器 effect**，于是内置与第三方插件一行不改就获得正确生命周期。
- **roster 组装**在 `plugins/runtime-roster.ts`：内置 + surface 自带 + `extra` − `disable`，随后追加 `kernelCommandsPlugin` 与（非空时）`skillsPlugin`。`host.reset()` **复用同一个 registry**——重 roster 时工具服务不消失又回来，审批门看不到服务闪断，也没有旧 host 上的工具被捕获引用继续可达。

**能力服务缝**（`core/plugin/capabilities.ts` 是**唯一定义处**）：10 个服务键 `llm` / `tools` / `commands` / `approval` / `sessions` / `compaction` / `jobs` / `spill` / `skills` / `surfaces`（接口与提供者见该文件），4 个事件键 `beforeLlmCall`(`llm/before`)、`beforeToolCall`(`tool/before`)、`afterToolResult`(`tool/after`)、`pluginLoaded`(`plugin/loaded`)。

> **10 个服务键里 9 个有提供者。** `surfaces` **无提供者、无消费者（死缝）**——真实注册表在 cli（§4）。`pluginLoaded`(`capabilities.ts:264`) 属同一类：**只有声明，全仓无 `ctx.on`/`ctx.emit`**。新增能力键的前提是**已经有人消费它**。

**可溯**：`/plugins` 打印 roster（名字 / 状态 / 注入的服务），数据源 `kernel.roster()`；每次运行都是 `KernelEvent` 流，每轮以 `run_stats` 收尾。

### 内核协议（`AgentSession` + `KernelEvent`）

`KernelEvent` 是 **25 个变体** = `AgentEvent` 的 11 个（`turn_start` / `text_delta` / `reasoning_delta` / `message` / `tool_call_start` / `tool_call_result` / `usage` / `turn_aborted` / `llm_retry` / `empty_completion` / `done`，原样透传）+ **内核新增 14 个**：`user_message`、`phase`、`approval_request`、`approval_resolved`、`tool_progress`、`subagent_update`、`job_update`、`queue_update`、`model`、`command`、`compaction`、`run_failed`、`run_stats`、`notice`。

辅助联合：`TurnPhase = idle|thinking|writing|tool|waiting_approval|compacting|retrying`；`NoticeCode = compacted|compact_fused|compact_alias_broken|compact_failed|surface_lagged|listener_failed`。

**一个 surface 只需 `switch (event.type)` 就能驱动整个产品**——凡不在协议里的都不可观测，这既让 surface 可替换（浏览器 / bot / headless），也让它们能针对同一个 reducer 直测。

- **`AgentSession`**（`core/kernel/session.ts`，24 个公共成员）是 surface 拿到的**唯一句柄**：`events`；`session` / `messages` / `status`(`idle|running|compacting`) / `running` / `currentPhase` / `lastUsage` / `lastPromptTokens` / `queued` / `approvalMode`；方法 `usageSnapshot()` / `setApprovalMode()` / `setApprovalPolicy()` / `pendingApprovals()` / `subscribe()` / `notice()` / `announceCommand()` / `announceModel()` / `observeSubagent()` / `observeJob()` / `jobSnapshots()` / `stopJob()` / `prompt()` / `abort()` / `resolveApproval()` / `compact()` / `dispose()`。surface 不自己跑生成器、不自己落盘——「model-visible means logged」由内核 `consume()` 保证。
- **`Kernel`**（`plugins/runtime-types.ts`，21 个成员）：`agent` / `hooks` / `host` / `llm` / `models?` / `commands` / `runCommand()` / `permission` / `jobs` / `skills` / `systemPrompt` / `rootDir()` / `sessionEnv()` / `buildFragment()` / `codeMode()` / `roster()` / `newAgentSession()` / `activateSession()` / `setWorkspace()` / `setCodeMode()` / `dispose()`。实现是 `runtime-facade.ts` 的活读门面（`models` 在没有 `modelCatalog` 时**整个键不出现**，而非空 object）。
- **`EventPump`**（`kernel/pump.ts`）：`MAX_LAG = 2000`；落后消费者的窗口被清空并替换为一条 `surface_lagged` 通知；**抛错的监听器被隔离**（`listener_failed`）而不是把进程带走。
- **量测**：`RunMeter` / `RunStats`（`kernel/metrics.ts`）——`startedAt` / `durationMs` / `firstTokenMs?` / `llmMs` / `toolMs` / `requests` / `toolCalls` / `retries` / `promptTokens` / `completionTokens` / `cachedTokens`。
- **模型端**：`ModelOption` / `ModelGroup` / `ModelCatalogPort` / `ModelControl` / `canSwitchModels`（`kernel/model.ts`）。

> **`AgentSession` 没有 `setModel`。** 切换是 `ChatProvider.setModel()`（原地改写同一客户端实例）→ `plugins/runtime-models.ts` 随后调 **`AgentSession.announceModel()`** 发 `model` 事件。`kernel/model.ts` 的注释里写着 `AgentSession.setModel`，那是**注释 bug**，以代码为准。

### 命令目录

斜杠命令也是插件缝：`core` 声明 `CommandRegistry`（`ctx.registerCommand`，与第三方插件同一条公共 API），**`plugins/kernel-commands.ts` 是其唯一生产者**。`commandRunner` 同时给出**活目录**（`catalog()` 每次读容器：后注册的命令立刻出现在每个界面的菜单里）与**唯一 runner**（`Kernel.runCommand(name, args)`）。

分工线画在**能力**上，不在名字上：需要界面才能完成的事（换主题、退出进程、打开模型选择器）**不进这个目录**，归那个界面。反之任何插件注册的命令——第一方或第三方——都自动出现在每个界面菜单里并由同一条 runner 执行，**没有第二份目录**。

runner 契约是「调用方永远拿到一条可渲染的结果」：开一条 `command` 行（`phase: 'run'`）、收集命令自己 `log` 的行、以 `done` 行收尾（命令抛错**把原因写进同一行**，不中止会话）；未知名字同样留一行。前端「一份草稿意味着什么」是 `ui/src/composer/command-menu.ts` 的一组纯函数：注册表认得 `/name` 就发命令帧，认不得就**原样发提示词**。

REPL 保留自己的 `COMMAND_SPECS` 目录（`/theme` / `/clear` / `/exit` 是只有终端能做的）；但两边 `/compact` 的**语义是同一个**（`AgentSession.compact('manual')`）。

### 呈现意图词汇表（core 拥有形状，surface 拥有观感）

「一次工具调用长什么样」的中立表达在 `core/presentation.ts`：`ToolCallKind`（`read|edit|write|search|execute|job|plan|other`）+ `card` 判别的 `ToolCallView` / `ToolResultView`。**分工线画在这里**：core 只拥有调用的**形状与语义**（无文案、无颜色、无列宽），**文案 / 颜色 / 列宽 / 降级档位一律归各 surface**。

工具经 `ToolDefinition.presentCall?(args)` / `presentResult?(args, content)` 声明自己是什么，界面 `switch (view.card)` 消费，**不按工具名特判**；两个方法都是纯函数，且 `presentCall` **不得读盘**（它在授权前被调用，审批弹窗要能为尚不存在的文件画出 diff），故签名里没有 `ctx`。未声明的工具（含第三方、`jobs`、`run_code`）自动落 `generic` 卡——**永远不会不可渲染，只是不够具体**。

**视图解析归宿主，不归界面**：`callViewOf(tools, call)` / `resultViewOf(tools, call, content)` 从**活工具表**取声明，控制器在 `tool_call_start` / `tool_call_result` 出站前把 `view` / `resultView` 附在帧上，`ready` 回放时对每个历史工具块做同一件事。于是浏览器侧零按名特判、零失败启发式：**同一次调用在任何 surface 上由同一份声明渲染**。

### Web surface

`nova` 的默认形态 = 一个 Node 进程托管前端 + 一条 WebSocket 事件流，**没有第二套状态**：内核事件进，帧出。

- **持久日志是真相，`ready` 覆盖转录**。浏览器不累积「自己以为的历史」；挂上 socket 就收到 `ready` 基线（`rootDir` / `sessionFile` / 模型 / 审批档 / 模式 / `commands` / `history: WireBlock[]` / `historyTotal` / `runTotals` / 挂起审批 / 用量基线 / 窗口分母），**重连即重建**。回放块由服务端 `transcript.ts` 从 `deriveMessages()` 投影（跳过上下文片段、工具调用与结果按 id 配对），工具块**在那里**就带上视图、结果原文与时间戳。
- **两个窗口，同一切点**：转录基线与轨迹（`session-pages.ts` 的两条 `LogWindow`）在同一 session 的同一时刻切。`ready` 带 `HISTORY_TAIL = 40` 与 `traceTotal`；`load_earlier` / `load_trace` 按 `{ have }` 向前翻页。`baseline.ts` 的**冻结快照**是游标所依（实时事件只追加在客户端活区，绝不进这个数组）；轨迹 `have: 0` 是重读、非零按已切窗口计数，故不会重复已持有的行；「已全部持有」回空批而非报错。
- **线上硬上限**：客户端帧 ≤ 512 KiB，`have` ∈ `0..1e6`，WS 单条 ≤ 1 MiB（超限以 1009 关闭）；畸形帧拒绝并给出原因，不静默截断。
- **会话列表不参与「重建」**：`ready` 重置一切会话态，**唯独不清空侧栏的会话列表**——切会话会广播 `ready`，而重列不是让面板眨眼的理由。契约：`ready` 只把 `sessionsStale` 置真，客户端在「陈旧且无请求在飞」时单飞补问（`App.tsx`），答到之前旧行继续渲染。服务侧对应地让重问便宜：`core/session-listing.ts` 并行 `stat` + 按 mtime 记忆化 `peekSession`。
- **审批走事件，不走隐式等待**：`approval_request` 帧带完整请求（kind/工具/参数/效果预览），前端以 `resolve_approval` 回答（answer 就是内核的 `AskResult`，线上解析走 core 的 `parseAskResult` 单一解析器）；断连时挂起审批随内核 abort 收敛为 deny（fail-closed 不变）。
- **认证只有一道**：启动打印一次性 `?t=<token>` 的 localhost URL，校验后落 **HMAC-SHA256 签名、host-only、HttpOnly、`SameSite=Strict`** cookie 并 302 到干净地址；HTTP 与 `/ws` 共用它（`timingSafeEqual` 比对），静态托管拒绝穿越。`web/src/index.ts` 强制回环绑定（非 `127.0.0.1`/`localhost`/`::1` 直接抛错）。**不引入任何第三方依赖**——RFC6455 服务端自写。**缓存策略按路径分**：`/assets/*` 是 Vite 内容哈希产物 → `max-age=31536000, immutable`；**其余（含 `index.html`）一律 `no-cache`**——缓存的文档指向的是上一次构建的资产 URL，重建后那个文件已不存在。
- **前端分层与内核同构**：`state.ts` 是唯一 reducer（帧入、UI 块出，纯函数直测）；`state-events.ts` 归约事件；`card-view.ts` 是工具卡的**纯渲染模型**（`switch (view.card)` 六卡 × running/stale/ok/fail 四态，DOM-free 直测）；`chrome-view.ts` 是外壳视图模型；`flow.tsx` 是块 → 行的唯一映射；`format.ts` 是**主要格式化处**（`trace-view.ts` / `card-view.ts` 仍本地格式化）；`trace-view.ts` / `diff-lines.ts` / `session-groups.ts` 同为纯函数。React 组件只做投影。markdown 走**元素树渲染**，全程无 `innerHTML` / `dangerouslySetInnerHTML`——XSS 靠构造不可能，而非转义正确。
- **视觉系统 = deepseek-harness 移植（MIT，样式文件逐份署名）**：三层 token（`--dsw-static-*` 原始色阶 → `--dsw-alias-*` 语义 → 组件局部 `--dsh-*`），明暗双档同一级联（`body[data-ds-dark-theme]`，`index.html` 内联脚本首帧前解析，暗为默认）；三栏 AppFrame（`侧栏 | minmax(0,1fr) 正文`，280px 默认、264–420 可拖、<1024px 收为图标轨道）；正文列宽 `clamp(680px, 列宽×0.64, 920px)`，转录列 `flex 1 0 auto` 保证 composer 座**恒贴底**。图标全部手写内联 SVG（16px 盒、stroke = currentColor），Unicode 字符图标清零；**图标的设计盒写进元素本身**（`width`/`height` 属性）——只有 `viewBox` 的 SVG **没有内在尺寸**，在 flex 行里对父级宽度贡献为零（曾被压成竖排文字、箭头塌成 0×0）。护栏 `ui/test/style-guard.test.ts`：零字面色、零 ANSI、每个内联 `<svg>` 都声明设计盒、每个 CSS 类都有消费者。
- **模型端：目录只有站点能给，名字只有元数据能给，切换在同一客户端上原地发生**。端点公布它服务的模型 id（`ChatProvider.listModels()` → `GET /models`），显示名与窗口来自壳层的 models.dev 存储（`ModelCatalogPort`，peek 优先、离线可用），两者在 `plugins/runtime-models.ts` 汇成**只有一组**的目录；**在役模型永远在列**（站点不再公布它时，菜单仍答得出「我在跟谁说话」）。`set_model` 走 `ChatProvider.setModel()`，**原地改写同一客户端**（不重建 provider——会话句柄、子代理工具、缓存亲和绑定都还指着这个实例）→ 会话发 `model` 事件 → 控制器把它变成给所有客户端的 `state` 帧：**座位跟着事件走，不跟点击的乐观值走**。失败是**答案**（空列表 + 重试）而不是断线；窗口未知时**清空分母**而不是沿用上一个模型的数字。

### 观测面自己算不出来就去内核要

转录里的**每轮元数据行**（用时/首 token/吞吐）与底部**会话统计条**全部来自内核的 `run_stats` 事件（`RunMeter` 在 `consume()` 里量），**表面一个数都不测**。工具行是按钮，点开右侧详情侧板看完整参数/结果原文/时间；后台 job 是转录里的**一行一处、原地改写**的活动行。

**量测是持久的，不是进程内的**：同一份 `RunStats` 以 **log-only `run/stats` 事件**追加进会话日志（`afterMessageId` 锚定它收尾的那条消息）——否则续接/重载的会话会丢掉每一轮的状态行与统计条。回放时 `transcript.ts` 用 `anchoredRunStats` 把锚点还原成 `meta` 块（同一锚点后者胜），折叠值随 `ready.runTotals` 下发（内核、服务端与前端共用 `web/totals.ts`）。**时钟只有一个**：回合的 `MetaRow` 拥有它，助手尾行只留复制/分支。

> **`run_stats` 的时序契约**：它在 `done`（或 `run_failed`）**之前**发出——终结符是消费者等的最后一帧，统计跟在它后面就一定会被只等终结符的消费者漏掉；**落盘先于广播**，所以「崩在这一帧之后」不会留下一轮没有量测的运行。

### 上下文与缓存命中率（核心差异化）

目标：**稳定前缀 = 高缓存命中**。四层机制：

1. **前缀冻结**：系统提示字节稳定；环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改。环境信息切「静态/动态」两节（`context-section.ts`）。注入片段带**权威指令帧**（`<user_instructions>` / `<project_docs>` 标注为「操作者写入的活跃指令，按字面执行」），同时**保留数据/指令二分**——从文件读到的文本仍是不信数据，防恶意仓库内嵌指令劫持。
2. **追加式日志**：对话严格 append-only；工具结果超 **40KB** 时全文落盘 `~/.nova/cache/tool-outputs/<sessionId>/`，消息体保留头部 **60%** + 尾部 **40%**（尾部常带失败详情）并附读取提示（提示行预留 200 字节，head+tail+提示恒守预算）；落盘用 `flag:'wx'`（不覆盖、不跟随植入的符号链接）、**永不落进工作区**；该目录经 trusted read roots 豁免审批。**请求级中间压缩**：`assembleRequest` 在 hook 链之后、ephemeral 尾之前做纯函数修剪（`request-trim.ts`，**先 snip 后 micro**）——snip 按**原子工具组**裁中段（`SNIP_MAX_GROUPS=50`、保头 3 组），micro 把「最近 3 工具组之前」的旧结果正文换占位符（调用名/参数/id/配对全保留、可重跑取回）；修剪只产出新数组、**永不原位 splice 活日志**，也不进 `deriveMessages` 投影。
3. **compact**：`/compact` 与自动阈值（`autoCompactTokenLimit`，以最近一次 usage 为锚点发请求**前**预判）共用同一实现；压缩**原位追加** `compaction/start → summary → end` 三事件，模型可见面由 `deriveMessages()` 投影重建，**原始历史永不改写**；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）。**压缩保真**：摘要提示词是 codex 式**七节**结构（Task / Progress / Decisions / Current state / Issues / Next steps / References）、**无字数上限**；摘要输入的工具结果按 **4000 字符/条**截断；保留预算 **32000 字符**。**全文存档**：压缩前的完整 transcript 落 `pre-compact-*.txt`（trusted read root 内，`read_file` 免审批），摘要尾部附 `<archive>` 指针。**token 预估计入 assistant 的 tool call 参数**（`rawArgs`），`estimateMessageTokens` 带 `WeakMap` 记忆化。headless（exec）的轮内预检逐请求全量估算，并带**熔断**：一次压缩后仍超阈值即停用本任务后续自动压缩并告警一次。
4. **供应商对齐**：请求携带 `prompt_cache_key` 与 `x-session-id` / `x-session-affinity` 亲和头，让网关把同一会话固定路由到同一缓存节点。指标目标：会话第 3 轮起 prompt cache 命中率 ≥ 90%。

> **工具数组顺序**：主工具数组发给 provider 前按**工具名字典序稳定排序**（`ai/client.ts`，不改动调用方传入数组）——即使中途禁用 bash 或切换 code mode 导致注册顺序重排，工具槽位顺序也保持稳定。PTC SDK binding 亦按 schema 字典序生成（字节稳定）。

### 会话日志 v2（不可变事件流 + 投影）

JSONL 从裸消息升级为事件流，`SessionEvent` 共 **9 个变体**：`message`、`compaction/start`、`compaction/summary`、`compaction/end`、`todo/write`、`approval`、**`workspace`**、`code-dispatch`、`run/stats`。其中 `todo/write` / `approval` / `workspace` / `code-dispatch` / `run/stats` 是 **log-only**（永不进模型可见面）；`workspace` 标记供会话切换时恢复工具根与列表分组。

压缩不重开会话；v1 旧会话打开时原子升级（`upgradeToV2`）。`appendEvent` **先写盘后入内存**——写失败时内存与磁盘不再发散。**抗损坏**：进程被杀导致的末尾半行在 `Session.open` 时自动截断修复（不告警），中段真损坏行跳过并告警。`compactionSummaryMessage()` 让压缩的活路径与回放投影构造**逐字节相同**的摘要消息。

会话目录 API 在 `session-index.ts`（64KB 头扫描在 `session-peek.ts`，列表记忆化在 `session-listing.ts`），列表按**工作区**分组（`workspace` 标记 / 旧日志回落 `<environment>` 的 `cwd=`）。**缺失工具结果的补齐只有一份实现**（`session-repair.ts` 的 `missingToolResults`）：内核收尾与 agent 循环的合成结果共用它。

### 审批与权限（轻量版，对标 codex）

三档：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）。execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 默认按**命令程序前缀**记忆（`git status` 放行后续 `git …`，不波及 `rm`），复合命令只整条记忆；该粒度**可交互调节**：选中「总是允许」行按 ←/→ 挪授权词数（引擎按**词前缀匹配**放行，越界/复合自动回落默认粒度）。「拒绝」行打字即补充拒绝理由，经 `{answer:'deny', reason}` → `decideDetailed` → hook verdict（`hooks.ts` 拼成 `by user: <理由>`）一路回流成工具结果 `Permission denied: by user: <理由>`——**拒绝从死路变成一次指令**。

**答案解析只有一个实现**：`core/approval.ts` 的 `parseAskResult(value)` 把**任何不可信来源**的答案（WebUI 帧、插件 asker 返回值、REPL 行）转成内核 `AskResult = AskAnswer | AlwaysGrant | DenyGrant`——同时接受 tagged（`{answer:'always'|'deny', …}`）与 bare（`{scopeWords}` / `{reason}`）两种形状，fail-closed（畸形一律 `undefined`），scope 词数与拒绝理由长度有界（`MAX_ALWAYS_SCOPE_WORDS = 32` / `MAX_DENY_REASON_CHARS = 400`），拒绝理由里的控制字符被拒（`core/text.ts` 的 `hasControlChars`，多行字段允许换行）。此前每个 surface 各带一份，三份的「什么算合法」各不相同。

ask 路径的每次决定写入 `approval` 审计事件（log-only，可回放；自动放行不记事件，防只读工具刷屏）。审批弹窗上方实时渲染 `edit_file` 的 `- 旧行 / + 新行` diff、`write_file` 的目标+首行预览（工具经可选 `preview(args)` 声明）。

### 工具执行

- **文件工具硬化**：`write_file` / `edit_file` 越界检查跑在 **realpath 规范化路径**上（堵死符号链接跟穿逃逸）；写用同目录 tmp + rename 原子替换；`edit_file` 带按文件版本的陈旧检测（`FILE_VERSIONS_MAX = 512`）；`read_file` / `edit_file` 共用 `READ_MAX_BYTES = 8 MiB` 上限，另有二进制探测。`countLines()` 不把尾换行当一行。
- **并行执行**：工具可声明 `isConcurrencySafe` 纯同步分类器，相邻多个 opt-in 调用整段并行（审批仍逐个串行），结果按原调用顺序写入保持确定性；并行段用 `Promise.allSettled` 收敛避免 unhandledRejection。
- **输出截断防御**：`finish_reason=length` 的截断消息中**所有 tool call 一律不执行**（流式参数可能静半截），整批以错误结果回填让模型重发；未解析成 JSON 的畸形参数**只失败那几条**，其余照跑。
- **search_files**：`content_regex`（逐行正则，返回 `path:line: text`）与 `name_glob` **至少一个必填**，两个都给时 `content_regex` 优先；默认跳过 `.git` / `node_modules` / `dist` 与点目录、绝不跟随符号链接、单文件 1 MiB 扫描上限。**回溯隔离**：`content_regex` 先经宿主预检（长度 ≤ 512、量词总数 ≤ 32、嵌套量词组拒绝），再进**全新 worker 线程**执行；墙钟预算默认 30s、中止信号透传 `terminate()`。
- **专用工具优先于 shell**：系统提示与工具 description 双侧写排他句（`Use read_file — not shell commands like cat/head/tail`、`Use search_files — not shell grep/rg/find`）。
- **工作区切换（switch_workspace）**：第一方 `workspace` 插件（opt-in）校验目标目录后经 runner 回调 `env.reroster()` 重建工具宿主——fs/bash/search 根、技能列表、环境片段 cwd 一致重指。

### PTC / Code Mode（对标 Cloudflare/dsh run_code 简化版）

`tools.code.mode` 三态 `native|ptc|both`（`PtcMode` 定义在 core——config/host/纯视图层共用，避免跨层依赖）。开启后模型获得 `run_code {code, description}`：写一段 async TypeScript 程序，`await tools.name(args)` 即子调用，**穿过与原生调用完全相同的管线**（审批门 + 钩子 + 超时/中断）。只有程序 print/return 的策展输出进入上下文，中间结果只落 `code-dispatch` 审计事件。执行基底是**每 run 全新 worker 线程**（信任姿态等同 bash）：剥型、空环境、堆/busy-time/墙钟/输出四类预算。需 Node ≥ 22.19。

### Subagent（隔离子代理）

`subagent` 工具（opt-in）：嵌套 `runAgent` 跑**全新消息面**（上下文隔离——子代理看不到父对话，prompt 必须自包含），最终 assistant 报告作为工具结果回流父会话（父日志保持「model-visible means logged」；子代理自身对话是瞬态、不落盘）。嵌套工具集活读取并**过滤 subagent 自身**（结构性禁止递归）；透传父 abort signal 与**同一 hooks 链**。**编排姿态**（系统提示 + 工具描述 + 嵌套 `SUBAGENT_POSTURE` 三层注入）：默认 1–2 个只读侦察、brief 不重叠、报告给 `path:line` 证据指针；设计/复杂实现留在主代理。嵌套报告首行约定 `complete/partial/blocked`。

### 后台 jobs / todo

`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，`jobs` 工具（list/output/stop）读写增量输出。job 自然结束时**下一次 LLM 请求自动注入一行通知**（`drainFinished()`，以克隆消息数组追加临时 user 消息——**不落日志、不破坏投影不变量**；**送达性至少一次**：请求失败/中断时经 `requeue()` 回队），模型无需空转轮询。

`todo_write` 整表替换、last-write-wins，快照持久化为 log-only 事件，不占模型上下文；**计划失活提醒**：连续 3 轮（`STALE_TODO_TURNS`）无 `todo/write` 快照时，下一次请求经**同一请求级临时通道**注入 `STALE_TODO_NAG`（与 job 通知共用 at-least-once 簿记）。两个尾注都排在 hook 链**之后**——`beforeLLMCall` 的原地压缩假设 `request.messages` 与 `opts.messages` 同引用，提前克隆会吞掉它的 splice。

### Skills / 数据落盘

Skills 只把 name+description 注入索引，命中触发词才加载正文——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发。项目级 `.nova/skills/` 优先于用户级。

```
~/.nova/
├─ config.json              # 唯一配置来源
├─ skills/                  # 用户级技能（项目级 .nova/skills/ 只读叠加且优先）
├─ sessions/YYYY/MM/DD/     # JSONL 会话（append-only，可回放，按日期归档，全局不分项目）
└─ cache/
   ├─ tool-outputs/<sessionId>/   # 工具输出溢出 + 压缩前全文存档
   └─ models-dev.json             # 模型目录缓存
```

路径布局**只有一处**（`core/paths.ts`：`novaHome` / `sessionsRoot` / `sessionDateBucket` / `userConfigPath` / `toolOutputsDir`），cli 的 `config.ts` 直接再导出。

## 6. 代码约定 / 在这里怎么工作

- **内置能力皆第一方插件**：新工具/命令/钩子走 `PluginContext` 注册，与第三方同 API、同审批门；新的**能力**（服务）走 `ctx.provide(key<T>(), impl)`，让它在配置层可替换。别在 core 里开特例。
- **Hook 结果结构化**：`ToolCallVerdict` 是判别联合（`allow` / `deny`+reason / `rewrite`+plain-object args），`validateToolCallVerdict(unknown)` 纯函数在宿主组合器与 `runAgent` 门各验一次（fail-closed）。`beforeLLMCall` 链另带工具集护栏（按名集合比较：可收窄（PTC 投影）或 clone 保持集合不变，**加宽直接抛错**——工具集是前缀缓存的一部分）。
- **前缀字节稳定**：任何动态内容都注入会话首条 user 片段（append-only），绝不回改系统提示或旧消息。
- **单一实现**：同一件事只允许一个实现——审批答案解析（`parseAskResult`）、文本卫生（`hasControlChars`）、呈现形状（`presentation.ts`）、视图解析（`callViewOf`）、斜杠命令语义（`command-runner.ts`）、前端格式化（`format.ts`）、路径布局（`core/paths.ts`）、缺失工具结果补齐（`session-repair.ts`）。发现第二份就把它并掉。
- **测试不联网**：三层体系——①单元层（纯函数，断言确定字符串）；②ai 层注入 `fetch` + SSE fixture；③接缝集成测试（SSE→client→runAgent 全管道、save→open→deriveMessages→新轮的投影一致性）。三条直测车道：**内核层**（`core/test/`）、**surface 层**（`web/test/` 守帧编解码/认证门/静态缓存策略/回放重建/视图 enrich/命令目录与 runner；`web/ui/test/` 以纯 reducer、纯渲染模型、纯格式化、行级 diff、会话分组、`/` 菜单规则与 token 归属守卫钉住流式合并、工具行形变、命令行收敛、审批清场、断线语义、六卡映射、每轮统计累加、分页游标与 diff 交错——**没有 DOM、没有浏览器**）、**cli 层**（`cli/test/` 守 surface 认领表、装配、命令语义、配置校验、版本锁步）。各包 `test/helpers/` 收敛 `scriptedProvider` / `withFakeHome` 共享 fixture。**真机验收单独一档**：`pnpm smoke:web`。
- **路径/跨平台**：一律 `node:path` + 抽象层；bash 工具 Windows 优先 Git Bash、回落 PowerShell 并强制 UTF-8（`POWERSHELL_UTF8_PREFIX` / `powershellInvocation` / `bashOnPath` / `resolveShellName` 是共享原语）。
- **文档即真相**：机制变了同步改本文件（README 只留门面 + 配图）；决策理由写进 commit message 与机制条目。
- **门禁与 verify 分层**：快环 `pnpm check`；全环 `pnpm verify`。`pnpm gates` 是两件套**结构护栏**：`dep-direction.mjs` 机检包间 import 方向、`structure-budget.mjs` 管逐文件行数上限（超限即失败；新文件没有上限条目也会失败，跑 `pnpm gates:update [子串]` 同步——上调逐条打印 `RAISED`，增长必须显式发生过；陈旧条目亦失败）。**单文件超长是设计失败**：行数天花板就是「拆它」的指令，按**职责**拆（`runtime.ts` → env / roster / facade / session 四份）。治巨型闭包的真正手段是 oxlint 的长函数/复杂度警告（存量警告即重构靶单）。
- **两道门禁共同的盲区**：`dep-direction.mjs` 与 `structure-budget.mjs` 都只从 `packages/<包>/src` 起扫，因此 **`packages/web/ui/src`（102 个文件，全仓最大的一块代码）既无行数预算、也无依赖方向检查**。它是 workspace 成员但不是被管辖的包；依赖方向由人工守（只允许 `@nova-agent/core` 的类型与纯数据形状 + React）。改这里时别指望 `pnpm gates` 兜住。
- **断言粒度**：测试断**契约与不变量**（宽度守恒、结构顺序、关键字段存在、降级行为），不断完整文案串——观感微调不该触发红测试。

## 7. 状态与开放问题

**版本现状**：包内已是 **0.4.0**（`core` / `ai` / `plugins` / `web` / `cli` 五个锁步包 + 根包；`qqbot` 独立在 **0.2.3**），但**磁盘上最后一个 tag 是 `@nova-agent/ai@0.3.0`——0.4.0 尚未打 tag**。按本项目「tag 即发行」的规矩它还没发行，发行前仍可继续并入改动。工作树有大量未提交内容。M1→M9 全部落地；**M10 与 M11 批4–批9 的 TUI 部分已作废**——TUI 两次重写后仍在拖累开发（渲染层与产品逻辑纠缠、TTY 归属接缝反复出洞、真机验收无法自动化），已整体删除，**形态收敛到浏览器 UI**（包数 8 → 6）。曾随 TUI 过时的文档一并删掉，**`docs/` 目录因此为空，不要再往里加会漂移的副本**。

**近期落地**（M11）：`core/kernel/` 内核层（`AgentSession` + `KernelEvent` + 审批桥 + `EventPump`）；`core/presentation.ts` 呈现意图词汇表；`packages/web` 零依赖 WS + launch-token 认证 + `WebController`；一切皆插件（`core/plugin/` 容器 + 能力服务缝 + roster 装配 + `plugins.disable`/`extra`）；WebUI 核心体验（`RunMeter` → `run_stats`、基线分页、工具行详情侧板、统计条、job 活动行）；换肤 = deepseek-harness 资产移植；模型端与模型座位；命令目录；以及一批由回归测试钉住的真 bug（审批答案在 publish 内同步到达被吞导致 run 挂死、事件泵里抛错的监听器杀掉进程、`prompt()` 先入内存后落盘、`gateCompact` 被 `running` 守卫挡死导致自动压缩从未生效、`applyReady` 清空会话列表导致面板永停加载态、详情板硬编码 `idle: true`、`vitest.config.ts` 漏收 `*.test.tsx` 导致零测试、`clampFontSize()` 因 `Number(null)===0` 把首次访问夹成 12px）。

1. **OpenAI 兼容接口缓存语义不一致**：DeepSeek 自动前缀缓存、部分网关需显式参数。已落地 usage/命中率统计；按 provider 的能力探测表留待后续。
2. **外部插件加载**：`plugins.extra` 已可加载本地路径/包名模块；尚无 registry 与 git URL 安装。
3. **容器化建议**：v1 不做进程沙箱，重隔离建议容器化运行（bash/PTC 的信任姿态等同「执行任意命令」）。
4. **浏览器面是唯一富界面**：好处是「一个内核、一处呈现」；风险是无浏览器/纯远程终端时只剩 readline REPL（`--repl`）——它是有意保留的最低保障，不是待补的产品面。
5. **`AgentSurface` / `surfaces` 键尚未接上**：core 声明了公共 surface 契约与 `surfaces` 服务键，但真实装配走 cli 的 `SURFACES`。当前不构成缺陷（cli 注册表工作正常），但**「第三方 surface 只依赖 core/plugins 公共 API」目前是意图而非事实**——第三方事实上要照抄 cli 的 `SurfaceEntry` 形状。
6. **前端源码在门禁之外**：`packages/web/ui/src`（102 文件，全仓最大）无行数预算、无依赖方向检查（§6），也是唯一没有结构棘轮兜底的代码。
7. **`kernel/model.ts` 注释提到不存在的 `AgentSession.setModel`**（真实方法为 `announceModel`）：纯注释 bug，尚未修。

## 8. 版本与发布（SemVer 2.0.0）

版本号遵循 **Semantic Versioning 2.0.0**（<https://semver.org/lang/zh-CN/>）。规范第 1 条要求升位必须有公共 API 判据——本节即**本项目的公共 API 定义**。

### 公共 API 面

凡改变以下任一面的可观察行为或签名，即为公共 API 变更；未列入清单的内部实现（模块私有函数、错误文案、事件内部字段等）不构成版本约束。

1. **CLI 用法与参数**：`nova` / `nova exec` / `nova qqbot` 的全部 flags 与形态（`--web` / `--repl` / `--resume` / `--approval` / `--theme` / `--json` / `-v` / `-h` 等）、`--json` 事件流 schema、进程退出码。
2. **配置 schema**：`~/.nova/config.json` 的字段名、类型与语义（§3 清单，含 `{env:NAME}` 引用形式与 `plugins.disable` / `plugins.extra` 的加载语义）。
3. **JSONL 会话日志 v2 格式与投影语义**：`SessionEvent` 的 9 个事件类型（`message` / `compaction/*` / `todo/write` / `approval` / `workspace` / `code-dispatch` / `run/stats`）、字段结构、`deriveMessages()` 投影规则、压缩语义。
4. **插件 API**：`PluginContext`（`registerTool` / `registerCommand` / `registerHook`）、`ToolDefinition`（含 `presentCall` / `presentResult` / `preview`）、`ToolExecuteContext`、钩子签名、审批档位与 `permission` 声明；**容器公共面**（`Context` / `ctx.provide` / `key<T>()` / `ctx.on` / `ctx.effect`）与 `plugins.extra` 能加载的插件形态（`{ name, activate(ctx) }`）。
5. **内核协议（surface 契约）**：`AgentSession` 句柄的方法集（24 个成员）、`KernelEvent` 的 25 个变体与字段、`Kernel` 的成员（含 `models?` / `commands` / `runCommand` / `roster()`）、`AgentSurface` 与 `AgentSurfaceKernel` 接口、`createAgentKernel` 的装配签名、10 个能力服务键与 4 个事件键——凡实现一个 surface（官方或第三方）所依赖的都是公共面。
6. **各 `@nova-agent/*` 包公开导出**：每个包 `exports` 只有 `"."`。`core`（`export *` 桶：agent 循环 / 消息模型 / 会话 / kernel 句柄与事件协议 / 审批与呈现词汇表 / 插件容器；**`session-peek.ts` 不在其中**）、`ai`（`client` + `sse`）、`plugins`（容器门面 / 审批 / 内置工具 / 命令目录与 runner / 内核装配；`fs.ts` 与 `bash.ts` 只做**窄化具名再导出**）、`web`（surface 后端与帧协议：`list_models` / `set_model` / `command` / `load_earlier` / `load_trace` 客户端帧与 `parseClientFrame` 判据、`models` / `state` / `sessions` / `ready` 的字段、`server.ts` 的静态缓存策略）、`qqbot`（渠道插件示范）、`cli`（`config` / `surfaces` / `command-runner`——**`"."` 是 bin 脚本，零 export**）。

### 升位映射

| 变更类别 | 判定 | 升位 |
| --- | --- | --- |
| 不兼容 | 破坏以上任一 API 面的行为或签名（如日志 v2→v3、插件钩子签名变更、删除一个 surface 形态） | 升**次版本**（0.y.z 期）/ 主版本（1.0.0 后），并在 changeset 正文里点名迁移方式（生成的 `CHANGELOG.md` 即发行说明） |
| 向后兼容新增 | 新增 flag / 字段 / 工具 / 导出，既有行为不变 | 升**次版本** |
| 仅修正 | 只修复错误结果，公共 API 面不变 | 升**修订号**（x>0 时） |

### 发布流程（changesets）

- monorepo **fixed 锁步组**：5 个 `@nova-agent/*` 工作区包（`core` / `ai` / `plugins` / `web` / `cli`）恒一致、共享单一版本号（`.changeset/config.json` 的 `fixed` + `privatePackages: { version: true, tag: true }`、`access: "restricted"`）；`qqbot` **刻意留在组外**（第三方插件示范，按自身改动独立升位）。根包 `nova-agent` 是 private 且非 workspace 成员，由 `scripts/sync-root-version.mjs` 在 release 中读 `packages/cli/package.json` 同步。**锁步组与磁盘上的工作区包必须一致**：`cli/test/version.test.ts` 从磁盘发现包并校验——组里写了不存在的包会让 `changeset version` 直接失败。
- 每项面向用户改动提交一份 changeset（`.changeset/*.md`，标注 minor / patch）。**变更集在发行前可合并**：被后续重写取代的条目应并入取代它的那一条，而不是留成悬空记录。
- 发行：`pnpm changeset` → `pnpm changeset version` → 提交 → `changeset tag` → `pnpm release` 一条龙。
- **已发行版本内容不可变**（规范第 3 条）：绝不 amend / 移动既有 tag；一切修改以新版本向前发行。
- tag 形式：附注标签 `vX.Y.Z`——v 前缀是 tag 名，版本号本体为无前缀的 `X.Y.Z`。

### 0.y.z → 1.0.0 门槛

当前处于 **0.y.z 初始开发阶段**：基线 `0.1.0`，每次发行递增次版本号。升至 **1.0.0** 的判据：软件用于正式生产环境、且上述公共 API 六面稳定（变更频率从「随时可能」降至「仅经慎重评估才破坏」）。`0.y.z` 期的每次发行均视为完整发行——遵守不可变 tag 规则、有 changeset 记录、可回溯。
