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
pnpm gates        # 结构棘轮：依赖方向白名单 + 逐文件行数硬上限（超限即失败）
pnpm gates:update # 同步行数上限（下调静默；上调逐条打印 RAISED，增长必须显式发生）
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
| `core` | provider 无关的 agent 循环（async generator 事件流）、append-only 消息模型、会话持久化与投影、工具调度、token 预估、请求级修剪（snip/micro）、后台 jobs | `agent.ts`（公共面桶文件）+ `agent/{options,notices,request,stream,tools,loop}.ts`（选项常量 / at-least-once 通知簿记 / 请求装配 / 流式与空补全重试 / 工具调度与溢出落盘 / runAgent 主体）、`session.ts`、`estimate.ts`、`request-trim.ts`、`jobs.ts`、`types.ts`、`ids.ts`、`tools/get-time.ts`（M1 demo 工具，仍在发布） |
| `ai` | OpenAI 兼容手写客户端：fetch + SSE 流式、工具调用、重试与断流自愈（Retry-After 双形式严格解析 + 自有退避 32s 封顶）、usage/缓存命中提取 | `client.ts`、`sse.ts` |
| `plugins` | 微型插件容器（工具/命令/钩子/服务注册 + 钩子组合）、权限审批、内置工具、skills、PTC 代码运行时 | `host.ts`、`permission.ts`、`types.ts`、`builtin/{fs,bash,jobs,todo,search,search-worker,index}.ts`、`skills.ts`、`ptc/{run-code,code-runtime,worker,sdk,json}.ts` |
| `tui` | 零依赖终端原语：行级差分渲染（可选 ?2026 同步输出）、原始按键解码（含 SGR 鼠标：滚轮 + 左键点击坐标 + ?1003 悬停 motion、CSI 修饰键参数）、CJK 宽度处理、终端能力探测 | `screen.ts`、`keys.ts`、`width.ts`、`caps.ts` |
| `tui-view` | TUI 纯视图层（零终端 IO）：tokens 常量、调色板/标签、**设计语言原语**、裁剪族、工具行、状态栏、弹窗、composer、快捷键条、reasoning、间距、开屏 | `tokens.ts`、`palette.ts`、`theme.ts`（语义主题层）、`labels.ts`、`layout.ts`（chrome 列宽/圆角卡片/分隔符）、`text.ts`、`clip.ts`、`tool-lines.ts`、`status-view.ts`、`popups.ts`、`composer-view.ts`、`hint-bar.ts`、`reasoning-view.ts`、`spacing.ts`、`splash.ts`、`smooth.ts` |
| `cli` | 产品壳：全屏 TUI + readline 回落 + 非交互 exec + 配置发现 + 模型元数据 | `tui-mode.ts`（~1090 行壳层：生命周期/IO/启动装配）、`tui/{store,keys,frame,frame-assembler,commands,mode-select,session-switch,compact-wait,gutters}.ts`（TuiStore / 按键责任链 / 行数学与弹窗选择 / 整帧装配与仪表缓存 / 命令呈现 / 开屏选择器 / 会话切换 / 压缩等待态 / gutter 常量）、`tui/{turn-projector,subagent-lives}.ts`（轮次投影状态机——`onEvent` 承接事件呈现归约 / 子代理活行与后台行状态机）、`session-runtime.ts`（三 runner 共享启动工厂 + buildHost 宿主装配单源 + 模型列表缓存）、`auto-compact.ts`（统一 TokenGate + 无头 wrapHeadlessAutoCompact）、`runner-shared.ts`（计时/maxTurns/审批效果预览与 toast 正文/hooks 重绑/自动压缩编排/runAgent 公共 kwargs 装配）、`runner-loop.ts`（四 runner 事件消费簿记与轮次失败归类单源：日志追加/usage 锚点/重试与空补全文案/中断归类/失败归类/回合状态行/toast）、`command-core.ts`（斜杠命令逻辑核：repl/TUI 共用公式与文案）、`exec.ts`、`repl.ts`、`repl-progress.ts`（REPL 瞬态进度行单主：spinner/推理尾行/bash 尾行/子代理暗行）、`compact.ts`、`config.ts`、`context.ts`、`system-prompt.ts`、`agents-md.ts`、`sessions.ts`、`commands.ts`、`model-meta.ts`、`markdown.ts`、`notify.ts`、`version.ts`、`spinner.ts`；`scripts/sync-root-version.mjs`（根包版本同步）——M9.5 起呈现计算一律直连 `@nova-agent/tui-view`，5 个转发门面已删 |
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
三档：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）。execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 默认按**命令程序前缀**记忆（`git status` 放行后续 `git ...`，不波及 `rm`），复合命令（`&&`/`;`/`|`/换行/`$()`）只整条记忆；M10 起该粒度**可交互调节**：弹窗选中「总是允许」行按 ←/→ 挪授权词数（前 N 词实时预览，引擎按**词前缀匹配**放行——`git status` 范围不波及 `git commit`，也不隐含程序前缀），越界/复合自动回落默认粒度。「拒绝」行打字即补充拒绝理由，经 `{answer:'deny', reason}` → `decideDetailed` 一路回流成工具结果 `Permission denied: by user: <理由>`——拒绝从死路变成一次指令；询问器返回类型加宽为 `AskResult`（返回原 `'allow'|'deny'|'always'` 字符串的第三方询问器零改动），畸形/越界答案一律 fail-closed 回落。ask 路径的每次决定写入 `approval` 审计事件（log-only，可回放；自动放行不记事件，防只读工具刷屏）。审批弹窗上方实时渲染 `edit_file` 的 `- 旧行 / + 新行` diff、`write_file` 的目标+首行预览（工具经可选 `preview(args)` 声明；`edit_file` 多命中未设 `replace_all` 时预览直说"执行将报错"而非谎称替换）。

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
alternate screen + 行级 diff 重绘（React-free）；`/` 命令面板（↑↓ 选择、Tab 补全、输入历史）；审批弹窗（y/n/a + 1-9、always 行 ←/→ 调授权词数、拒绝行打字补理由）；模型/会话切换面板 1-9 数字快选；PageUp/PageDown/滚轮滚动（上滚不改状态栏样式——常驻视图保持稳定，↓/滚轮回到底）；仪表悬停（?1003 any-motion：悬停上下文仪表换形，T2 档让格给「已用/总量」数字、总宽不变，拖拽仍被吞）；Ctrl+C 中断当前轮（空闲时两段退出）；多行 composer（粘贴保留换行、软换行最多 8 行窗口、↑↓ 行间移动；**长粘贴折成 `⧉ 粘贴 N行 X字` chip**——纯显示折叠，缓冲区存全文、提交一字不差，←/→ 整越、边界退格先展开防一键吞粘贴）；**运行中消息队列**（轮进行中回车入队不拒绝——队列暗色 lane 常驻 composer 上方，本轮结束后自动下发队首，Esc 中断后接续发送）；流式 markdown（列表缩进 2 列挂圆点，换行续行对齐条目文本列）、工具输出**三态折叠**（Collapsed 头行 → Truncated 12 行预览 → Expanded 400 行封顶，点击轮转、▸/▾ affordance）、reasoning 定高活窗口（定格 2 行 + 活尾 1 行、每行裁到单一显示行绝不折行、空行不进窗——每个 delta 只重写活尾一行，整段不重排；**答案起笔定格成 `▸ 已思考 N.Ns`**（<10s 一位小数）、与答案同组紧排，轮内不留空行，**点击可展开思考全文**——▸/▾ 前缀为 affordance，全文仅存会话内存（reasoning 从不落盘，resume 后不可展开），展开正文逐行暗色、软折行走 gutter 预算）；长命令实时显示已耗时与输出尾行；系统通知（Windows toast / macOS osascript / Linux notify-send）。分层：`tui`（终端原语）→ `tui-view`（纯视图，零 IO）→ `cli/tui/`（`store.ts` TuiStore / `keys.ts` 按键责任链 / `frame.ts` 帧装配 / `turn-projector.ts` 轮次投影状态机——流式平滑、assistant/思考块生命周期、工具行形变、行动画、中断清场，假时钟 + `plainPalette` 可单测 / `subagent-lives.ts` 子代理接管活行与后台行状态机）→ `tui-mode.ts`（壳层：生命周期 + IO + `agentTurn` 事件归约的委派，块级投影一律走 TurnProjector；TUI 可变状态全部收敛在 TuiStore 实例里，壳层与按键链读写同一实例）；决策背景见 `docs/tui-design.md`。

