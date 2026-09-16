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
pnpm lint         # oxlint packages
pnpm verify       # build + typecheck + test 一条龙
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

pnpm monorepo，依赖方向强制单向：`cli → {tui, tui-view, plugins, ai, core}`，`tui-view → {tui, core}`，`plugins → core`，`core` 不依赖任何上层包。

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
- **文档即真相**：机制变了同步改本文件（README 只留门面）。里程碑改动附决策说明。
- **提交前**：`pnpm verify`（build + typecheck + test）与 `pnpm lint` 全绿。

## 7. 里程碑与状态

**已交付**：

### 基线阶段（M1–M5）

- **M1 — Agent 核心**：agent 循环（事件流）、append-only 消息、工具调用闭环、结果超限落盘、JSONL 持久化/回放、缓存命中统计。
- **M2 — 插件与审批**：插件容器、权限三档 + always 记忆、内置 fs/bash 工具（realpath 边界 + 原子写 + 陈旧检测 + 跨平台 shell 探测）、core 三钩子点、`/plugins` 与 `--approval`。
- **M3 — Skills 与静态化**：Skills（双层发现 + `skill` 工具 + `/skill` + 渐进加载）、系统提示静态化 + 会话首条上下文片段、中断语义、命令补齐。
- **M4 — TUI 与压缩**：TUI（差分渲染）+ compact + 缓存指标（长会话流畅、命中率 ≥90%）。
- **M5 — 非交互 exec**：`nova exec`（`--json`、管道、审批自动拒绝）、AGENTS.md 逐层发现链、CLI 参数统一。

### 会话日志与工具硬化（M6–M6.9）

- **M6 — 日志 v2 与调度**：会话日志 v2（不可变事件流 + 投影压缩 + 孤儿锁 + v1 升级）、token 锚点压缩预判、并行工具执行 + 工具级超时、后台 jobs、todo 工具、审批收紧（前缀记忆 / fail-closed / never 策略 / 审计）、输出截断防御 + 缓存浪费审计。
- **M6.1 — 抗损坏与搜索**：日志抗损坏（末尾半行修复 + 中段跳行告警）、文件工具硬化（realpath 边界 + 原子写 + 陈旧检测）、`search_files`（content_regex / name_glob）、审批 diff 预览、exec 轮内自动压缩、并行段 `Promise.allSettled`。
- **M6.2 — PTC / Code Mode**：`run_code` + worker 运行时 + schema→SDK 生成 + `ctx.dispatch` 审批管线 + 审计 + 三态投影（native/ptc/both）。
- **M6.3 — 执行模式与可视化**：Tab 循环模式（rebuildHost 重绑）、单行三段式状态栏（按优先级整字段降级、tps 连续滚动恒绿、cache 会话累计粘住）、models.dev 模型元数据、`/model`/`/session` 能力展示。
- **M6.4 — Jobs 通知**：jobs 完成通知注入（替代轮询）——`JobRegistry` 终态通知队列 `drainFinished()` + `runAgent` 每次发请求前把"bash-N 已完成"作为临时 user 消息注入（克隆数组不落日志）；至少一次送达（失败路径 `requeue()` 回队）。
- **M6.5 — exec auto-compact 修复**：
  - **熔断**：压缩后仍超阈值即停用本任务后续压缩并告警一次（修复下限超阈时每轮一次摘要请求的风暴）。
  - **估算盲区**：`estimateMessageTokens` 计入 assistant tool call 的 `rawArgs`（此前 160KB 程序按 4 token 计）。
  - **通知送达**：`drainFinished()` 批次在请求失败时经 `requeue()` 回队。
  - 附带：原位压缩 messages 别名契约显式校验。
- **M6.6 — TUI 可测试性重构**（tui-mode.ts 2147 → 1714 行）：
  - 状态栏/composer/四弹窗从闭包抽为纯计算模块（帧快照入参 + Palette 注入，`plainPalette` 下可精确断言）。
  - `handleKey` 300 行 if 链拆为责任链（审批 → 模型面板 → 会话面板 → 全局键 → composer）。
  - TUI 表现层首次获得回归护栏（现 tui-view/test 95+ 条）。
- **M6.7 — TUI 显示缺陷修复**（真机截图驱动）：
  - **思考流式重排**：reasoning 活窗口裁到单一显示行，块高恒定、每个 delta 只重写活尾一行；空行不进窗口。
  - **低占比读数**：`used>0` 且四舍五入为 0 时显示 `<1%`（不挪分隔符）。
  - **列表缩进**：markdown `- ` 缩进 2 列挂 `·`，换行续行对齐条目文本列。
  - **轮内空行清理**：问题→已思考→答案三行紧挨成组，空行只存在于轮间。
  - **思考可展开**：点击「已思考」摘要 toggle 折叠/展开全文（SGR 鼠标 + 行→块映射命中）；全文仅存会话内存。
