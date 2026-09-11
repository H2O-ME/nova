# AGENTS.md — NovaAgent

> 本文件是仓库的**唯一权威文档**（同时面向人类与 AI 编码 agent）。`README.md` 已精简为指向本文的门面页；所有设计目标、架构、命令、约定、里程碑都以此文件为准。文档随实现同步更新——改机制就改这里。

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
```

> ⚠️ `nova` / `pnpm nova` 跑的是 **`packages/cli/dist`**，不是源码。改完 `src` 必须 `pnpm build` 才生效（`pnpm dev` 走 tsx 直读源码，免构建）。

全局安装：`cd packages/cli && npm link` → 任意目录直接 `nova`；改代码后重新 `pnpm build` 即生效。

`nova` 的形态：

- `nova` → 交互 TUI / readline。
- `nova -- --approval auto-edit` → 临时覆盖审批档位。
- `nova -- --resume ~/.nova/sessions/<YYYY/MM/DD>/<id>.jsonl` → 续接历史会话。
- `nova exec "<task>" --json` → 非交互单次执行（JSONL 事件流，CI 友好，可管道传入任务；无法交互确认，未放行的审批请求自动拒绝）。

## 3. 配置（唯一来源 `~/.nova/config.json`）

项目目录里不需要、也不会产生任何 `.nova/` 文件。`apiKey` 支持 `{env:NAME}` 引用环境变量，避免明文密钥进仓库。

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
  "tools": {
    "bash": { "enabled": true, "timeoutMs": 60000, "shellPath": "C:/Program Files/Git/bin/bash.exe" },
    "code": { "mode": "ptc" }          // 可选：PTC 模式（native|ptc|both，缺省不加载）
  }
}
```

Skills 放 `~/.nova/skills/<name>/SKILL.md`（用户级）或项目级 `.nova/skills/`（只读发现，项目级优先），frontmatter 仅 `name` / `description`。

## 4. 架构

pnpm monorepo，依赖方向强制单向：`cli → {tui, plugins, ai, core}`，`plugins → core`，`core` 不依赖任何上层包。

| 包 | 职责 | 关键文件 |
| --- | --- | --- |
| `core` | provider 无关的 agent 循环（async generator 事件流）、append-only 消息模型、会话持久化与投影、工具调度、token 预估、后台 jobs | `agent.ts`、`session.ts`、`estimate.ts`、`jobs.ts`、`types.ts`、`ids.ts` |
| `ai` | OpenAI 兼容手写客户端：fetch + SSE 流式、工具调用、重试与断流自愈、usage/缓存命中提取 | `client.ts`、`sse.ts` |
| `plugins` | 微型插件容器（工具/命令/钩子/服务注册 + 钩子组合）、权限审批、内置工具、skills、PTC 代码运行时 | `host.ts`、`permission.ts`、`builtin/{fs,bash,jobs,todo,search}.ts`、`skills.ts`、`ptc/{run-code,code-runtime,worker,sdk,json}.ts` |
| `tui` | 零依赖终端 UI：行级差分渲染、原始按键解码（含 SGR 鼠标：滚轮 + 左键点击坐标）、CJK 宽度处理 | `screen.ts`、`keys.ts`、`width.ts` |
| `cli` | 产品壳：全屏 TUI + readline 回落 + 非交互 exec + 配置发现 + 模型元数据 | `tui-mode.ts`（壳层）、`statusbar.ts`/`composer.ts`/`popup.ts`/`reasoning.ts`（TUI 纯计算层）、`repl.ts`、`exec.ts`、`commands.ts`、`config.ts`、`compact.ts`、`model-meta.ts`、`context.ts`、`system-prompt.ts`、`agents-md.ts`、`sessions.ts`、`ui.ts` |

## 5. 核心设计

### 一切皆插件
工具、斜杠命令、生命周期钩子（`beforeLLMCall` / `beforeToolCall` / `afterToolResult`）全部经 `PluginContext` 注册；内置 fs/bash 工具与 skills 走**同一 API、同一审批门**，保证内核最小。`PluginContext` 提供 `tools()` 活视图；`ToolExecuteContext` 提供 `dispatch` 嵌套分发缝（PTC 子调用回流用）。