**单行状态栏**三段式 `上下文仪表 │ 模型 · 执行模式 · 审批档位 │（右缘）tps · cache`——`│` 分大组、`·` 分组内，层级靠分隔符而非字数堆砌：
- **上下文仪表**：按整窗真实比例分段上色（提示词青 / 工具 schema 绿 / 注入片段蓝 / 技能索引品红 / 消息黄），加粗「已用/总量 · 百分比」；**用量断点混色**（`usageUrgency`：中性 <50% → 青 <70% → 黄 <90% → 红 ≥90%，ANSI-16 混不了渐变、断点快照即 Grok 自己的 t<0.5 取整规则）；`压缩 %` 只在真正逼近阈值时出现（T0 常驻、T1 ≥50%、T2 ≥70%）。
- **空间不足按优先级整字段降级，绝不词中截断**：同一档位内**先丢瞬时提示**（中断/退出——它们只是锦上添花，不该把「已用/总量」挤出状态栏），再降档：T0 全量 → T1 去 `模式/审批` 标签、模型去供应商前缀 → T2 仪表只留条+百分比、审批降单字（读/编/全）、模型截断 → 极窄时弃模型名（banner 与 `/model` 已可见）。上滚**不进**状态栏：滚动位置从画面本身可见，状态栏样式恒定。右缘仪表组定宽不随 tick 变宽、百分比与数值 `padStart` 位数跳动不挪分隔符、截左不截右。
- **tps 速度表**：500ms×10 环形窗口，**会话级连续滚动**（发新消息不清空、无新输出不排空到 0），恒绿色（"是否在生成"由 composer 前缀 spinner 表达）。
- **cache 命中率**：取**会话累计**值且**粘住可见性**——provider 随机分流到不报缓存的后端会让单轮值抖动、整段闪现，故一旦本会话见过缓存上报就常驻，从未上报则整段隐藏。
- **模型元数据（models.dev）**：启动后台拉 `https://models.dev/api.json`，解析为精简目录落盘缓存（`~/.nova/cache/models-dev.json`，24h TTL，断网用旧缓存），按模型 id 精确→尾段匹配解析上下文窗口/模态/推理/工具/附件能力，喂给结构进度条分母；明细在 `/model` 面板与 `/session`。
- **执行模式**：新会话未开始时按 Tab 循环 普通 → PTC → 混合（rebuildHost 统一重绑 host+hooks；Node 不满足 22.19 时拒绝并保持原模式；区别见 `/mode`，切换不留历史行、状态栏模式标即时变化）。