- **M6.8 — 工具行预算 + 提示词权威化**：
  - **孤儿续行根治**：`toolBudget() = cols-1-6` 与 wrapBlock gutter 预算一致。
  - **专用工具优先于 shell**：系统提示 + description 双侧写排他句。
  - **操作姿态**：系统提示新增 Operating posture 节；`<user_instructions>`/`<project_docs>` 改为权威会话指令。
- **M6.9 — 全链路缺陷批修**（14 项，P1+P2+P3）：
  - P1：后台 job kill 兜底；REPL 审批 Ctrl+C 取消；`content_regex` worker 隔离。
  - P2：压缩保留改整条取舍；落盘读取豁免审批；截断提示恒守预算；工具耗时改 per-call Map。
  - P3：tool_call_delta index coerce；`appendEvent` 先写盘后内存；`estimateMessageTokens` WeakMap 记忆化等。

### TUI 精修（M7.0–M7.4）

- **M7.0 — TUI 结构重组**（观感不变）：
  - 新包 `@nova-agent/tui-view`（纯视图零 IO）；`ui.ts`/`statusbar.ts`/`composer.ts`/`popup.ts`/`reasoning.ts` 收为转发门面。
  - `cli/tui/`：`store.ts`（TuiStore）、`keys.ts`（责任链六层）、`frame.ts`（wrapBlock/展平）。
  - `runner-shared.ts`：三 runner 共享 `ToolTiming`/`maxTurnsHint`/toast/审批装配。
  - 动画归一 + 开屏改 `buildSplash`；测试 95 条随模块迁入 `tui-view/test/`。
- **M7.1 — TUI 间距与思考呈现优化**（真机截图驱动）：
  - **间距体系统一**：轮间 1 空行、轮内 0 空行紧凑成组。
  - **思考展开视觉层次**：软折行续行带 `│` 引用 lane，卡片末尾补呼吸行。
  - **定格行语义保全**：`clipToWidth` 截头保语义；`flattenBlocks` 接入 `blocksVersion` 脏检查缓存。
  - `tui-mode.ts` 删减 350+ 行重复按键逻辑，委派 `keys.ts`。
- **M7.2 — TUI 思考单行化 + 间距 cell 化**：
  - 流式期只留一行 `⋯` 瞬态占位，delta 全进内存 buffer（20 万字符裁尾），fold 时折成 `▸ 已思考 Ns`。
  - `flattenBlocks` 在展平层给每个非空块补边距，排版从"分支自觉"变为"契约保证"。
- **M7.3 — TUI 思考自动展开/折叠**：流式期自动展开（`REASONING_LIVE_MAX_ROWS=8` 上限），思考结束自动折叠为 `▸ 已思考 Ns`，全文转内存详情供点击展开。
- **M7.4 — 多行粘贴与图片路径识别**：
  - `KeyDecoder` 新增 `newline` 语义，修复多行粘贴被截断或过早提交。
  - 粘贴本地图片路径时转 Markdown 引用 `![image](path)`（范围诚实：不发送图像字节，真 vision 在 roadmap）。

### 版本化与缺陷批修（M7.5–M7.6）

- **M7.5 — SemVer 2.0.0 + 全链路缺陷批修 + 结构重构**（0.1.0 → 0.2.0 首次语义化发行）：
  - **SemVer 合规基建**：§10 定义公共 API 五面；引入 changesets fixed 锁步组；`version.ts` 运行时单一来源（`createRequire` 双世界解析）；splash/banner/`/session` 显示 `nova vX.Y.Z`；SemVer 正则合规测试挂进 verify。
  - **P1**：`edit_file` 的 `$` 模式经函数 replacer 杜绝展开；bash 输出改 `BudgetedBuffer` 双段预算（head 60% + 环形 tail 40%）。
  - **P2**：统一 `auto-compact.ts` TokenGate（`shouldCompactBefore` 有锚点走锚点、无锚点走全量估算——修 resume 超窗）；always 审批对复合命令记忆整条；TUI 错误路径丢弃未提交块；`agentTurn` 补 `.catch`。
  - **P3**：死代码清理（`extractReasoningHeader`/`reasoningRows`/`questionLines`/`isBlankAnswer` 及测试）；`{env:NAME}` 缺失报错点名；flags 仅前导匹配；PTC `both` SDK 瘦身；`search_files` 进程内 walk 检查 abort。
  - **结构重构**：`createSessionRuntime` 合并三 runner 启动装配；`tui-mode.ts` 消除全部 `as any`/`as unknown as TuiStore`。
