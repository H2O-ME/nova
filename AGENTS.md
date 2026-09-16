# AGENTS.md — NovaAgent

> 本文件是仓库的**唯一权威文档**（同时面向人类与 AI 编码 agent）。`README.md` 是门面页——含 `assets/readme/` 下的 hero 与三张架构 SVG 视觉总览（机制变更时同步重绘）；所有设计目标、架构、命令、约定、里程碑都以此文件为准。文档随实现同步更新——改机制就改这里。

## 1. 这是什么

自研、插件化、轻量化的跨平台本地智能体框架。一个在**当前工作目录**运行的 agent CLI/TUI：通过任意 OpenAI 兼容端点对接模型，以"一切皆插件"的内核统一扩展工具、斜杠命令、生命周期钩子与 Skills。所有数据（配置/会话/缓存/技能）集中在 `~/.nova/` 下，**运行目录零写入**。

- **运行时**：Node.js ≥ 20（LTS）；PTC 代码模式额外要求 ≥ 22.19。
- **语言/工具链**：TypeScript（strict）、ESM-only；构建 `tsdown`，测试 `vitest`，lint `oxlint`。
- **平台**：Linux / Windows 为测试目标（macOS 顺带兼容）。所有路径走 `node:path` + 独立抽象层，**禁止硬编码 `/` 或 `\`**。
- **参照系**：pi（分层包结构 + 差分渲染 TUI）、deepseek-harness（一切皆插件 / 组合式内核）、openai/codex（AGENTS.md / 审批与沙箱 / 可回放会话日志）。`.reference/codex` 是 vendored 的 codex 源码，仅供查阅，**不属于本项目、不要改动**。

## 2. 常用命令

```bash
pnpm install
pnpm build        # 各包 tsdown 构建到 dist
pnpm dev          # tsx 直跑 cli（免构建，改完即生效）
pnpm test         # vitest run（ai 层注入 fetch + SSE fixture，不发真实请求）
pnpm typecheck    # tsc --noEmit（逐包）
pnpm lint         # oxlint packages（含 complexity/max-depth/长函数 warn）
pnpm gates        # 结构棘轮：依赖方向 + 单文件行数预算（只降不升）
pnpm gates:update # 重构收缩文件后拧低行数预算（绝不调高）
pnpm check        # 本地快环：lint + gates + 变更相关测试（秒级，随手跑）
pnpm verify       # 全环：build + typecheck + test + gates（提交前跑）
pnpm nova         # 交互运行（TTY 下全屏 TUI；非 TTY 自动回落 readline；--repl 强制 readline）
pnpm changeset    # 写变更集（面向用户改动的 minor/patch 记录）
pnpm release      # changeset version + sync root version + commit + tag 一条龙
```

> ⚠️ `nova` / `pnpm nova` 跑的是 **`packages/cli/dist`**，不是源码。改完 `src` 必须 `pnpm build` 才生效（`pnpm dev` 走 tsx 直读源码，免构建）。

全局安装：`cd packages/cli && npm link` → 任意目录直接 `nova`；改代码后重新 `pnpm build` 即生效。

`nova` 的形态：

- `nova` → 交互 TUI / readline。
- `nova -- --approval auto-edit` → 临时覆盖审批档位。
- `nova -- --resume ~/.nova/sessions/<YYYY/MM/DD>/<id>.jsonl` → 续接历史会话。
- `nova qqbot` → QQ 机器人模式（需配置 qqbot.appId/clientSecret；对端独立会话、never 审批）
- `nova exec "<task>" --json` → 非交互单次执行（JSONL 事件流，CI 友好，可管道传入任务；无法交互确认，未放行的审批请求自动拒绝）。`--json` 下 AgentEvent 之外另有两类控制行：`{"type":"run_error","message":…}`（运行失败）与 `{"type":"notice","text":…}`（自动压缩/熔断告警等运维提示）；SIGINT 改为优雅中止（后台 job 走 dispose，不孤儿）。

## 3. 配置（唯一来源 `~/.nova/config.json`）

项目目录里不需要、也不会产生任何 `.nova/` 文件。`apiKey` 支持 `{env:NAME}` 引用环境变量，避免明文密钥进仓库。配置 schema **严格校验**（0.2.0 起）：未知键（如拼错的 `apporval`）会在加载时报错并点名该键，而不是静默忽略。

```jsonc
{
  "provider": {
    "baseURL": "https://api.example.com/v1",
    "apiKey": "sk-...",              // 或 "{env:MY_KEY}"
    "model": "model-name",
    "temperature": 0.7,               // 可选：采样温度透传
    "maxTokens": 8192,                // 可选：透传 max_tokens
    "contextWindow": 200000           // 可选：上下文窗口兜底（缺省自动查 models.dev）
  },
  "approval": "read-only",            // read-only | auto-edit | full
  "notify": true,                     // 可选：系统通知（审批/长任务完成/出错弹 toast），NOVA_NO_NOTIFY=1 亦可关闭
  "systemPrompt": "补充指令…",         // 可选：附加用户指令，注入会话首条上下文片段（不替换内核系统提示，前缀缓存不受影响）
  "maxTurns": 30,                     // 可选：单次任务最大轮数（默认 30，上限 500）
  "autoCompactTokenLimit": 60000,     // 可选：上轮 prompt tokens 超限自动压缩会话
  "ui": { "theme": "dark" },          // 可选：界面主题 dark（默认，观感与引入主题层前一致）/ light（亮背景）/ plain（无色）；NO_COLOR 恒定无色
  "qqbot": {                           // 可选：nova qqbot 模式凭据（q.qq.com 管理端获取）
    "appId": "xxx",
    "clientSecret": "{env:QQBOT_SECRET}"
  },
  "tools": {
    "bash": { "enabled": true, "timeoutMs": 60000, "shellPath": "C:/Program Files/Git/bin/bash.exe" },
    "code": {                          // 可选：PTC 模式（native|ptc|both，缺省 native）
      "mode": "ptc",
      "maxParallelSubCalls": 10,       // 可选：单 run_code 内并行子调用上限
      "computeMs": 30000,             // 可选：CPU 时间预算（busy-time）
      "maxWallMs": 60000,             // 可选：墙钟预算
      "maxOutputBytes": 1048576,      // 可选：stdout/stderr 输出上限
      "maxOldGenerationSizeMb": 256   // 可选：堆内存上限
    }
  }
}
```

Skills 放 `~/.nova/skills/<name>/SKILL.md`（用户级）或项目级 `.nova/skills/`（只读发现，项目级优先），frontmatter 仅 `name` / `description`。

## 4. 架构

pnpm monorepo，依赖方向强制单向（`pnpm gates` 机检）：`cli → {tui, tui-view, plugins, ai, qqbot, core}`，`qqbot → {plugins, core}`，`tui-view → {tui, core}`，`plugins → core`，`ai → core`（仅类型），`core`/`tui` 不依赖任何上层包。

| 包 | 职责 | 关键文件 |
| --- | --- | --- |
| `core` | provider 无关的 agent 循环（async generator 事件流）、append-only 消息模型、会话持久化与投影、工具调度、token 预估、请求级修剪（snip/micro）、后台 jobs | `agent.ts`、`session.ts`、`estimate.ts`、`request-trim.ts`、`jobs.ts`、`types.ts`、`ids.ts`、`tools/get-time.ts`（M1 demo 工具，仍在发布） |
| `ai` | OpenAI 兼容手写客户端：fetch + SSE 流式、工具调用、重试与断流自愈（Retry-After 双形式严格解析 + 自有退避 32s 封顶）、usage/缓存命中提取 | `client.ts`、`sse.ts` |
| `plugins` | 微型插件容器（工具/命令/钩子/服务注册 + 钩子组合）、权限审批、内置工具、skills、PTC 代码运行时 | `host.ts`、`permission.ts`、`types.ts`、`builtin/{fs,bash,jobs,todo,search,search-worker,index}.ts`、`skills.ts`、`ptc/{run-code,code-runtime,worker,sdk,json}.ts` |
| `tui` | 零依赖终端原语：行级差分渲染（可选 ?2026 同步输出）、原始按键解码（含 SGR 鼠标：滚轮 + 左键点击坐标、CSI 修饰键参数）、CJK 宽度处理、终端能力探测 | `screen.ts`、`keys.ts`、`width.ts`、`caps.ts` |
| `tui-view` | TUI 纯视图层（零终端 IO）：tokens 常量、调色板/标签、裁剪族、工具行、状态栏、弹窗、composer、reasoning、间距、开屏 | `tokens.ts`、`palette.ts`、`theme.ts`（语义主题层）、`labels.ts`、`text.ts`、`clip.ts`、`tool-lines.ts`、`status-view.ts`、`popups.ts`、`composer-view.ts`、`reasoning-view.ts`、`spacing.ts`、`splash.ts`、`smooth.ts` |
| `cli` | 产品壳：全屏 TUI + readline 回落 + 非交互 exec + 配置发现 + 模型元数据 | `tui-mode.ts`（~1541 行壳层：生命周期/IO/agentTurn 事件归约）、`tui/{store,keys,frame}.ts`（TuiStore/按键责任链/帧装配）、`tui/{turn-projector,subagent-lives}.ts`（轮次投影状态机 / 子代理活行与后台行状态机）、`session-runtime.ts`（三 runner 共享启动工厂 + buildHost 宿主装配单源）、`auto-compact.ts`（统一 TokenGate + 无头 wrapHeadlessAutoCompact）、`runner-shared.ts`（计时/maxTurns/审批/自动压缩编排/runAgent 公共 kwargs 装配）、`runner-loop.ts`（四 runner 事件消费簿记单源：日志追加/usage 锚点/中断归类/toast）、`command-core.ts`（斜杠命令逻辑核：repl/TUI 共用公式与序列）、`exec.ts`、`repl.ts`、`compact.ts`、`config.ts`、`context.ts`、`system-prompt.ts`、`agents-md.ts`、`sessions.ts`、`commands.ts`、`model-meta.ts`、`markdown.ts`、`notify.ts`、`version.ts`、`spinner.ts`、`ui.ts`+`statusbar.ts`+`composer.ts`+`popup.ts`+`reasoning.ts`（5 个 tui-view 转发门面）；`scripts/sync-root-version.mjs`（根包版本同步） |
| `qqbot` | QQ 机器人接入插件（第三方插件编写示范，只依赖 core/plugins 公共 API）：WebSocket 网关状态机、token 管理、REST 发消息、`qqbot_send` 工具、通道装配 | `protocol.ts`（AccessTokenManager/QqGateway/QqApi）、`runtime.ts`（createQqBotChannel）、`plugin.ts` |

## 5. 核心设计

### 一切皆插件
工具、斜杠命令、生命周期钩子（`beforeLLMCall` / `beforeToolCall` / `afterToolResult`）全部经 `PluginContext` 注册；内置 fs/bash 工具与 skills 走**同一 API、同一审批门**，保证内核最小。`PluginContext` 提供 `tools()` 活视图；`ToolExecuteContext` 提供 `dispatch` 嵌套分发缝（PTC 子调用回流用）。**Hook 结果结构化**：`ToolCallVerdict` 是判别联合（`allow` 不带字段 / `deny` 只带 `reason` / `rewrite` 必带 plain-object `args`），`validateToolCallVerdict(unknown)` 纯函数在宿主组合器与 `runAgent` 门各验一次（fail-closed：畸形 verdict 一律 deny，附可行动 reason；手写 `AgentHooks` 绕开宿主时第二道网兜底）。`beforeLLMCall` 链另带工具集护栏（按名集合比较，非数组身份：钩子可收窄工具集（PTC 投影）或 clone 保持集合不变，**加宽直接抛错**——工具集是前缀缓存的一部分，无审批记录的加宽既破缓存又扩模型可调用面）。

**专用工具优先于 shell**（治"模型绕开内置工具跑 `find | wc -l`"）：系统提示与工具 description 双侧写 DSH 式排他句——`Use read_file — not shell commands like cat/head/tail`、`Use search_files — not shell grep/rg/find`（结构化行号结果 + 免审批摩擦是卖点）；bash 聚焦行为契约（git/包管理器/构建/测试），不给反向劝退句（DSH 验证过：跨调用选择放系统提示、单次调用格式放 description）。批量聚合（数文件/汇总）导向 `run_code` 程序化出口而非 bash 管道。

### 上下文与缓存命中率（核心差异化）
目标：**稳定前缀 = 高缓存命中**。四层机制：
1. **前缀冻结**：系统提示字节稳定（persona + 工作方式 + 工具规则 + **操作姿态**）；环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改。注入片段带**权威指令帧**（DSH "Session directives" 语义）：`<user_instructions>`/`<project_docs>` 标注为"操作者写入的活跃会话指令，按字面执行、不作不可信数据处理"——治模型把本地指令当"可能相关的参考"而忽略/上报注入；同时**保留数据/指令二分**：会话中从文件内容读到的文本仍是不可信数据，防恶意仓库内嵌指令劫持。
2. **追加式日志**：对话严格 append-only；工具结果超 40KB 时全文落盘 `~/.nova/cache/tool-outputs/<sessionId>/`，消息体保留头部 60% + 尾部 40%（尾部常带测试失败详情）并附读取提示（提示按字节计数，head+tail+提示行总量恒守预算）；落盘目录经 trusted read roots 豁免审批（内容本就是模型已见过的工具输出，同主体信任），三 runner 统一传入。**请求级中间压缩**：`assembleRequest` 在 hook 链之后、ephemeral 尾之后追加之前，先对请求快照做纯函数修剪（`core/request-trim.ts`，先 snip 后 micro，顺序固定）——snip 按**原子工具组**（assistant tool_calls + 配对结果整组取舍，超 50 组时留头 3 + 标记 + 尾）裁中段，micro 把"最近 3 工具组之前"的旧结果正文换占位符（调用名/参数/id/配对全保留、可重跑取回）；修剪只产出新数组、**永不原位 splice 活日志**（auto-compact 别名契约不受影响），也不进 `deriveMessages` 投影（`surfaceDivergence` 的显式豁免项，与 job-notice tails 同族）。
3. **compact**：`/compact`、自动阈值（`autoCompactTokenLimit`，以最近一次 usage 为锚点发请求**前**预判）共用同一实现；压缩**原位追加** `compaction/start → summary → end` 三事件，模型可见面由 `Session.deriveMessages()` 投影重建，原始历史永不改写；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）。摘要请求以序列化裁剪后的 transcript 发送，已有摘要时走增量合并（嵌入 ask 的 `<previous_summary>` 只含摘要本体，剥掉自附的存档指针家具）。**压缩保真**：摘要提示词为 codex 式七节结构（任务/进展/决策与原因/现状/问题/下一步/引用）、**无字数上限**（细节优先——丢细节的代价是昂贵的重新发现）；摘要输入的工具结果按 4000 字符/条截断；保留预算 32k 字符、**纳入纯文本 assistant 回复**（带 `tool_calls` 的不单独保留，防结果消息落单）。**全文存档**：压缩前的完整 transcript（未截断）落 `~/.nova/cache/tool-outputs/<sessionId>/pre-compact-*.txt`（trusted read root 内，`read_file` 免审批），摘要尾部附 `<archive>` 指针并指引模型按需分段回查，增量压缩收割旧指针链式引用更早存档；存档为 best-effort，失败不阻断压缩。**token 预估计入 assistant 的 tool call 参数**（`rawArgs`，PTC/bash 大程序曾是估算盲区），`estimateMessageTokens` 带 `WeakMap` 记忆化（消息 append-only 不可变，exec 每请求全量重估不再重复计价）。保留片段取**整条消息取舍**（最新优先、首条放不下即停，不截断——截断拷贝会同时破坏投影字节一致契约与预算上限）。exec 的轮内预检逐请求全量估算，并带**熔断**：一次压缩后仍超阈值（保留片段 + 工具 schema 构成下限）即停用本任务后续自动压缩并告警一次，避免每轮白烧摘要请求、日志被压缩三事件刷屏；同时校验原位压缩的 messages 别名契约（插件钩子若替换数组则告警停用而非静默失效）。`compaction/summary` 事件除位置索引 `keep` 外同写 `keepIds`（消息 id）：投影**优先按 id 解析**（中段损坏行不再让恢复面错位，id 缺失的损坏消息直接省略），旧日志无 keepIds 时回退位置索引。
4. **供应商对齐**：请求携带 `prompt_cache_key` 与 `x-session-id`/`x-session-affinity` 会话亲和头（sessionId=会话 id），让网关把同一会话固定路由到同一缓存节点。指标目标：会话第 3 轮起 prompt cache 命中率 ≥ 90%（`/session` 可查）。

> **工具数组顺序**：主工具数组发给 provider 前按**工具名字典序稳定排序**（`client.ts`，不改动调用方传入数组）——即使同一会话中途禁用 bash 或切换 code mode 导致注册顺序重排，工具槽位顺序也保持稳定，不再破坏 provider 侧的前缀缓存。PTC SDK binding 亦按 schema 字典序生成（`sdk.ts`，字节稳定）。

### 会话日志 v2（不可变事件流 + 投影）
JSONL 从裸消息升级为事件流（`message` / `compaction/*` / `todo/write` / `approval` / `code-dispatch` 审计）。压缩不重开会话；v1 旧会话打开时原子升级。`appendEvent` 先写盘后入内存——写失败时内存与磁盘不再发散。**抗损坏**：进程被杀导致的末尾半行在 `Session.open` 时自动截断修复（不告警），中段真损坏行跳过并告警——单条坏行不再让整个会话无法 resume。

### 审批与权限（轻量版，对标 codex）
三档：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）。execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 按**命令程序前缀**记忆（`git status` 放行后续 `git ...`，不波及 `rm`），其余按工具名+类型记忆（REPL 提示与 TUI 审批弹窗对 execute 类展示该粒度说明，只提示不改行为）；asker 抛错一律拒绝（fail-closed）；exec/CI 走服务内 `never` 策略确定性拒绝；ask 路径的每次决定写入 `approval` 审计事件（log-only，可回放；自动放行不记事件，防只读工具刷屏）。审批弹窗上方实时渲染 `edit_file` 的 `- 旧行 / + 新行` diff、`write_file` 的目标+首行预览（工具经可选 `preview(args)` 声明；`edit_file` 多命中未设 `replace_all` 时预览直说"执行将报错"而非谎称替换）。

### 工具执行
- **文件工具硬化**：`write_file`/`edit_file` 越界检查跑在 **realpath 规范化路径**上（堵死符号链接跟穿逃逸）；写用同目录 tmp + rename 原子替换；`edit_file` 带陈旧检测（读后被外部改动则拒绝）；`read_file` 有 8 MiB 上限与二进制探测。
- **并行执行**：工具可声明 `isConcurrencySafe` 纯同步分类器，相邻多个 opt-in 调用整段并行（审批仍逐个串行），结果按原调用顺序写入保持确定性；并行段用 `Promise.allSettled` 收敛避免 unhandledRejection。`read_file`/`list_dir`/`search_files`/`jobs`/`todo_write` 默认并发安全。工具可声明 `timeoutMs` 协作超时。
- **输出截断防御**：`finish_reason=length` 的截断消息中**所有 tool call 一律不执行**（流式参数可能静半截），整批以错误结果回填让模型重发。
- **search_files**：`content_regex`（逐行正则，返回 `path:line: text`）与 `name_glob`（工作区相对路径 glob）二选一；默认跳过 `.git`/`node_modules`/`dist` 与点目录、绝不跟随符号链接、单文件 1 MiB 扫描上限、结果数上限（默认 200）。**回溯隔离**：`content_regex` 先经宿主预检（长度 ≤512、量词总数 ≤32、嵌套量词组拒绝并给改写建议），再进**全新 worker 线程**执行（name_glob 的 glob 正则由我方生成、无回溯风险，保持进程内）；墙钟预算默认 30s、中止信号透传 `terminate()`，spawn 不可用（源码世界无类型剥离）时回落进程内——预检仍生效。构建经 tsdown keyed entry 产出 `dist/search-worker.mjs`（源码/构建双世界路径解析，镜像 PTC worker 模式）。

### PTC / Code Mode（对标 Cloudflare/dsh run_code 简化版）
`tools.code.mode` 三态 `native|ptc|both`（`PtcMode` 类型定义在 core——config/host/纯视图层共用，避免 tui-view 跨层依赖 plugins）。开启后模型获得 `run_code {code, description}` 传输工具：写一段 async TypeScript 程序，`await tools.name(args)` 即子调用，**穿过与原生调用完全相同的管线**（审批门 + 钩子 + 超时/中断，经 `ctx.dispatch` 回流）。只有程序 print/return 的策展输出进入上下文，中间结果只落 `code-dispatch` 审计。执行基底是**每 run 全新 worker 线程**（信任姿态等同 bash）：剥型、空环境、堆/busy-time/墙钟/输出四类预算、端口协议逐字段防御。SDK 声明由 schema 字典序生成（字节稳定不吃缓存）。`ptc` 态只暴露 `run_code`。需 Node ≥ 22.19。

### Subagent（隔离子代理，dsh 设计简化版）
`subagent` 工具（session-runtime 默认装配，全部 runner 可用）：嵌套 runAgent 跑**全新消息面**（上下文隔离——子代理看不到父对话，prompt 必须自包含），最终 assistant 报告作为工具结果回流父会话（父日志保持 "model-visible means logged"；子代理自身对话是瞬态、不落盘）。嵌套工具集活读取并**过滤 subagent 自身**（结构性禁止递归）；透传父 abort signal 与**同一 hooks 链**（嵌套调用走与父相同的审批门与管线）。**编排姿态**（系统提示 + 工具描述 + 嵌套 `SUBAGENT_POSTURE` 三层注入，codex 经验）：子代理是上下文隔离工具而非默认工作流——默认 1–2 个只读侦察、brief 不重叠、报告给 `path:line` 证据指针；设计/复杂实现留在主代理（子代理无父对话上下文、普通推理水平），简单查找不派发，多代理不重复检索；嵌套报告首行约定 `complete/partial/blocked`。

### 工作区切换（switch_workspace）
模型可在任务中要求切换工作区根（"去另一个仓库处理"）：第一方 `workspace` 插件（opt-in）校验目标目录（realpath + isDirectory）后经 runner 回调重建工具宿主——fs/bash/search 根、技能列表、环境片段 cwd 一致重指；新根自下一次工具分发/下一轮生效。TUI 与 /session 会话切换共用 `applyWorkspace` 通道；exec 不启用。安全护栏：记录的工作区指向 `~/.nova` 数据目录时拒绝应用（会话被误建在数据目录内不会拖走工具根）。

### 后台 jobs / todo
`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，`jobs` 工具（list/output/stop）读写增量输出。`startBackground` 镜像 `runOnce` 的 settle 防御：`exit` 事件记退出码 + 2s `closeGrace`，`cancel()` 后 3s `killSettle` 兜底，settle 前销毁 stdio 管道——taskkill 后孙进程持有管道时 `dispose()` 不再卡死进程退出。job 自然结束（completed/failed）时，**下一次 LLM 请求会自动注入一行"bash-N 已完成"通知**（`runAgent` 每次发请求前经 `JobRegistry.drainFinished()` 取队列，以克隆消息数组追加临时 user 消息——不落会话日志、不破坏投影不变量，每个 job 只通知一次；**送达性为至少一次**：请求在回复提交前失败/中断时经 `requeue()` 回队，下个请求重播，不会静默丢失），模型无需空转轮询；显式 stop 导致的 killed 不通知（模型已知）。`JobKindMap` 预留 `subagent` 扩展位。`todo_write` 整表替换、last-write-wins，快照持久化为 log-only `todo/write` 事件，不占模型上下文。**计划失活提醒（stale-todo nag）**：`runAgent` 按 assistant 工具轮计数（同轮多调用计 1，纯问答轮不计），连续 3 轮无 `todo/write` 快照时下一次请求注入一行 ephemeral 提醒（与 job 通知同一请求级通道：clone 尾追加、不落日志、不进压缩投影、未送达则重 arm；触发后计数清零）。检测键为持久化会话事件而非工具名——deny/参数失败等未落快照的轮按失活计。

### Skills（渐进加载）
启动只把每个 skill 的 name+description 注入索引，命中触发词时才加载正文——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发。项目级 `.nova/skills/` 优先于用户级 `~/.nova/skills/`。

### TUI（自研差分渲染，codex 风格）
alternate screen + 行级 diff 重绘（React-free）；`/` 命令面板（↑↓ 选择、Tab 补全、输入历史）；审批弹窗（y/n/a）；PageUp/PageDown/滚轮滚动（上滚不改状态栏样式——常驻视图保持稳定，↓/滚轮回到底）；Ctrl+C 中断当前轮（空闲时两段退出）；多行 composer（粘贴保留换行、软换行最多 8 行窗口、↑↓ 行间移动）；**运行中消息队列**（轮进行中回车入队不拒绝——队列暗色 lane 常驻 composer 上方，本轮结束后自动下发队首，Esc 中断后接续发送）；流式 markdown（列表缩进 2 列挂圆点，换行续行对齐条目文本列）、工具调用折叠块、reasoning 定高活窗口（定格 2 行 + 活尾 1 行、每行裁到单一显示行绝不折行、空行不进窗——每个 delta 只重写活尾一行，整段不重排；结束后折成"已思考 Ns"、与答案同组紧排，轮内不留空行，**点击可展开思考全文**——▸/▾ 前缀为 affordance，全文仅存会话内存（reasoning 从不落盘，resume 后不可展开），展开正文逐行暗色、软折行走 gutter 预算）；长命令实时显示已耗时与输出尾行；系统通知（Windows toast / macOS osascript / Linux notify-send）。分层：`tui`（终端原语）→ `tui-view`（纯视图，零 IO）→ `cli/tui/`（`store.ts` TuiStore / `keys.ts` 按键责任链 / `frame.ts` 帧装配 / `turn-projector.ts` 轮次投影状态机——流式平滑、assistant/思考块生命周期、工具行形变、行动画、中断清场，假时钟 + `plainPalette` 可单测 / `subagent-lives.ts` 子代理接管活行与后台行状态机）→ `tui-mode.ts`（壳层：生命周期 + IO + `agentTurn` 事件归约的委派，块级投影一律走 TurnProjector；TUI 可变状态全部收敛在 TuiStore 实例里，壳层与按键链读写同一实例）；决策背景见 `docs/tui-design.md`。

**单行状态栏**三段式 `上下文仪表 │ 模型 · 执行模式 · 审批档位 │（右缘）tps · cache`——`│` 分大组、`·` 分组内，层级靠分隔符而非字数堆砌：
- **上下文仪表**：按整窗真实比例分段上色（提示词青 / 工具 schema 绿 / 注入片段蓝 / 技能索引品红 / 消息黄），加粗「已用/总量 · 百分比」，超窗标红；`压缩 %` 只在真正逼近阈值时出现（T0 常驻、T1 ≥50%、T2 ≥70%）。
- **空间不足按优先级整字段降级，绝不词中截断**：同一档位内**先丢瞬时提示**（中断/退出——它们只是锦上添花，不该把「已用/总量」挤出状态栏），再降档：T0 全量 → T1 去 `模式/审批` 标签、模型去供应商前缀 → T2 仪表只留条+百分比、审批降单字（读/编/全）、模型截断 → 极窄时弃模型名（banner 与 `/model` 已可见）。上滚**不进**状态栏：滚动位置从画面本身可见，状态栏样式恒定。右缘仪表组定宽不随 tick 变宽、百分比与数值 `padStart` 位数跳动不挪分隔符、截左不截右。
- **tps 速度表**：500ms×10 环形窗口，**会话级连续滚动**（发新消息不清空、无新输出不排空到 0），恒绿色（"是否在生成"由 composer 前缀 spinner 表达）。
- **cache 命中率**：取**会话累计**值且**粘住可见性**——provider 随机分流到不报缓存的后端会让单轮值抖动、整段闪现，故一旦本会话见过缓存上报就常驻，从未上报则整段隐藏。
- **模型元数据（models.dev）**：启动后台拉 `https://models.dev/api.json`，解析为精简目录落盘缓存（`~/.nova/cache/models-dev.json`，24h TTL，断网用旧缓存），按模型 id 精确→尾段匹配解析上下文窗口/模态/推理/工具/附件能力，喂给结构进度条分母；明细在 `/model` 面板与 `/session`。
- **执行模式**：新会话未开始时按 Tab 循环 普通 → PTC → 混合（rebuildHost 统一重绑 host+hooks；Node 不满足 22.19 时拒绝并保持原模式；区别见 `/mode`，切换不留历史行、状态栏模式标即时变化）。

**工具行单行预算**：工具行（运行/完成/分组）拿终端列数渲染，参数摘要吸收剩余宽度——但预算必须扣掉 gutter 缩进（`toolBudget() = cols-1-6`，wrapBlock 按 gutter 预算折行，行构建器裁进同一预算才不会把 ` · 行数 · 耗时` 尾巴顶成孤儿续行）——` · 行数 · 耗时` 尾巴恒留本行，不再折出孤儿续行。截断按**显示列数**而非字符数（CJK 计 2 列）：命令在参数边界切（`cd "…" && ls …`），路径切头保文件名（`…\manifest.json`）。只读分组行逐级收紧：折叠公共目录前缀（只出现一次）→ 收窄前缀保尾段（`…1.26.0_解压\`）→ 保留最近若干名字、省略处以 `…` 占位——计数由 `N 次` 后缀承载，不靠名字数。审批弹窗头部与 diff 预览同样按列裁剪，弹窗不折行。

累计 token 与分段明细在 `/session`，模态能力标在 `/model` 与 `/session`；`/session` 另报缓存浪费审计（missTokens，噪声底 1024 tok）并可作会话切换器（↑↓ 选择、Enter 恢复上下文并切回该会话创建时的工作区）。

### 数据落盘（codex 式，零工作区写入）
```
~/.nova/
├─ config.json              # 唯一配置来源
├─ skills/                  # 用户级技能（项目级 .nova/skills/ 只读叠加）
├─ sessions/YYYY/MM/DD/     # JSONL 会话（append-only，可回放，按日期归档，全局不分项目）
└─ cache/
   ├─ tool-outputs/<sessionId>/   # 工具输出溢出落盘
   └─ models-dev.json             # 模型目录缓存
```

## 6. 代码约定 / 在这里怎么工作

- **内置能力皆第一方插件**：新工具/命令/钩子走 `PluginContext` 注册，与第三方同 API、同审批门，别在 core 里开特例。
- **TUI 分层**：渲染计算 = 纯模块（`statusbar.ts`/`composer.ts`/`popup.ts`/`reasoning.ts` + `ui.ts`，帧快照入参、Palette 注入、`plainPalette` 可测）；`tui-mode.ts` 闭包壳只留定时器/终端 IO/状态突变，按键按责任链分层（审批 → 面板 → 全局 → composer），**轮内块投影一律进 `tui/turn-projector.ts`（定时器由壳层驱动，投影器不碰 setInterval）**。新交互先问能不能写成纯函数，能则不进闭包；只能在真机截图里发现的行为，多半说明它还长在投影器之外。
- **前缀字节稳定**：任何动态内容都注入会话首条 user 片段（append-only），绝不回改系统提示或旧消息——否则破坏缓存命中。
- **测试不联网**：三层测试体系——①**单元层**（纯函数，断言用 `plainPalette` 取无 ANSI 的确定字符串）；②**ai 层注入** `fetch` + SSE fixture（`client.test.ts` 覆盖流式 tool call 分片、中途断流、静默截断、reasoning、缓存字段、Retry-After 双形式/非法显式失败/自有退避封顶）；③**接缝集成测试**（M7.6 新增，守模块交接处而非实现细节）：`ai/test/pipeline.test.ts` 守 SSE→`OpenAICompatClient`→`runAgent` 全管道含 `finish_reason:"length"` 截断防御；`core/test/resume.test.ts` 守 save→`Session.open`→`deriveMessages`→新 `runAgent` 轮的投影一致性；`cli/test/frame-assembly.test.ts` 守 `flattenBlocks`+`wrapBlock` 帧组装无行超宽、rowMap 连续。④**投影状态机单测**（M7.12 新增）：`cli/test/turn-projector.test.ts` 与 `cli/test/subagent-lives.test.ts` 以假时钟 + `plainPalette` + 真实 `TuiStore` 驱动轮次投影——重试残留块、空白锚定、假活行、孤儿续行这些曾经的「截图病灶」从此有红测试可守。当前 **54 个测试文件 / 578 个用例**（`plugins/test/permission.test.ts` 专守 fail-closed 审批分支：非法答案/抛错询问器/`never` 短路/前缀与复合命令记忆；`core/test/agent.test.ts` 新增 stale-todo nag 组 5 条 + 请求级修剪接线 1 条：3 轮触发、快照清零、同轮多调用计 1、纯问答不计、length-cut 计失活、wire 收缩而日志完整；`core/test/request-trim.test.ts` 新增 snip/micro 纯函数 9 条：原子成组、孤儿结果独立、预算内原样返回、整组裁中段+标记计数、非法预算抛错、micro 占位/短结果亦换/调用形状保留；`ai/test/client.test.ts` 新增重试 6 条：HTTP-date 生效、非法值显式失败、退避封顶、parseRetryAfterMs 秒数/日期/缺失/非法矩阵；`plugins/test/plugins.test.ts` 新增 hook 结构化 4 条：畸形 verdict fail-closed、工具集加宽抛错、收窄放行、clone 同集合放行；`core/test/hooks.test.ts` 新增 loop 纵深防御 1 条）。
- **路径/跨平台**：一律 `node:path` + 抽象层；bash 工具 Windows 优先 Git Bash、回落 PowerShell 并强制 UTF-8。
- **文档即真相**：机制变了同步改本文件（README 只留门面）；里程碑详录归档 `docs/MILESTONES.md`，本文件 §7 只留现状一行。决策理由写进 commit message 与机制条目，不再有第三份笔记义务。
- **门禁与 verify 分层**：本地快环 `pnpm check`（lint + gates + 变更相关测试，秒级）随手跑；全环 `pnpm verify`（build + typecheck + 全量 test + gates）提交前跑。`pnpm gates` 两件套是**结构棘轮**：`dep-direction.mjs` 机检包间 import 方向（§4 白名单的事实化）、`structure-budget.mjs` 管逐文件行数预算（**只降不升**——大文件是历史债务不是许可，文件收缩后跑 `pnpm gates:update` 把预算拧下去，diff 即重构进度）。
- **断言粒度**：测试断**契约与不变量**（宽度守恒、结构顺序、关键字段存在、降级行为），不断完整文案串——观感微调不该触发红测试。lint 的 complexity/max-depth/长函数警告以现状校准（存量警告是重构靶单，增量违规必须处理）。

## 7. 里程碑与状态

**版本现状**：0.3.0 已发行；M1（agent 核心）→ M8.5（TUI 现代化）全部落地，M9（治理换血与结构棘轮）进行中。M1–M8.5 逐条机制与决策背景已归档 [docs/MILESTONES.md](./docs/MILESTONES.md)——本节只记现状与方向，不再膨胀。

**已移除**：MCP 客户端（`@nova-agent/mcp` 与 `/mcp`，M3 引入）——按实际场景裁剪，`nova` 不再读 `.nova/mcp.json`。

**后续（roadmap）**：按 provider 的缓存能力探测表、subagent 能力（`JobKindMap` 已预留）、token 逐节点定价、真多模态输入通路（image content parts，按 model-meta 的 image 模态门控，会话投影与估算同步）、长会话压测与 Windows 终端细节打磨。

## 8. 设计决策来源

| 来源 | 采纳 | 不采纳 |
| --- | --- | --- |
| **pi** | 分层包结构、扩展即代码、差分渲染 TUI | pi 无权限系统、依赖 npm → 改 pnpm + 内置轻量审批层 |
| **deepseek-harness** | 一切皆插件、monorepo + pnpm + tsdown、并行/审批/日志等六项改进 | 不引入 Cordis 本体，自写约 300 行微型容器 |
| **codex** | AGENTS.md 发现链、turn 内审批、可回放 JSONL 会话、非交互 exec | 不用 Rust；不做系统级沙箱（审批 + realpath 工作区边界代替） |

## 9. 开放问题 / 风险

1. **OpenAI 兼容接口缓存语义不一致**：DeepSeek 自动前缀缓存、部分网关需显式参数。已落地 usage/命中率统计与浪费审计；按 provider 的显式参数能力探测表留待后续。
2. **外部插件加载**：当前仅第一方内置插件；v1 计划支持本地路径 + git URL 安装到 `.nova/plugins/`，尚无 registry。
3. **容器化建议**：v1 不做进程沙箱，重隔离建议容器化运行（bash/PTC 的信任姿态等同"执行任意命令"；splash 已常驻提示）。

## 10. 版本与发布（SemVer 2.0.0）

本项目版本号遵循 **Semantic Versioning 2.0.0**（<https://semver.org/lang/zh-CN/>）。规范第 1 条要求版本升位必须有公共 API 判据——本节即**本项目的公共 API 定义**（文档侧；规范结语建议 README 同样声明，见 README 门面页）。

### 公共 API 面

凡改变以下任一面的可观察行为或签名，即为公共 API 变更；未列入清单的内部实现（模块私有函数、错误文案、事件内部字段等）不构成版本约束。

1. **CLI 用法与参数**：`nova` / `nova exec` 的全部 flags 与形态（`--approval` / `--repl` / `--resume` / `--json` / `-v` / `-h` 等）、`--json` 事件流 schema、进程退出码。
2. **配置 schema**：`~/.nova/config.json` 的字段名、类型与语义（§3 清单，含 `{env:NAME}` 引用形式）。
3. **JSONL 会话日志 v2 格式与投影语义**：事件类型（`message` / `compaction/*` / `todo/write` / `approval` / `code-dispatch`）、字段结构、`Session.deriveMessages()` 投影规则、压缩语义。
4. **插件 API**：`PluginContext`（`registerTool` / `registerCommand` / `registerHook`）、`ToolDefinition`、`ToolExecuteContext`、钩子签名（`beforeLLMCall` / `beforeToolCall` / `afterToolResult`）、审批档位与 `permission` 声明。
5. **各 `@nova-agent/*` 包公开导出**：`core`（agent 循环 / 消息模型 / 会话）、`ai`（客户端）、`plugins`（容器 / 审批 / 内置工具）、`tui`（终端原语）、`tui-view`（纯视图层）、`cli`（config / 上下文装配 / runner）的公开导出类型与函数。

### 升位映射

| 变更类别 | 判定 | 升位 |
| --- | --- | --- |
| 不兼容 | 破坏以上任一 API 面的行为或签名（如日志 v2→v3、插件钩子签名变更） | 记入 RELEASE-NOTES 后升**次版本**（0.y.z 期）/ 主版本（1.0.0 后） |
| 向后兼容新增 | 新增 flag / 字段 / 工具 / 导出，既有行为不变 | 升**次版本** |
| 仅修正 | 只修复错误结果，公共 API 面不变 | 升**修订号**（x>0 时） |

### 发布流程（changesets）

- monorepo **fixed 锁步组**：6 个 `@nova-agent/*` 工作区包（`core`/`ai`/`plugins`/`tui`/`tui-view`/`cli`）在 changesets fixed 组内恒一致、共享单一版本号（`privatePackages: { version: true, tag: true }`）。根包 `nova-agent` 是 private 且非 workspace 成员（changesets 无法对齐升版），由 `scripts/sync-root-version.mjs` 在 release 流程中读取 `packages/cli/package.json` 同步到同版本——最终 7 个 `package.json` 版本一致。
- 每项面向用户改动提交一份 changeset（`.changeset/*.md`，标注 minor / patch）；仓库根 `package.json` 只放 `"private": true`。
- 发行：`pnpm changeset`（写变更集）→ `pnpm changeset version`（统一升版 + 生成 CHANGELOG）→ 提交 → `changeset tag`（本地打附注 tag）→ `pnpm release` 一条龙。
- **已发行版本内容不可变**（规范第 3 条）：绝不 amend / 移动既有 tag；一切修改以新版本向前发行。
- tag 形式：附注标签 `vX.Y.Z`——v 前缀是 tag 名，版本号本体为无前缀的 `X.Y.Z`（规范 FAQ）。

### 0.y.z → 1.0.0 门槛

本项目当前处于 **0.y.z 初始开发阶段**（规范 FAQ）：基线 `0.1.0`，每次发行递增次版本号。升至 **1.0.0** 的判据：软件用于正式生产环境、且上述公共 API 五面稳定（变更频率从"随时可能"降至"仅经慎重评估才破坏"）。`0.y.z` 期的每次发行均视为完整发行——遵守不可变 tag 规则、有 changeset 记录、可回溯。