**设计语言（Grok 度量逐值移植，M10 批6）**：观感差距不在配色而在**有没有一层设计语言**——Nova 原先每个组件自己算宽度、自己 pad、自己写降级 tier，一处算错整块错位。`tui-view/layout.ts` 把 Grok 实际在用的常量收进来成原语：**屏幕分区**（`bottomStack` = 转录 → 呼吸行 → 弹窗 → 队列 → 输入卡片 → 状态栏 → 快捷键条，转录区是**唯一**收缩者，其余全是定长行，Grok agent.rs:228-299）；**转录列基线** `MARK_COL=2 / CONTENT_COL=4`（`MARK_LEAD` + 标记后 1 格气口）：标记列就是卡片用的那 2 格内衬，于是 `❯`（用户）、`•`（答案）、`⠙/✓/✗`（工具）、`▌`（导轨）、`◈`（子代理）全部落在同一列、正文全部从第 4 列起（原先用户/答案在第 4 列、工具在第 6 列，一轮读起来是两条错位的轨）；**留白只出现在新语义单元之前**（`frame.ts` 的 `TIGHT_AFTER`/`TIGHT_BEFORE`）——一轮之内提问→思考→答案→逐个工具行紧排，只有新用户提问与**认不出 kind 的块**（命令回显、通知、错误、状态行）另起一段，认不出就留白是 fail-closed：提示粘进转录会被读成模型输出，比少一行空行贵得多；**圆角卡片** `cardTop/cardRow/cardBottom`（`╭─╮│╰─╯`，顶框右缘可嵌 caption、底框右缘可嵌 info，`╮╯` 前留 2 格，info 空则整段省略）；**整屏一套边框语言**——开屏卡、输入卡、`/model` `/session` 面板的框线一律走新增的 `Palette.border` 槽（dark 用 bright-black、light 用中灰、plain 恒等），不再裸写制表符：裸框线落在终端默认强度上，跟有色内容并排就显"廉价"，而边框色是**结构色不是主题色**，故与 `dim` 分槽；输入行的 `❯` 同理改由 `composerLead(p)` 经调色板绘制（原先硬编码 cyan+bold 转义码——light 主题下是不知所措的亮青、plain 流里仍吐 ANSI，`COMPOSER_PREFIX` 导出随之移除、`COMPOSER_PREFIX_WIDTH` 成字面量）；**两种分隔符宽度不通用**：状态簇 `" │ "`(3)、快捷键簇 `"  │  "`(5)。**输入区从"一行 `❯`"升级为卡片**（Grok prompt：左右内衬 2、单行草稿恒 3 行、正文宽连边框一起扣、光标落在卡片第二行故 `cursorPosition` 多一层 `leadRows`）。**快捷键条**（`hint-bar.ts`，屏幕最后一行）是这套语言里最关键的分工：**占位符只说"在这里输入"，键位归键位条**——原先键位散在开屏面板、占位行、弹窗提示里，哪儿都在说、哪儿都不像设计；键位随"谁占用键盘"换一套（命令面板 / 模型会话选择 / 审批 / 开屏选择器 / 运行中 / 静息），超宽按原序从尾部**整条丢弃**（不折行、不加省略号），且 **Tab 只在真能切模式时才印出来**（骗人的键位提示比没有提示更糟）。同一条规则也收掉了**审批弹窗自带的 `↑↓ 选择 · Enter 确认 · Esc 拒绝` 提示行**——弹窗只留内容（头部 / diff 预览 / 三个选项 / 一句授权语义），键位改由 `HintState.approvalScope` / `denyTyping` **随光标所在行**出现（停在「总是允许」且命令确有多词可收窄才印 `←→:调授权词数`，停在「拒绝」才印 `打字:补理由 │ ⌫:删字`）。**字形必须经真机探针选定**（批7b）：在 zh-CN Windows Terminal / Cascadia Mono 里逐字形打标尺行测宽与字形存在性——`⧉`(U+29C9) 该字体根本没有、渲染成十六进制豆腐块，于是粘贴 chip 与子代理标记改用探针确认存在的 `▤`/`◈`（`CHIP_MARK`/`SUBAGENT_MARK` 单源）；同时证实本项目框线/导轨/箭头字形全为单格宽、全角 `！：` 为双格，**宽度表与终端一致**（对齐问题不在宽度表，见 commit）。