- **M7.6 — 测试套件去重 + 接缝集成测试**：
  - 删除 `cli/test/` 中 5 个与 `tui-view/test/` 逐行重复的文件（composer/popup/statusbar/reasoning/prompt-ui，~900 行），CLI 独有部分提取为 `cli-helpers.test.ts`。
  - 新增 3 个**接缝集成测试**：`ai/test/pipeline.test.ts`（SSE→client→runAgent 全管道含 length 截断）、`core/test/resume.test.ts`（save→open→deriveMessages→新轮投影一致性）、`cli/test/frame-assembly.test.ts`（flattenBlocks+wrapBlock 帧组装无超宽、rowMap 连续）。
  - 放宽脆性 `commands.test.ts`（精确顺序→成员断言）。净 455 → 374 用例、39 → 38 文件——减重复、增真实信号。

### 结构收尾与缓存硬化（M7.7）

- **M7.7 — P0–P3 缺陷批修与 TuiStore 收尾**：
  - **TuiStore 收尾**（§9 原技术债清偿）：`tui-mode.ts`（1714 → 1467 行）删除全部闭包状态重声明与 `TuiStore` 形状适配对象（no-op `sampleTps`、逐字节重复 `appendTail`），直接持有 `TuiStore` 实例；tps 采样门控、live tail 追加收敛回 store 方法；`tool_call_start`/readGroup/`discardReasoning`/`/clear`/会话切换改走 store 方法，修复直接 `blocks.push/splice` 绕过 `blocksVersion` 脏检查的缓存失效隐患。
  - **审批引擎测试**：`permission.test.ts` 26 条——三档×五类自动放行矩阵、fail-closed（非法答案/抛错询问器一律拒绝）、`never` 策略不派发询问器、execute 前缀记忆与复合命令整条记忆的边界。
  - **auto-compact 编排统一**：`createAutoCompact`（runner-shared）单源 repl/tui 的 runCompact 守卫 + 锚点重置契约 + pre-flight/fallback 双拦截（呈现经 report 回调注入）；exec 保留 per-request `wrapAutoCompact`（拦截点本质不同）。
  - **缓存硬化**：发 provider 的工具数组按名字典序稳定排序（不改动调用方数组）——禁用 bash/切 code mode 不再重排槽位破坏前缀缓存；`requestImageTokens` 的 schema 计价 WeakMap 记忆化（此前每请求对全部工具 schema 重新 stringify+估算，exec 每轮两次，长任务 O(n²)）。
  - **runAgent 脚手架提取**：`agentRunBase()` 单源三 runner 的公共 kwargs（provider/messages/cacheDir/emit/tools/hooks），accessor 惰性求值适配 messages/host/hooks 运行时重绑。
  - **层级修正**：`PtcMode` 类型移入 core（plugins 再导出保 API），tui-view 撤销对 plugins 的依赖——纯视图层回归 `tui + core` 两个下游。
  - **信任姿态明示**：splash 常驻一行"bash / run_code 在本机执行任意命令（审批门 + 工作区边界 · 无沙箱）；重隔离建议容器化运行"。

### 全链路缺陷清偿（M7.8）