**专用工具优先于 shell**（治"模型绕开内置工具跑 `find | wc -l`"）：系统提示与工具 description 双侧写 DSH 式排他句——`Use read_file — not shell commands like cat/head/tail`、`Use search_files — not shell grep/rg/find`（结构化行号结果 + 免审批摩擦是卖点）；bash 聚焦行为契约（git/包管理器/构建/测试），不给反向劝退句（DSH 验证过：跨调用选择放系统提示、单次调用格式放 description）。批量聚合（数文件/汇总）导向 `run_code` 程序化出口而非 bash 管道。

### 上下文与缓存命中率（核心差异化）
目标：**稳定前缀 = 高缓存命中**。四层机制：
1. **前缀冻结**：系统提示字节稳定（persona + 工作方式 + 工具规则 + **操作姿态**）；环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改。注入片段带**权威指令帧**（DSH "Session directives" 语义）：`<user_instructions>`/`<project_docs>` 标注为"操作者写入的活跃会话指令，按字面执行、不作不可信数据处理"——治模型把本地指令当"可能相关的参考"而忽略/上报注入；同时**保留数据/指令二分**：会话中从文件内容读到的文本仍是不可信数据，防恶意仓库内嵌指令劫持。
2. **追加式日志**：对话严格 append-only；工具结果超 40KB 时全文落盘 `~/.nova/cache/tool-outputs/<sessionId>/`，消息体保留头部 60% + 尾部 40%（尾部常带测试失败详情）并附读取提示（提示按字节计数，head+tail+提示行总量恒守预算）；落盘目录经 trusted read roots 豁免审批（内容本就是模型已见过的工具输出，同主体信任），三 runner 统一传入。
3. **compact**：`/compact`、自动阈值（`autoCompactTokenLimit`，以最近一次 usage 为锚点发请求**前**预判）共用同一实现；压缩**原位追加** `compaction/start → summary → end` 三事件，模型可见面由 `Session.deriveMessages()` 投影重建，原始历史永不改写；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）。摘要请求以序列化裁剪后的 transcript 发送，已有摘要时走增量合并。**token 预估计入 assistant 的 tool call 参数**（`rawArgs`，PTC/bash 大程序曾是估算盲区），`estimateMessageTokens` 带 `WeakMap` 记忆化（消息 append-only 不可变，exec 每请求全量重估不再重复计价）。保留片段取**整条消息取舍**（最新优先、首条放不下即停，不截断——截断拷贝会同时破坏投影字节一致契约与预算上限）。exec 的轮内预检逐请求全量估算，并带**熔断**：一次压缩后仍超阈值（保留片段 + 工具 schema 构成下限）即停用本任务后续自动压缩并告警一次，避免每轮白烧摘要请求、日志被压缩三事件刷屏；同时校验原位压缩的 messages 别名契约（插件钩子若替换数组则告警停用而非静默失效）。
4. **供应商对齐**：请求携带 `prompt_cache_key` 与 `x-session-id`/`x-session-affinity` 会话亲和头（sessionId=会话 id），让网关把同一会话固定路由到同一缓存节点。指标目标：会话第 3 轮起 prompt cache 命中率 ≥ 90%（`/session` 可查）。

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
`tools.code.mode` 三态 `native|ptc|both`。开启后模型获得 `run_code {code, description}` 传输工具：写一段 async TypeScript 程序，`await tools.name(args)` 即子调用，**穿过与原生调用完全相同的管线**（审批门 + 钩子 + 超时/中断，经 `ctx.dispatch` 回流）。只有程序 print/return 的策展输出进入上下文，中间结果只落 `code-dispatch` 审计。执行基底是**每 run 全新 worker 线程**（信任姿态等同 bash）：剥型、空环境、堆/busy-time/墙钟/输出四类预算、端口协议逐字段防御。SDK 声明由 schema 字典序生成（字节稳定不吃缓存）。`ptc` 态只暴露 `run_code`。需 Node ≥ 22.19。