**开屏 = 一张居中卡片（Grok welcome 二稿）**：`buildWelcome` 单块承载全部开场信息——工作区根 / 会话根（家目录前缀折成 `~/…`，让尾段活过裁剪）/ 技能计数 / 模式选择器 / 沙箱姿态，五行同处一框（与输入卡片同一套圆角细线，框线一律走调色板的 `border` 槽，见上），按终端列数**水平居中**，并在首轮提交前按 Grok 的 **上留余量 1/3**、其余沉底来放垂直位置（`store.welcomeCenter` + `frameMap.topPad`：点击行号要先减掉合成空白；对半切的"真居中"在终端里读起来像浮在半空），消掉半屏空洞。身份三件套（模型 · 审批 · 模式）由常驻状态栏独占、卡片**绝不复读**；键位提示一律不进卡片（归底部快捷键条，见上），占位行只剩 `描述任务…`，且光标独占一格、绝不用反色盖住占位文本的汉字。模式选择器是框内单行分段控件 `[•普通]│[ PTC ]│[混合] 将切到 PTC`：反色胶囊=光标、`•`=已生效、尾注=「将切到 X / 当前模式」，三个通道分开写才不会"选择器指着 A、状态栏写着 B"；整块卡片由 `ModeSelector` 拥有，↑↓ 原位重写、塌缩只是换回静态形态（不跳宽、不留交互残骸）。**状态栏模式字段只报当前档**——原先三档并排的 pristine 芯片与卡片选择器重复且一动就互相矛盾（一个控件一件事），`StatusView.pristine` 随之删除。