- **M7.8 — 全流程审计驱动的 P1–P3 清偿**（6 个提交）：
  - **会话态访问器化（P1）**：`seedContextFragment` 签名改 `(session, messages)`（交互 runner /new 重绑后传当前绑定，接口 docstring 注明不得再读 `rt.session`/`rt.messages`）；`createApprovalService` 审计与 `agentRunBase` 的 cacheDir/emit 改 `() => Session` 访问器——/new 后 seed 片段、审批审计、`todo/write`+`code-dispatch` 事件与溢出 cacheDir 不再落旧会话；用户级 skills 目录改走 `novaHome()`。
  - **审批门硬化（P1/P2）**：`decide()` ask 路径改串行队列（并发 decide 逐个派发 asker，根治 PTC 并发子调用覆盖 TUI 弹窗挂死；短路/`never` 不入链、抛错不毒化队列）；`rememberKey` 多行命令与 `$( )`/反引号替换一律按整条命令记忆（头部程序前缀不再泄漏 always 授权）；`permissionFor` 抛错回落 `'execute'`（fail-closed，不再回落静态 read）；beforeToolCall rewrite 信任缝双侧注释。
  - **运行健壮性（P2）**：`runAgent` 主体 try/finally（生成器被弃用时 requeue 未消费 job 通知 + 为无结果的 assistant toolCalls 合成 `NOT_EXECUTED_GUIDANCE` 结果）；`parseArgs` 改 `{args, ok}`——malformed JSON 参数不再静默按 `{}` 执行；`persistMissingToolResults()`（runner-shared，扫日志、幂等）接入三 runner 错误 catch 保住"model-visible means logged"；exec SIGINT 改优雅中止（jobs dispose 不再孤儿）+ `--json` 新增 `run_error`/`notice` 事件行 + statusLine 真实耗时；tui `rebuildHost` 重置 usage 锚点（工具集变更使锚点 schema 假设失效）、会话切换打印 `warnings`；repl /model 子提示与 /compact 等待期 Ctrl+C 走 `cancelPending`/`compactAbort`（compact 链路首次接上 signal）。
  - **工具与容器边界（P2/P3）**：`edit_file` 加 8MiB 上限 + `looksBinary` 拒绝；`fileVersions` LRU（>512）；bash POSIX `detached` 进程组负 pid SIGKILL（孙进程不再逃脱）；`BudgetedBuffer.drain` 经 StringDecoder（jobs 增量读取跨读 UTF-8 序列不再出双替换符）；`search_files` halt 拆 truncated/aborted（中止不再谎报"已达结果上限"）；skills 正文 256KB 上限 + BOM 剥离；run-code SDK 缓存带工具集指纹（后激活插件进 SDK 声明）。
  - **会话投影与杂项（P2/P3）**：`compaction/summary` 事件新增可选 `keepIds`，投影优先按 id 解析（中段损坏行不再让恢复面错位）、旧日志回退位置索引，写入侧同写 `keep` 兼容旧读者；`estimate` 补谚文计价；agents-md 单篇按字符边界硬截断进共享预算；`listRecentSessions` 逐文件 catch + 枚举上限 2000；context 片段 id 改 `msg_ctx_` 前缀（用户手输 `<environment>` 不再被误吞进压缩排除）；`findCommand` 永假条件删除；模型列表失败负缓存 60s；markdown code span 抽占位符再跑 bold（不再跨 ANSI 误匹配）；config schema `.strict()`（拼错键报错点名）；CLI 支持 `--` 分隔符；context 片段 `today` 改本地时区（`localDateKey()` 与日期桶同源）。审计修正：`estimateNextPromptTokens`/`hasOpenCompaction` 实有在用，保留。
  - **配置**：`config.json` 未知键现在**报错拒载**（0.2.0 起严格校验，报错点名键名）。

### 会话体验与能力扩展（M7.9）

- **M7.9 — TUI 缺陷批修 + subagent + qqbot 插件**（真机反馈驱动）：
  - **Tab 执行模式随时切换**：门控放宽为"仅进行中的轮/压缩挡住"（会话中途切换由 rebuildHost 的锚点重置自愈缓存代价），切换成功推一行反馈——此前中途按 Tab 静默无效且状态栏芯片塌成单枚，用户以为功能失灵。
  - **命令面板滚动选中错位修复**：renderFrame 与 buildCommandPopup 双重滑动窗口（调用方预切 6 行却传绝对 index，选中高亮永远落在可见列表外）——收敛为 buildCommandPopup 内唯一窗口逻辑；顺带删除 tui-view 的死模块 `frame.ts`（planFrame 无消费者）。
  - **思考过程 codex 风格**：流式期滚动窗口显示纯暗色正文（去 `│` 引用 lane 与 `⋯` 标记，REASONING_LIVE_MAX_ROWS 上限不变），思考结束**整块消失、只留正式回答**（取消 `▸ 已思考 Ns` 摘要行与点击展开——按用户反馈回归 codex 语义）。
  - **/session 切换加固**：工作区护栏（`~/.nova` 数据目录永不作为工作区应用）、恢复面无可回放文本时明示原因、损坏告警在 TUI 落地（对齐 REPL）。
  - **subagent 工具**：core `createSubagentTool` + plugins 包装（opt-in），嵌套 runAgent 上下文隔离、同一审批门、报告回流、结构防递归；dsh subagent 设计的单 provider 简化版。
  - **switch_workspace 工具**：模型可切换工作区根（校验→runner 回调重建宿主）；TUI/REPL 接线，exec 不启用。
  - **`@nova-agent/qqbot`（第一个第三方插件示范）**：独立包只依赖 core/plugins 公共 API——开放平台 WebSocket 全协议（token 单飞刷新/identify-resume 状态机/心跳自愈/指数退避）、REST 被动回复（msg_seq 自增、4500 字分片）、`qqbot_send` 工具；`nova qqbot` 运行模式（对端独立会话、never 审批、wrapAutoCompact）。session-runtime 新增 `extraPlugins` 缝（第三方插件激活前挂入宿主的官方入口）。