### 后台 jobs / todo
`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，`jobs` 工具（list/output/stop）读写增量输出。`startBackground` 镜像 `runOnce` 的 settle 防御：`exit` 事件记退出码 + 2s `closeGrace`，`cancel()` 后 3s `killSettle` 兜底，settle 前销毁 stdio 管道——taskkill 后孙进程持有管道时 `dispose()` 不再卡死进程退出。job 自然结束（completed/failed）时，**下一次 LLM 请求会自动注入一行"bash-N 已完成"通知**（`runAgent` 每次发请求前经 `JobRegistry.drainFinished()` 取队列，以克隆消息数组追加临时 user 消息——不落会话日志、不破坏投影不变量，每个 job 只通知一次；**送达性为至少一次**：请求在回复提交前失败/中断时经 `requeue()` 回队，下个请求重播，不会静默丢失），模型无需空转轮询；显式 stop 导致的 killed 不通知（模型已知）。`JobKindMap` 预留 `subagent` 扩展位。`todo_write` 整表替换、last-write-wins，快照持久化为 log-only `todo/write` 事件，不占模型上下文。

### Skills（渐进加载）
启动只把每个 skill 的 name+description 注入索引，命中触发词时才加载正文——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发。项目级 `.nova/skills/` 优先于用户级 `~/.nova/skills/`。

### TUI（自研差分渲染，codex 风格）
alternate screen + 行级 diff 重绘（React-free）；`/` 命令面板（↑↓ 选择、Tab 补全、输入历史）；审批弹窗（y/n/a）；PageUp/PageDown/滚轮滚动（上滚不改状态栏样式——常驻视图保持稳定，↓/滚轮回到底）；Ctrl+C 中断当前轮（空闲时两段退出）；多行 composer（粘贴保留换行、软换行最多 8 行窗口、↑↓ 行间移动）；流式 markdown（列表缩进 2 列挂圆点，换行续行对齐条目文本列）、工具调用折叠块、reasoning 定高活窗口（定格 2 行 + 活尾 1 行、每行裁到单一显示行绝不折行、空行不进窗——每个 delta 只重写活尾一行，整段不重排；结束后折成"已思考 Ns"、与答案同组紧排，轮内不留空行，**点击可展开思考全文**——▸/▾ 前缀为 affordance，全文仅存会话内存（reasoning 从不落盘，resume 后不可展开），展开正文逐行暗色、软折行走 gutter 预算）；长命令实时显示已耗时与输出尾行；系统通知（Windows toast / macOS osascript / Linux notify-send）。

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
- **TUI 分层**：渲染计算 = 纯模块（`statusbar.ts`/`composer.ts`/`popup.ts`/`reasoning.ts` + `ui.ts`，帧快照入参、Palette 注入、`plainPalette` 可测）；`tui-mode.ts` 闭包壳只留定时器/终端 IO/状态突变，按键按责任链分层（审批 → 面板 → 全局 → composer）。新交互先问能不能写成纯函数，能则不进闭包。
- **前缀字节稳定**：任何动态内容都注入会话首条 user 片段（append-only），绝不回改系统提示或旧消息——否则破坏缓存命中。
- **测试不联网**：`ai` 层注入 `fetch` + SSE fixture；断言用 `plainPalette` 取无 ANSI 的确定字符串。
- **路径/跨平台**：一律 `node:path` + 抽象层；bash 工具 Windows 优先 Git Bash、回落 PowerShell 并强制 UTF-8。
- **文档即真相**：机制变了同步改本文件（README 只留门面）。里程碑改动附决策说明。
- **提交前**：`pnpm verify`（build + typecheck + test）与 `pnpm lint` 全绿。

## 7. 里程碑与状态

**已交付**：
- **M1** agent 循环（事件流）、append-only 消息、工具调用闭环、结果超限落盘、JSONL 持久化/回放、缓存命中统计。
- **M2** 插件容器、权限三档 + always 记忆、内置 fs/bash 工具（realpath 边界 + 原子写 + 陈旧检测 + 跨平台 shell 探测）、core 三钩子点、`/plugins` 与 `--approval`。
- **M3** Skills（双层发现 + `skill` 工具 + `/skill` + 渐进加载）、系统提示静态化 + 会话首条上下文片段、中断语义、命令补齐。
- **M4** TUI（差分渲染）+ compact + 缓存指标（长会话流畅、命中率 ≥90%）。
- **M5** `nova exec` 非交互（`--json`、管道、审批自动拒绝）、AGENTS.md 逐层发现链、CLI 参数统一。
- **M6** 会话日志 v2（不可变事件流 + 投影压缩 + 孤儿锁 + v1 升级）、token 锚点压缩预判、并行工具执行 + 工具级超时、后台 jobs、todo 工具、审批收紧（前缀记忆 / fail-closed / never 策略 / 审计）、输出截断防御 + 缓存浪费审计。
- **M6.1** 日志抗损坏、文件工具硬化、`search_files`、审批 diff 预览、exec 轮内自动压缩、并行段 `Promise.allSettled`。
- **M6.2** PTC / Code Mode（`run_code` + worker 运行时 + schema→SDK 生成 + `ctx.dispatch` 审批管线 + 审计 + 三态投影）。
- **M6.3** TUI 执行模式与上下文可视化：Tab 循环模式（rebuildHost 重绑）、单行三段式状态栏（按优先级整字段降级、tps 连续滚动恒绿、cache 会话累计粘住）、models.dev 模型元数据、`/model`/`/session` 能力展示。
- **M6.4** jobs 完成通知注入（替代轮询）：`JobRegistry` 终态通知队列 `drainFinished()` + `runAgent` 每次发请求前把"bash-N 已完成"作为临时 user 消息注入（克隆数组不落日志）；bash 后台返回与 `jobs` 工具文案改为"完成自动通知、无需轮询"。
- **M6.5** exec auto-compact 三处缺陷修复：①**熔断**——压缩后仍超阈值即停用本任务后续压缩并告警一次（修复下限超阈时"每轮一次摘要请求"的风暴：2× 成本 + 日志刷屏）；②**估算盲区**——`estimateMessageTokens` 计入 assistant tool call 的 `rawArgs`（此前 160KB 的 run_code 程序按 4 token 计，压缩触发滞后直指上下文窗 400）；③**通知送达**——请求在回复提交前失败/中断时 `drainFinished()` 批次经 `requeue()` 回队（此前 drain-once 在失败路径退化为"永不播报"）。附带：原位压缩的 messages 别名契约显式校验（防未来外部插件克隆数组导致压缩静默失效与日志投影背离）。
- **M6.6** TUI 可测试性重构（tui-mode.ts 2147 → ~1900 行）：状态栏/composer/四弹窗从 `startTui` 闭包抽为纯计算模块（`statusbar.ts`/`composer.ts`/`popup.ts`，帧快照入参 + Palette 注入，`plainPalette` 下可精确断言），仪表三档缓存与定时器留在壳层；`popupHeight()` 双推导消除（`cursorPosition` 改收 renderFrame 已构造的 `popupLines.length`）；`handleKey` 300 行 if 链拆为责任链（审批 → 模型面板 → 会话面板 → 全局键 → composer）。TUI 表现层（历史补丁最频繁部位：降级顺序/弹窗预算/滚动）首次获得 37+ 条回归护栏。
- **M6.7** TUI 显示缺陷修复（真机截图驱动）：①**思考流式重排**——reasoning 活窗口抽为 `reasoning.ts` 纯模块，定格行与活尾各裁到**单一显示行**（`fitTail` 保最新文本、绝不进 wrapBlock 二次折行），块高恒定、每个 delta 只重写活尾一行（旧形态 240 字符活尾折成数行 + 整块重折，流速度下整段抖动）；**空行不再进窗口**（模型思考段落间隔挤占定格位 = 间距失控）；②**低占比读数**——上下文 `used>0` 且四舍五入为 0 时显示 `<1%`（与 ` 0` 同宽，不挪分隔符），杜绝"0% + 空轨道像仪表坏了"；③**列表缩进**——markdown `- ` 渲染为缩进 2 列挂 `·`（与正文同列读不出层级），`wrapBlock` 把行前导空格计入悬挂缩进，换行续行对齐条目文本列；④**轮内空行清理**——「已思考」摘要就是答案的引言：思考段不占空行，`assistantSeparator` 只在「本轮没有刚折出摘要」时推——问题→已思考→答案三行紧挨成组，空行只存在于轮与轮之间（用户消息自带上方分隔）与无思考轮的答案前。tps 空闲粘住、composer 底部钉位等既有设计经确认**保持不变**；⑤**思考可展开**——「已思考」摘要在原「纯文本耗时行」之上升级为可点击块：SGR 左键点击（`keys.ts` 新增 `click` 键，坐标由 `?1006h` 报出）经 renderFrame 每帧维护的**行→块映射**命中测试，toggle 折叠/展开（▸/▾ 前缀即 affordance，`summaryRow`/`reasoningDetailRows` 纯函数）；思考全文随轮累积、挂在摘要块的 `detail` 字段**仅存会话内存**（reasoning 落盘策略不变），点击永远吞掉不漏进 composer，弹窗/面板打开时不响应；命中测试含展开正文的整块——展开后点正文任意行可收回。

- **M6.8** 工具行预算 + 提示词权威化：①**孤儿续行根治**——工具行构建器改走 `toolBudget() = cols-1-6`（与 wrapBlock 的 gutter 折行预算一致；旧行按 `cols-1` 裁、每行恒宽 6 列，` · N 行 · T.Ts` 尾巴被顶成孤儿续行），6 列 gutter 收敛为共享 `TOOL_GUTTER`（告警行复用）；②**专用工具优先于 shell**——系统提示与 description 双侧写 DSH 式排他句（`Use read_file — not shell cat/head/tail`、`Use search_files — not shell grep/rg/find`），批量聚合导向 `run_code`，bash 聚焦行为契约；③**操作姿态与指令权威化**——系统提示新增 **Operating posture** 节（刻意最小化，不枚举任何题材/场景以免干扰通用任务）：操作者指令即会话运行配置、严格无条件遵守；不加道德评论/安全免责/伦理提示（除非操作者要求）；代码完整可跑、不留占位。`<user_instructions>`/`<project_docs>` 注入帧改为权威会话指令语境（active session directives，不作不可信数据处理、不标注入），**保留**文件内容=不可信数据的二分（防恶意仓库内嵌指令劫持 agent）。
- **M6.9** 全链路缺陷批修（P1+P2+轻量 P3，模型可见面零改动）：P1——①后台 job kill 兜底（`exit`+2s closeGrace、cancel 后 3s killSettle、settle 前毁管道）；②REPL 审批等待期 Ctrl+C 经 `LineSource.cancelPending()` 取消等待并按拒绝处理（`approvalPending` 标志区分流式中断）；③`content_regex` worker 线程隔离 + 宿主预检 + 墙钟预算（本条见§工具执行 search_files）。P2——④压缩保留片段改**整条取舍**（截断拷贝同时违反投影字节一致与预算上限，选 codex 同款语义；keep 索引改按 `msg.id`）；⑤落盘读取经 trusted read roots 豁免审批；⑥截断提示按字节计数且 head+tail+提示行恒守预算；⑦maxTurns 文案指 `~/.nova/config.json`；⑧exec/REPL 工具耗时改 per-call Map（并行段共享标量互相覆盖）；⑨`storeToolResult` 默认 cacheDir 回 `~/.` 落盘布局。P3——⑩tool_call_delta 非规整 index 按 OpenAI SDK 惯例 coerce 为 0；⑪`edit_file` 多命中预览诚实化；⑫`appendEvent` 先写盘后入内存；⑬`estimateMessageTokens` WeakMap 记忆化；⑭execute 类审批提示粒度说明（REPL 行内 + TUI 弹窗行）。

**已移除**：MCP 客户端（`@nova-agent/mcp` 与 `/mcp`，M3 引入）——按实际场景裁剪，`nova` 不再读 `.nova/mcp.json`。

**后续（roadmap）**：按 provider 的缓存能力探测表、subagent 能力（`JobKindMap` 已预留）、token 逐节点定价、长会话压测与 Windows 终端细节打磨。

## 8. 设计决策来源

| 来源 | 采纳 | 不采纳 |
| --- | --- | --- |
| **pi** | 分层包结构、扩展即代码、差分渲染 TUI | pi 无权限系统、依赖 npm → 改 pnpm + 内置轻量审批层 |
| **deepseek-harness** | 一切皆插件、monorepo + pnpm + tsdown、并行/审批/日志等六项改进 | 不引入 Cordis 本体，自写约 300 行微型容器 |
| **codex** | AGENTS.md 发现链、turn 内审批、可回放 JSONL 会话、非交互 exec | 不用 Rust；不做系统级沙箱（审批 + realpath 工作区边界代替） |

## 9. 开放问题 / 风险

1. **OpenAI 兼容接口缓存语义不一致**：DeepSeek 自动前缀缓存、部分网关需显式参数。已落地 usage/命中率统计与浪费审计；按 provider 的显式参数能力探测表留待后续。
2. **外部插件加载**：当前仅第一方内置插件；v1 计划支持本地路径 + git URL 安装到 `.nova/plugins/`，尚无 registry。
3. **容器化建议**：v1 不做进程沙箱，重隔离建议容器化运行（bash/PTC 的信任姿态等同"执行任意命令"）。