**工具行单行预算**：工具行（运行/完成/组行）拿终端列数渲染，参数摘要吸收剩余宽度——但预算必须扣掉本行自带的**内容列内衬**（`toolBudget() = cols-1-CONTENT_COL(4)`，wrapBlock 按同一预算折行，行构建器裁进同一预算才不会把 ` · 行数 · 耗时` 尾巴顶成孤儿续行）——` · 行数 · 耗时` 尾巴恒留本行，不再折出孤儿续行。**工具块不再吃挂行缩进**：`TOOL_GUTTER` 现在是恒等 gutter（`{first:'',rest:''}`）——每行自带标记列内衬，再叠一层挂行会把导轨行推到第 8 列（旧版就是这个双缩进，`✓` 在第 4 列、`▌` 在第 8 列）。截断按**显示列数**而非字符数（CJK 计 2 列）：命令在参数边界切（`cd "…" && ls …`），路径切头保文件名（`…\manifest.json`）。连续只读调用（read/list/search）聚合为一行**动词短语组**（`  ✓ 读取 2 个文件, 搜索 1 个模式 ▸ · 0.5s`，Grok verb_group：成员按工具名分桶、任何成员在跑时整组翻「正在」时态、失败以红色 ` · N 失败` 后缀并入同行而非拆行、成员摘要挂点击 detail）。**状态导轨**（Grok accent_bar）：多行生存面（运行中 bash 尾行、三态折叠正文、失败首错行）以 `  ▌ ` 开头（与 `✓`/`✗`/`❯` 同处标记列），**导轨色即状态**——running 亮青/暗按 elapsed 脉冲（ANSI-16 混不了正弦波）、完成绿、失败红常驻；单行 ✓/✗ 已有色彩承载、collapsed 行不挂导轨。审批弹窗头部与 diff 预览同样按列裁剪，弹窗不折行。

