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
| `tui` | 零依赖终端 UI：行级差分渲染、原始按键解码、CJK 宽度处理 | `screen.ts`、`keys.ts`、`width.ts` |
| `cli` | 产品壳：全屏 TUI + readline 回落 + 非交互 exec + 配置发现 + 模型元数据 | `tui-mode.ts`、`repl.ts`、`exec.ts`、`commands.ts`、`config.ts`、`compact.ts`、`model-meta.ts`、`context.ts`、`system-prompt.ts`、`agents-md.ts`、`sessions.ts`、`ui.ts` |

## 5. 核心设计

### 一切皆插件
工具、斜杠命令、生命周期钩子（`beforeLLMCall` / `beforeToolCall` / `afterToolResult`）全部经 `PluginContext` 注册；内置 fs/bash 工具与 skills 走**同一 API、同一审批门**，保证内核最小。`PluginContext` 提供 `tools()` 活视图；`ToolExecuteContext` 提供 `dispatch` 嵌套分发缝（PTC 子调用回流用）。

### 上下文与缓存命中率（核心差异化）
目标：**稳定前缀 = 高缓存命中**。四层机制：
1. **前缀冻结**：系统提示字节稳定（persona + 工作方式 + 工具规则）；环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改。
2. **追加式日志**：对话严格 append-only；工具结果超 40KB 时全文落盘 `~/.nova/cache/tool-outputs/<sessionId>/`，消息体保留头部 60% + 尾部 40%（尾部常带测试失败详情）并附读取提示。
3. **compact**：`/compact`、自动阈值（`autoCompactTokenLimit`，以最近一次 usage 为锚点发请求**前**预判）共用同一实现；压缩**原位追加** `compaction/start → summary → end` 三事件，模型可见面由 `Session.deriveMessages()` 投影重建，原始历史永不改写；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）。摘要请求以序列化裁剪后的 transcript 发送，已有摘要时走增量合并。
4. **供应商对齐**：请求携带 `prompt_cache_key` 与 `x-session-id`/`x-session-affinity` 会话亲和头（sessionId=会话 id），让网关把同一会话固定路由到同一缓存节点。指标目标：会话第 3 轮起 prompt cache 命中率 ≥ 90%（`/session` 可查）。

### 会话日志 v2（不可变事件流 + 投影）
JSONL 从裸消息升级为事件流（`message` / `compaction/*` / `todo/write` / `approval` / `code-dispatch` 审计）。压缩不重开会话；v1 旧会话打开时原子升级。**抗损坏**：进程被杀导致的末尾半行在 `Session.open` 时自动截断修复（不告警），中段真损坏行跳过并告警——单条坏行不再让整个会话无法 resume。

### 审批与权限（轻量版，对标 codex）
三档：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）。execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 按**命令程序前缀**记忆（`git status` 放行后续 `git ...`，不波及 `rm`），其余按工具名+类型记忆；asker 抛错一律拒绝（fail-closed）；exec/CI 走服务内 `never` 策略确定性拒绝；每次决定写入 `approval` 审计事件（log-only，可回放）。审批弹窗上方实时渲染 `edit_file` 的 `- 旧行 / + 新行` diff、`write_file` 的目标+首行预览（工具经可选 `preview(args)` 声明）。

### 工具执行
- **文件工具硬化**：`write_file`/`edit_file` 越界检查跑在 **realpath 规范化路径**上（堵死符号链接跟穿逃逸）；写用同目录 tmp + rename 原子替换；`edit_file` 带陈旧检测（读后被外部改动则拒绝）；`read_file` 有 8 MiB 上限与二进制探测。
- **并行执行**：工具可声明 `isConcurrencySafe` 纯同步分类器，相邻多个 opt-in 调用整段并行（审批仍逐个串行），结果按原调用顺序写入保持确定性；并行段用 `Promise.allSettled` 收敛避免 unhandledRejection。`read_file`/`list_dir`/`search_files`/`jobs`/`todo_write` 默认并发安全。工具可声明 `timeoutMs` 协作超时。
- **输出截断防御**：`finish_reason=length` 的截断消息中**所有 tool call 一律不执行**（流式参数可能静半截），整批以错误结果回填让模型重发。
- **search_files**：`content_regex`（逐行正则，返回 `path:line: text`）与 `name_glob`（工作区相对路径 glob）二选一；默认跳过 `.git`/`node_modules`/`dist` 与点目录、绝不跟随符号链接、单文件 1 MiB 扫描上限、结果数上限（默认 200）。