### 子代理可见性与运行中干预（M7.10）

- **M7.10 — subagent 活行接管 + TUI 消息队列**（真机截图驱动）：
  - **子代理活行去重（接管式）**：前台 subagent 的活行不再独立钉一行——progress `start` 时**接管该调用的待定工具行**（同一 block 从「调用 subagent …」变形为 `⧉ 子代理 …` 活行，result 时再变形为完成行），spinner 刻度跳过被接管的条目；此前待定行与活行并排同显，同一件事画两遍。中断/出错路径 `clearSubagentLive()` 把活行回退为静态停顿行（`■`），假活行不进历史。
  - **思考流式窗口稳定化（裁剪不折行）**：活窗口此前对 done 行与流式尾做 `wrapLine` 软折行再取 8 行——长段落拆成行片段、窗口每 tick 整体重排、中段 token 硬断行 + glyph 加宽触发二次折行出孤儿续行（截图混乱根因）。改为**一条源行 = 一条裁剪显示行**：done 行头部裁剪（`clipToWidth` 带省略号）、流式尾**保尾**（`fitTail`，眼睛读的是最新文本）+ glyph 动态计宽后仍锁进 `cols-1-REASONING_INDENT_COLS` 预算（与 wrapBlock gutter 预算一致，下游绝不再折行）；窗口每完成一行只平移一行，不再重排。
  - **自发中断根除（幻影 Esc + 中断误判）**：`■ 已中断` 且带统计的行要求 signal 真的触发——排查出 KeyDecoder 两个幻影 Esc 源：①`ESC+未知字节` 兜底曾直接产出 `esc` 键（真 Esc 永远走孤 ESC pending-flush 路径，此兜底只吃 Alt 组合键与被 ConPTY 拆碎的序列，而 Esc 流式中=立即 abort）——改为丢 ESC 递归续读；②孤 ESC flush 仅 32ms，ConPTY 拆包稍慢即误判——放宽至 200ms。另：三 runner 的 catch 归类改以**本轮 signal 是否真的触发**为准，不再按错误文案 `/abort/i` 判中断——undici「aborted due to timeout」等网络超时现在亮出真实错误而非静默标"已中断"。
  - **子代理编排姿态（codex 经验注入，提示词三层）**：系统提示新增 `## Subagents` 节 + subagent 工具描述重写 + 嵌套运行注入 `SUBAGENT_POSTURE`——子代理是**上下文隔离工具而非默认工作流**：默认 1–2 个只读侦察（scout）、brief 自包含且不重叠、报告要 `path:line` 证据指针而非文件转储；**设计/复杂实现绝不委派**（子代理看不到主对话、普通指令遵循水平，父代理拥有设计、决策与一切写操作并复核关键证据）；简单查找不派子代理；多代理不得重复检索同一问题。嵌套报告格式约定：首行 `complete/partial/blocked` + 结论 + 证据指针 + 限制。
  - **子代理执行进度可点击展开**：嵌套日志（`▸ 开始` / 每次嵌套工具调用 `› name args` / `✓ 完成` 里程碑）在内存累积（上限 200 条裁旧），挂在 block.detail 上——活行带 ▸/▾ affordance，**点击展开/收起**（keys.ts 点击链通用化：detail 块 = base + 明细行）；完成后明细随完成行保留可展开，中止后也看得到做到了哪一步。与 reasoning 详情同一契约：**纯会话内存，不落盘，resume 后不可展开**。
  - **运行中消息队列（codex 式）**：轮进行中在 composer 输入正文回车**入队而非拒绝**——`TuiStore.messageQueue` FIFO，队列以暗色 lane 常驻 composer 上方（`messageQueueRows`，最新在后、超 3 条折叠提示）；本轮结束（完成/出错/Esc 中断）后 `drainMessageQueue()` 自动下发队首，走与正常提交相同的技能展开/命令分发管线。**打断 + 干预**语义：Esc 中断当前轮后队首接续发送——用户打断是为了说下一句话。`/` 命令不排队（查看类即时执行、会话变更类仍拒绝）。
  - **子代理消耗统计与后台运行**（承接上一提交）：`run_in_background` 经 `JobRegistry`（kind=subagent）非阻塞运行，报告+用量 trailer 经 `jobs output` 读取；前台报告尾部附 `[subagent: label · N turns · N tools · N tok]` trailer（子代理用量随报告走，不并入父会话统计——对齐 dsh/codex 的 per-thread 隔离）。