累计 token 与分段明细在 `/session`，模态能力标在 `/model` 与 `/session`；`/session` 另报缓存浪费审计（missTokens，噪声底 1024 tok）并可作会话切换器（↑↓ 选择或 1-9 快选、Enter 恢复上下文并切回该会话创建时的工作区）。

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
- **TUI 分层**：渲染计算 = `@nova-agent/tui-view` 纯模块（`status-view.ts`/`composer-view.ts`/`popups.ts`/`reasoning-view.ts` 等，帧快照入参、Palette 注入、`plainPalette` 可测；cli 侧不留门面——M9.5 直连已机检为惯例）；`tui-mode.ts` 闭包壳只留定时器/终端 IO/状态突变，按键按责任链分层（审批 → 面板 → 全局 → composer），**轮内块投影一律进 `tui/turn-projector.ts`（定时器由壳层驱动，投影器不碰 setInterval）**。新交互先问能不能写成纯函数，能则不进闭包；只能在真机截图里发现的行为，多半说明它还长在投影器之外。
- **前缀字节稳定**：任何动态内容都注入会话首条 user 片段（append-only），绝不回改系统提示或旧消息——否则破坏缓存命中。
- **测试不联网**：三层测试体系——①**单元层**（纯函数，断言用 `plainPalette` 取无 ANSI 的确定字符串）；②**ai 层注入** `fetch` + SSE fixture（`client.test.ts` 覆盖流式 tool call 分片、中途断流、静默截断、reasoning、缓存字段、Retry-After 双形式/非法显式失败/自有退避封顶、工具序列化按数组身份缓存）；③**接缝集成测试**（M7.6 新增，守模块交接处而非实现细节）：`ai/test/pipeline.test.ts` 守 SSE→`OpenAICompatClient`→`runAgent` 全管道含 `finish_reason:"length"` 截断防御；`core/test/resume.test.ts` 守 save→`Session.open`→`deriveMessages`→新 `runAgent` 轮的投影一致性；`cli/test/frame-assembly.test.ts` 守 `flattenBlocks`+`wrapBlock` 帧组装无行超宽、rowMap 连续。④**投影状态机单测**（M7.12 新增）：`cli/test/turn-projector.test.ts` 与 `cli/test/subagent-lives.test.ts` 以假时钟 + `plainPalette` + 真实 `TuiStore` 驱动轮次投影——重试残留块、空白锚定、假活行、孤儿续行这些曾经的「截图病灶」从此有红测试可守。当前 **61 个测试文件 / 734 个用例**——M9 出壳的每个单元都带直测（`cli/test/{mode-select,session-switch,compact-wait,frame-assembler,active-view,repl-progress,commands}.test.ts` 与 turn-projector 的 `onEvent` 组：假时钟/假 writer + 真实 `TuiStore` + 注入依赖，壳层逻辑抽到哪、红测试就跟到哪；M10 的折叠行源/状态导轨/chip 折叠投影/授权范围匹配同样各自带纯函数直测）；各包 `test/helpers/` 收敛 `scriptedProvider` / `withFakeHome` 共享 fixture（`plugins/test/permission.test.ts` 专守 fail-closed 审批分支：非法答案/抛错询问器/`never` 短路/前缀与复合命令记忆；`core/test/agent.test.ts` 新增 stale-todo nag 组 5 条 + 请求级修剪接线 1 条：3 轮触发、快照清零、同轮多调用计 1、纯问答不计、length-cut 计失活、wire 收缩而日志完整；`core/test/request-trim.test.ts` 新增 snip/micro 纯函数 9 条：原子成组、孤儿结果独立、预算内原样返回、整组裁中段+标记计数、非法预算抛错、micro 占位/短结果亦换/调用形状保留；`ai/test/client.test.ts` 新增重试 6 条 + 工具缓存 1 条：HTTP-date 生效、非法值显式失败、退避封顶、parseRetryAfterMs 秒数/日期/缺失/非法矩阵、同引用跨轮缓存命中/不同引用仍正确序列化；`plugins/test/plugins.test.ts` 新增 hook 结构化 4 条：畸形 verdict fail-closed、工具集加宽抛错、收窄放行、clone 同集合放行；`core/test/hooks.test.ts` 新增 loop 纵深防御 1 条）。
- **路径/跨平台**：一律 `node:path` + 抽象层；bash 工具 Windows 优先 Git Bash、回落 PowerShell 并强制 UTF-8。
- **文档即真相**：机制变了同步改本文件（README 只留门面）；里程碑详录归档 `docs/MILESTONES.md`，本文件 §7 只留现状一行。决策理由写进 commit message 与机制条目，不再有第三份笔记义务。
- **门禁与 verify 分层**：本地快环 `pnpm check`（lint + gates + 变更相关测试，秒级）随手跑；全环 `pnpm verify`（build + typecheck + 全量 test + gates）提交前跑。`pnpm gates` 两件套是**结构护栏**：`dep-direction.mjs` 机检包间 import 方向（§4 白名单的事实化）、`structure-budget.mjs` 管逐文件行数上限（超限即失败；文件收缩或有意增长后跑 `pnpm gates:update [子串]` 同步——上调会逐条打印 RAISED，增长必须显式发生过）。真正治巨型闭包的是 oxlint 的长函数/复杂度警告（存量警告即重构靶单）。
- **断言粒度**：测试断**契约与不变量**（宽度守恒、结构顺序、关键字段存在、降级行为），不断完整文案串——观感微调不该触发红测试。lint 的 complexity/max-depth/长函数警告以现状校准（存量警告是重构靶单，增量违规必须处理）。

## 7. 里程碑与状态

**版本现状**：0.3.0 已发行；M1（agent 核心）→ M9（治理换血与结构棘轮）全部落地（M9 已收口、0.4.0 备发待指令），**M10（Grok Build TUI 设计移植）进行中**——渲染层批1/批2（sanitize、空帧丢弃+游标去重、tmux 门+焦点重断言、增量展平、逻辑滚动锚、stdout 背压门、帧数组乒乓）与组件层批3/批4（工具输出三态折叠、只读动词短语组行、reasoning `▸ 已思考 N.Ns` 折叠头、仪表 ?1003 悬停换形 + 用量断点混色、`▌` 状态导轨、always 词数授权调节、1-9 编号快选 + 拒绝理由回流、composer 粘贴 chip）与**开屏 welcome 重做**（去处 hero 面板居中、模式选择器换单行分段控件、按键提示改寄生 composer 占位行）已落地，移植决策与 Grok 源证据逐条见各 commit；组件10（ConHost 字形替身表）待用户表态，原生 scrollback（R7）为停车场不做。M1–M8.5 逐条机制与决策背景已归档 [docs/MILESTONES.md](./docs/MILESTONES.md)——本节只记现状与方向，不再膨胀。

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