### PTC / Code Mode（对标 Cloudflare/dsh run_code 简化版）
`tools.code.mode` 三态 `native|ptc|both`。开启后模型获得 `run_code {code, description}` 传输工具：写一段 async TypeScript 程序，`await tools.name(args)` 即子调用，**穿过与原生调用完全相同的管线**（审批门 + 钩子 + 超时/中断，经 `ctx.dispatch` 回流）。只有程序 print/return 的策展输出进入上下文，中间结果只落 `code-dispatch` 审计。执行基底是**每 run 全新 worker 线程**（信任姿态等同 bash）：剥型、空环境、堆/busy-time/墙钟/输出四类预算、端口协议逐字段防御。SDK 声明由 schema 字典序生成（字节稳定不吃缓存）。`ptc` 态只暴露 `run_code`。需 Node ≥ 22.19。

### 后台 jobs / todo
`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，`jobs` 工具（list/output/stop）轮询增量输出；`JobKindMap` 预留 `subagent` 扩展位。`todo_write` 整表替换、last-write-wins，快照持久化为 log-only `todo/write` 事件，不占模型上下文。

### Skills（渐进加载）
启动只把每个 skill 的 name+description 注入索引，命中触发词时才加载正文——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发。项目级 `.nova/skills/` 优先于用户级 `~/.nova/skills/`。

### TUI（自研差分渲染，codex 风格）
alternate screen + 行级 diff 重绘（React-free）；`/` 命令面板（↑↓ 选择、Tab 补全、输入历史）；审批弹窗（y/n/a）；PageUp/PageDown/滚轮滚动（上滚时状态栏提示，↓/滚轮回到底）；Ctrl+C 中断当前轮（空闲时两段退出）；多行 composer（粘贴保留换行、软换行最多 8 行窗口、↑↓ 行间移动）；流式 markdown、工具调用折叠块、reasoning 暗色尾迹（结束后折成"已思考 Ns"）；长命令实时显示已耗时与输出尾行；系统通知（Windows toast / macOS osascript / Linux notify-send）。

**单行状态栏**三段式 `上下文仪表 │ 模型 · 执行模式 · 审批档位 │（右缘）tps · cache`——`│` 分大组、`·` 分组内，层级靠分隔符而非字数堆砌：
- **上下文仪表**：按整窗真实比例分段上色（提示词青 / 工具 schema 绿 / 注入片段蓝 / 技能索引品红 / 消息黄），加粗「已用/总量 · 百分比」，超窗标红；`压缩 %` 只在真正逼近阈值时出现（T0 常驻、T1 ≥50%、T2 ≥70%）。
- **空间不足按优先级整字段降级，绝不词中截断**：T0 全量 → T1 去 `模式/审批` 标签、模型去供应商前缀 → T2 仪表只留条+百分比、审批降单字（读/编/全）、模型截断 → 极窄时弃模型名（banner 与 `/model` 已可见）。右缘仪表组定宽不随 tick 变宽、百分比与数值 `padStart` 位数跳动不挪分隔符、截左不截右。
- **tps 速度表**：500ms×10 环形窗口，**会话级连续滚动**（发新消息不清空、无新输出不排空到 0），恒绿色（"是否在生成"由 composer 前缀 spinner 表达）。
- **cache 命中率**：取**会话累计**值且**粘住可见性**——provider 随机分流到不报缓存的后端会让单轮值抖动、整段闪现，故一旦本会话见过缓存上报就常驻，从未上报则整段隐藏。
- **模型元数据（models.dev）**：启动后台拉 `https://models.dev/api.json`，解析为精简目录落盘缓存（`~/.nova/cache/models-dev.json`，24h TTL，断网用旧缓存），按模型 id 精确→尾段匹配解析上下文窗口/模态/推理/工具/附件能力，喂给结构进度条分母；明细在 `/model` 面板与 `/session`。
- **执行模式**：新会话未开始时按 Tab 循环 普通 → PTC → 混合（rebuildHost 统一重绑 host+hooks；Node 不满足 22.19 时拒绝并保持原模式；区别见 `/mode`，切换不留历史行、状态栏模式标即时变化）。

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

**已移除**：MCP 客户端（`@nova-agent/mcp` 与 `/mcp`，M3 引入）——按实际场景裁剪，`nova` 不再读 `.nova/mcp.json`。

**后续（roadmap）**：按 provider 的缓存能力探测表、jobs 完成通知改钩子注入（替代轮询）、subagent 能力（`JobKindMap` 已预留）、token 逐节点定价、长会话压测与 Windows 终端细节打磨。

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