### 压缩体验与保真（M7.11）

- **M7.11 — TUI 压缩可取消 + 压缩保真与全文存档**（真机"压缩卡住/丢信息"反馈驱动）：
  - **TUI 压缩可取消**：`/compact` 与自动压缩接 AbortController（Esc/Ctrl+C 取消，对齐 REPL 的 compactAbort——此前 TUI 是三个 runner 里唯一无法取消压缩的入口，卡住的摘要请求只能杀进程）；「正在压缩…」等待行每秒刷新已耗时，取消落「■ 已取消压缩」而非红色失败；exitApp 清理计时器并 abort 压缩请求。
  - **压缩期间 tps 在动**：摘要输出经 `compactConversation` 的 `onDelta` 缝喂入 TUI 速度表（`store.tpsTokens` + 计时 tick 采样），与普通流式轮同一口径，压缩不再是仪表冻结的盲区。
  - **压缩保真**：`COMPACT_ASK` 去掉 300 字上限，改 codex 七节结构（任务/进展/决策与原因/现状/问题与修法/下一步/引用），增量提示同步放开；摘要输入工具结果截断 2000 → 4000 字符；保留预算 20k → 32k 字符，且 `selectRecentMessages`（原 `selectRecentUserMessages`）纳入纯文本 assistant 回复——被压缩掉的不再只有用户的半边对话。
  - **全文存档与按需回查**：压缩前完整 transcript 未截断落 `pre-compact-*.txt`（tool-output spill 目录，trusted read root 免审批），摘要尾部附 `<archive>` 指针指示模型细节缺失时先 read_file 分段查阅；增量压缩从旧摘要收割 `<archive>` 链接更早存档，多次压缩不丢回查链。
  - **思考尾行去动画**：流式思考的最后一行不再前缀轮换 braille 码字，纯暗色正文到底；spinner tick 对 reasoning 活窗口的每 500ms 重绘随之删除（delta 驱动渲染已覆盖，轮换字符是零信息的纯开销）；"生成中"仍由 composer 前缀 spinner 表达。
  - **内置工具对 shell 的信息量反超**：`list_dir` 输出携带文件字节数（best-effort stat，`f 1234 a.txt`）——此前只有 `d/f 名字`，`ls -la` 信息量更高，模型在"大小即证据"的任务里理性倒向 shell ls（实测会话 15 次）；系统提示的 `run_code` 引用改为模式中性表述（native 模式下该工具不存在，不再指向幻影）；bash 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`（Windows GBK 控制台下 python heredoc 不再需要手写 TextIOWrapper 样板，实测会话重复 40+ 次）。
  - **后台子代理工作状态可见**：`JobRegistry` 快照新增 `startedAt` 与 `progress` 访问器（peek 语义，不占用模型 `jobs output` 的读取游标）；后台 subagent 的 `onProgress` 喂"N tools · 最近调用"，TUI 为每个运行中的后台委派钉一行 `⧉ 子代理 label · Ns · N tools · …`（自带 1s 刷新 interval——后台任务活过父轮，spinner 停了也要动），结束原位改写为状态+用量 trailer 行；/clear、会话切换清场，退出停表。
  - **子代理报告只认最终消息**：`runOnce` 的 report 从"运行中最后一条非空 assistant 文本"改为"**最后一条** assistant 消息的文本"——推理型 provider（如经中转的 DeepSeek）收尾轮可能把全部输出放进 `reasoning_content`、`content` 为空，旧采集会把中途旁白（"Now let me examine…"）当成已完成的报告回流父会话且标记 completed（实测两个子代理齐齐中招）；现在空最终消息如实判"ended without a report"并给可行动原因（reasoning_content 提示/轮数上限/中止），status 落 failed 触发父代理重派。
  - **空补全重试（主循环静默停摆根除）**：同一病灶在主循环的表现是"思考流停止后 agent 无声结束"——content 空且无工具调用且带 finish_reason 的补全旧版会推进一条空 assistant 消息并以 complete 收场，TUI 思考块折叠、答案块从未打开，用户看到的就是无报错停摆；现在 `runAgent` 视其为 provider 病理，**原请求自动重试 2 次**（请求每轮只构建一次、前缀稳定所以缓存友好；重试耗尽抛错并按 at-least-once 回队 job 通知），新事件 `empty_completion` 让 TUI/REPL 各落一行「⟳ 空回复…自动重试 a/N」——思考重启从此有解释，失败从此有报错。
  - **开屏模式选择**：splash 升级为开屏页——ASCII figlet 版字 logo（<44 列自动省略）+ 信息盒 + **交互式执行模式选择块**（↑↓/滚轮移动、Enter 确认、Esc 保持当前；Enter 在输入框有字时让位于发送；直接打字立即开始、首条提交自动塌缩）。选择器是纯视图函数（`modeSelectRows`/`nextModeIndex`/`modeSelectedRow`）+ 按键责任链新层 `keyModeSelect`，块**原位塌缩**成确认行不在转录里留交互残骸；PTC/混合行在 Node < 22.19 时置灰并在移动中跳过；`toggleCodeMode` 抽出 `setCodeMode` 单源两处复用。

### 投影器化（M7.12）

- **M7.12 — 轮次投影状态机出壳（行为不变重构 + 截图病灶转红测试）**：
  - **TurnProjector**（`cli/tui/turn-projector.ts`，473 行）：`agentTurn` 闭包里的轮次投影状态机——两个 `StreamSmoother`、思考 buffer/镜像、assistant 块与 separator、增量 markdown、行动画、`handleFailure`/`endTurn` 清场序列——整体抽为注入类（paint/store/cols/now/`onNeedsReveal` 槽），**定时器全部留在壳层**，从此可用假时钟 + `plainPalette` 直接驱动。壳层 `agentTurn` 收缩为 IO 与委派（session.append、usage 锚点、stats 累计留 `onAgentEvent`），catch/finally 里原先手撒三处的清理序列收拢成两个入口。`tui-mode.ts` 2046 → 1526 行。
  - **SubagentLives / BgSubagentRows**（`cli/tui/subagent-lives.ts`）：接管式活行的块身份判断（M7.10 起散在 4 处）收敛为类方法（start 接管 / settle 收编 / abortAll 回退 / renderAll 轮换），后台委派行的轮询钉行与自管 interval 同批入类。
  - **缺陷修复（迁移时发现的真实回归）**：`tool_call_result` 旧路径先清 `toolBlocks` 再判接管身份恒不成立 → 完成行经"移除 + 重推"丢失 `detail`，子代理完成行的点击展开（M7.10 特性）实际失效；`settle()` 在条目尚存时判断并保持块原位，完成行重新收起可展开。
  - **配套**：`turn-projector.test.ts`（13 用例：重试不留残块、空白 delta 不锚定、abort 删未提交保留已提交、error 落丢弃提示、行动画 CJK 预算单行、思考尾行 transient）+ `subagent-lives.test.ts`（7 用例：接管不加块、去重契约、完成行 detail 原位保留、中止回退 ■、嵌套日志 200 裁旧）；壳层剩余裸 ANSI 收敛到 Palette（仅 gutter 开态契约保留原始码）。纯内部重构，行为不变（除声明的 detail 保留修复）。

### 架构收敛与 TUI 现代化（M8.0–M8.5）

- **M8.0 — 漂移 bug 批修**（修复补丁，逐条钉证据）：
  - REPL 补齐 `/mode`——`COMMAND_SPECS` 一直声明该命令，`readline` 实现却无 case 落「未知命令」；`CODE_MODE_HINT` 从 TUI 壳层闭包常量提升为 `tui-view` 导出，行构造收为 `commands.ts` 纯函数 `modeOverviewRows`。
  - `exec` 回补中断归类——`ffdc595` 立的「以本轮 `signal` 是否真触发为准」契约此前漏掉 `exec`，`SIGINT` 被误报为 `run_error`（退出码 130 + `notice` 行，网络超时照常 `run_error`）。
  - 会话回放面过 `markdown` 渲染——`/session` 切回的 `assistant` 消息此前推裸文本，与流式渲染两套观感；现在走同一 `renderMarkdownLite`。

- **M8.1 — Runner 层单源收敛**（行为不变重构 + 附带修复）：
  - **`runner-loop.ts`**：四 `runner` 共享的事件消费簿记单源——日志追加 `switch`（×4 → ×1）、`usage`/锚点簿记（`UsageAnchorState` + 四连归零 ×6 → ×1）、中断归类 `isUserInterrupt`、完成/出错 `toast` `createTurnNotifier`（阈值与文案单源，`exec` 用 `execDoneMs` 阈值）。呈现与投影专属分支留在各 `shell`。
  - **`buildHost` 宿主装配单源**：`createSessionRuntime` 暴露异步工厂（`codeMode` 入参 + `rebuild` 缝）——`bash` 配置展开 ×3、`subagent` 接线、`extraPlugins` 挂载只有一份；TUI 启动不再「弃用 `runtime` `host` 重建」（原 `:169-264` 整套拷贝删除），`repl` 的 `applyWorkspace` 第三份同步收口。
  - **压缩 `surface` 单源**：`core` 导出 `compactionSurface(evt, all, seq)`（`keepIds` 优先），活路径（原按位置索引）与 `deriveMessages` 投影同走一式，「`model-visible` means `logged`」不再靠 `dev-only` 校验兜底；事件仍双写 `keep+keepIds` 兼容旧读者。
  - **无头装配共享**：`createHeadlessPermission`（`never` 审批装配 ×2 → ×1）、`wrapHeadlessAutoCompact`（`splice` 原位契约 + 文案单源）、`exec` 控制行类型化 `ExecControlEvent`（`run_error` | `notice`，`--json` `schema` 文档锚点）。
  - 附带修复：`qqbot` 最终 `assistant` 回复此前漏写会话日志（违反 `model-visible` means `logged`），随簿记统一落盘。

- **M8.2 — `runAgent` 阶段化与守门**：
  - `runAgent` 生成器（~290 行）拆为 `assembleRequest`（`hook` 链 + `job` 通知注入，别名契约注释随迁）/ `streamCompletion`（流式累加 + 空补全重试 + `abort` 归约，返回值生成器）/ 主体提交分发段（~90 行轮次循环）；`notices` `at-least-once` 契约从散布 4 点收敛为 `NoticeState` + `requeueUnaccounted` 幂等单点。事件序列逐字节不变。
  - **弃用路径测试**：消费者中途 `.return()` 的通知回队与 `NOT_EXECUTED_GUIDANCE` 合成此前在 `core` 测试零命中（CLI 孪生有测），`agent-abandon.test.ts` 三用例钉死。
  - **命令核下沉 `command-core.ts`**：`nextApprovalMode`、`cacheHitPct`/`lastCacheHitPct`、`pluginToolLine`/`pluginCommandLine`、`MODEL_LIST_EMPTY`/`modelListError`、`openFreshSession`（`/new` 序列单源，`resetSessionCache` 可选钩子）；TUI `/plugins` 补齐与 `repl` 一致的信息量（审批档位 + 命令注册项）。
  - **守门**：`tsconfig.base` 开 `noUnusedLocals`/`noUnusedParameters`（零报错一次过）；新增 `.oxlintrc.json`（`correctness`=error + `no-unused-vars`）；删除 `findCommand` 死导出与 `void replSubagentProgress` 残留。

- **M8.3 — TUI 主题基建**（默认观感逐字节不变）：
  - **语义主题层**（`tui-view/theme.ts`）：`resolvePalette` 单源解析——`dark`（默认）= 原 `palette` **同一实例**（构造性字节等值，既有 `plainPalette` 断言测试当验证网）；`plain` 无色；`light` 亮背景高对比（`truecolor` 优先、16 色回落），语义槽一一对应不重排语义（守 `tui-design` 红线：主题=同语义换色值）。
  - **能力探测**（`tui/caps.ts`）：`NO_COLOR`/`TERM=dumb` 恒定无色、`COLORTERM=truecolor` 升 24-bit、`?2026` 同步输出能力（`DEC` 私有模式不支持即忽略，可安全启用）。
  - **防撕裂**：`LineScreen` 可选 `synchronizedOutput`（一帧写入包 `?2026h/2026l`，`cli` 经 `caps` 启用；库层默认关闭，既有写顺序断言不变）。
  - **配置面**：`config` 新增 `ui.theme`（`strict` `schema` 兼容新增）、`--theme` `flag`、`/theme` 命令（`REPL`/TUI 运行中即时切换，`screen.invalidate` 全屏重绘；配置只作下次启动持久值，不回写）。

- **M8.4 — TUI 实用性**（红线内）：
  - **滚动锚定**：上滚后新输出等量补偿 `scroll` `offset`——视口钉在用户当时看的绝对位置，不再被流式输出往直播拽；回底恢复跟随。上滚时呼吸行显示「上方还有 N 行」位置指示（`bottomStack` 新增可选 `breathText`，不占内容行、不进状态栏——守「上滚不进状态栏」红线）。
  - **Home/End 跳转**：`composer` 光标已在行首/行尾时再按 `Home`/`End` 升级为历史区跳顶/回底。
  - **`CSI` 修饰键参数保留**：`KeyDecoder` 方向分派此前丢弃参数（`ctrl+arrow` 被静默吞掉）——现在产出 `ctrl+left`/`ctrl+right`，`composer` 绑定词级移动（切词边界与 `Ctrl+W` 一致）；其余修饰组合回落普通方向，行为不变。

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
