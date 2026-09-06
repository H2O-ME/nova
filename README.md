# NovaAgent

自研、插件化、轻量化的跨平台本地智能体框架（M6 里程碑）。

- **架构**：pnpm monorepo，`core`（agent 事件流循环 + 会话 + 钩子）/ `ai`（OpenAI 兼容手写 SSE 客户端）/ `plugins`（插件容器 + 权限 + 内置工具 + skills）/ `mcp`（MCP 客户端：stdio + Streamable HTTP）/ `tui`（自研行级差分渲染 + 按键解码 + CJK 宽度）/ `cli`（全屏 TUI + readline 回落）。设计目标见 [docs/GOALS.md](docs/GOALS.md)。
- **一切皆插件**：工具、斜杠命令、生命周期钩子（beforeLLMCall / beforeToolCall / afterToolResult）全部经 `PluginContext` 注册；内置 fs/bash 工具、skills 与第三方 MCP 工具走同一 API、同一审批门。
- **全屏 TUI**（codex 风格）：alternate screen + 差分重绘、`/` 命令面板（↑↓ 选择、Tab 补全、输入历史）、审批弹窗（y/n/a）、状态栏（模型/审批档位/token/缓存命中率）、PageUp/PageDown 滚动、Ctrl+C 中断与两段退出；非 TTY 或 `--repl` 自动回落 readline。
- **上下文缓存友好**（codex WorldState 式简化版）：系统提示字节稳定（persona + 工作方式 + 工具规则），环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改——稳定前缀 = 高缓存命中。请求携带 `prompt_cache_key` 与 `x-session-id`/`x-session-affinity` 会话亲和头（pi 式缓存路由，sessionId=会话 id），让网关把同一会话固定路由到同一缓存节点。状态栏与 `/session` 显示累计与上轮缓存命中率，`/session` 另报**缓存浪费审计**（超 1024 token 噪声底的 miss tok/轮次，仅在 provider 报告过缓存后计数）。中断轮次写入 `turn_aborted` 标记，模型能感知上一轮被打断。
- **工具结果 head+tail 截断**（codex truncate_middle 式）：超过 40KB 的工具输出全文落盘 `.nova/cache/tool-outputs/<sessionId>/`（`wx` 排他写入，按会话分组），消息体内保留头部 60% + 尾部 40%（尾部通常携带测试失败详情等最新信息），中段标记行内附读取提示——模型可用 read 工具取回全文。
- **会话日志 v2（不可变事件流 + 投影）**（dsh "model-visible means logged"）：JSONL 从裸消息升级为事件流（message / compaction/* / todo/write / approval 审计），**压缩不再重开会话**——原位追加 `compaction/start → summary → end` 三个事件，模型可见面（上下文片段 + 最近用户消息 + 摘要）由 `Session.deriveMessages()` 投影重建，原始历史永不改写；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）；v1 旧会话打开时原子升级。
- **自动 compact（锚点预判 + 兜底）**：以最近一次成功调用的 usage 为锚点，发请求**前**用增量估价（CJK 1 token/字、其余 4 字符/token）预判下一轮 prompt tokens，超阈值提前压缩；调用后超限仍作为兜底触发；`/compact` 手动触发同一流程；TUI 状态栏实时显示"预估 N tok"。摘要请求以**序列化裁剪后的 transcript**发送（`[User]/[Assistant]/[Tool x]` 行式，tool result 截 2000 字符，静态上下文片段与旧摘要剔除），摘要本身也省 token；会话已有摘要时走**增量合并**（pi preserve-and-update：旧摘要嵌入 `<previous_summary>`，只对新消息做保留式更新）。
- **并行工具执行**（dsh isConcurrencySafe 式）：工具可声明 `isConcurrencySafe` 纯同步分类器，相邻多个 opt-in 调用整段并行（审批仍逐个串行），结果按原调用顺序写入日志保持确定性；`read_file`/`list_dir`/`jobs`/`todo_write` 默认并发安全，bash/fs-write 不并发。工具还可声明 `timeoutMs` 协作超时（合并 AbortSignal + race 兜底，绝不进模型 schema）。`finish_reason=length` 的截断消息中**所有 tool call 一律不执行**（pi 式防御：流式参数经 best-effort 修复可能静默不完整），整批以错误结果回填让模型重发；ai 层重试优先尊重 429 的 `Retry-After` 头。TUI 键入绕过帧预算同步渲染（pi 式抢占），流式输出仍走 16ms 合帧。
- **后台任务 jobs**（dsh jobs seam 简化版）：`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，stdout/stderr 流入字节上限缓冲，`jobs` 工具（action: list / output / stop）轮询增量输出与终止任务；`done` 在资源释放后才 resolve，会话退出统一 dispose；`JobKindMap` 预留 `subagent` 扩展位。
- **MCP**（GOALS §6）：`.nova/mcp.json` 配置 stdio 与 remote（Streamable HTTP）服务器，支持 `{env:NAME}` / `{file:path}` 引用展开与 `enabled` 开关；工具以 `mcp__<server>__<tool>` 命名进统一工具表，stdio 工具需 `execute`、remote 工具需 `network` 审批；`/mcp` 查看状态；服务器启动失败只告警不阻断。
- **Skills**（GOALS §7）：`.nova/skills/<name>/SKILL.md`（项目级 + `~/.nova/skills/` 用户级，项目级优先），frontmatter 只含 name/description，启动只注入索引，正文按需加载——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发。
- **三档审批 + fail-closed**：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）；execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 按**命令程序前缀**记忆（`git status` 放行后续 `git ...`，不波及 `rm`），其余按工具名+类型记忆；asker 抛错一律拒绝（fail-closed）；exec/CI 走服务内 `never` 策略，确定性拒绝、不进任何 asker；每次决定写入 `approval` 审计事件（log-only，可回放）。
- **todo 工具**（dsh 极简式）：`todo_write` 整表替换、last-write-wins，条目仅 `content` + 三态 `status`（故意不给 id/priority）；快照持久化为 log-only `todo/write` 事件，resume 后可从日志重建，不占模型上下文。
- **AGENTS.md 发现链**（codex 式）：从工作区根到当前目录逐层收集 AGENTS.md（根在前），共享 32KB 字节预算，注入 `<project_docs>` 片段；`/init` 生成初版。
- **双形态**：`nova`（无参）→ 交互 TUI/readline；`nova exec "<task>"` → 非交互单次执行，`--json` 输出 AgentEvent JSONL（CI 友好，可管道传入任务）；exec 无法交互确认，未放行的审批请求自动拒绝。
- **数据落盘（零工作区写入，codex 式）**：一切数据都在 `~/.nova/` 下——配置 `~/.nova/config.json`（唯一来源）、MCP `~/.nova/mcp.json`（也支持项目内 `.nova/mcp.json`，只读查找）、技能 `~/.nova/skills/`（+项目级 `.nova/skills/`，只读）、会话 `~/.nova/sessions/YYYY/MM/DD/`（按日期归档，全局不分项目）、溢出缓存 `~/.nova/cache/tool-outputs/<sessionId>/`。运行 nova 的目录就是工作区，但 nova 不在其中创建任何文件。
- **轮数上限与自定义 shell**：`maxTurns` 限制单次任务最大轮数（默认 30，上限 500，到顶以 `max_turns` 停止）；`tools.bash.shellPath` 显式指定 bash 可执行文件（默认自动探测）；`systemPrompt` 作为附加用户指令注入会话首条上下文片段（不是替换内核系统提示，前缀缓存不受影响）。
- **输出截断防御 + 缓存浪费审计**（pi cache-stats 式）：`finishReason=length`（输出 token 上限截断）时，该批工具调用全部判失败——流式参数可能静默半截，模型下一轮重发完整调用；usage 统计含缓存浪费（`missTokens`：仅统计超出噪声底 1024 tok 的全价 token，供应商从未上报过缓存则不计），`/session` 与 TUI 状态栏可见。
- **模型接入**：任意 OpenAI 兼容端点（`baseURL` + `apiKey` + `model`，可选 `temperature` / `maxTokens`），支持流式、工具调用、重试与断流自愈（429/5xx 指数退避并优先尊重 `Retry-After`；流中途断开、网关 error 事件、无 finish_reason 收尾同样自动重试，半截输出先以 `reset` 事件通知消费者丢弃再从头重放）、usage/缓存命中统计（兼容 DeepSeek 的 `prompt_cache_hit_tokens`）；推理模型的 `reasoning_content` 流以暗色尾迹实时显示（REPL/TUI），不写入会话日志、不破坏前缀缓存。`/model` 自动拉取站点模型目录（`GET /models`，60s 缓存）：TUI 弹出**交互式选择面板**（↑↓ 滚动、Enter 切换、Esc 取消，长列表滑动窗口不灌历史），REPL 列出后追问序号切换。

## 快速开始

```bash
pnpm install
pnpm build

# ~/.nova/config.json —— 唯一的配置文件（{env:MY_KEY} 引用环境变量）
# 项目目录里不需要、也不会产生任何 .nova/ 文件；会话在 ~/.nova/sessions/年/月/日/ 下。
# {
#   "provider": {
#     "baseURL": "https://api.example.com/v1",
#     "apiKey": "sk-...",         // 或 "{env:MY_KEY}"
#     "model": "model-name",
#     "temperature": 0.7,         // 可选：采样温度透传
#     "maxTokens": 8192           // 可选：透传 max_tokens
#   },
#   "approval": "read-only",      // read-only | auto-edit | full
#   "notify": true,               // 可选：系统通知（审批/长任务完成/出错弹 toast），NOVA_NO_NOTIFY=1 亦可关闭
#   "systemPrompt": "补充指令…",    // 可选：附加用户指令，注入会话首条上下文片段
#   "maxTurns": 30,               // 可选：单次任务最大轮数（默认 30，上限 500）
#   "autoCompactTokenLimit": 60000, // 可选：上轮 prompt tokens 超限自动压缩会话
#   "tools": { "bash": { "enabled": true, "timeoutMs": 60000, "shellPath": "C:/Program Files/Git/bin/bash.exe" } }
# }

# ~/.nova/mcp.json —— 可选（项目内 .nova/mcp.json 优先，只读查找）
# {
#   "mcp": {
#     "fathom": {
#       "type": "remote",
#       "url": "https://fathomsearch.xyz/mcp",
#       "enabled": true,
#       "headers": { "X-API-KEY": "{env:FATHOM_API_KEY}" }
#     },
#     "files": {
#       "type": "stdio",
#       "command": "npx",
#       "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
#     }
#   }
# }

# ~/.nova/skills/<name>/SKILL.md —— 可选，frontmatter 仅 name/description

pnpm nova          # 交互运行（TTY 下全屏 TUI；非 TTY 自动回落 readline；--repl 强制 readline）
pnpm nova -- --approval auto-edit                 # 临时覆盖审批档位
pnpm nova -- --resume ~/.nova/sessions/<YYYY/MM/DD>/<id>.jsonl      # 续接历史会话
pnpm nova -- exec "修复失败的测试" --json         # 非交互单次执行（JSONL 事件流，也可管道传入任务）

# 全局命令（任意工作目录直接 `nova`）：
cd packages/cli && npm link    # 生成 nova.cmd 到 npm 全局 bin（已在 PATH）；改代码后重新 pnpm build 即生效
```

TUI 命令面板：输入 `/` 弹出带边框的下拉面板（命令 + 说明对齐、选中行整行反色、↑↓ 选择、Tab 补全、Enter 执行、Esc 关闭），支持 `/help /init /model /approvals /plugins /mcp /skill /session /new /compact /clear /exit`；PageUp/PageDown 或鼠标滚轮滚动历史（上滚时状态栏提示，↓/滚轮回到底部）；Ctrl+C 中断当前轮（空闲时按两次退出）。composer 支持多行：粘贴保留换行并软换行显示（最多 8 行窗口，上下溢出有提示），多行输入下 ↑↓ 在行间移动光标。长命令运行时工具行实时显示已耗时与输出尾行。需要审批、长任务完成/出错时弹系统通知（Windows toast / macOS osascript / Linux notify-send，`notify: false` 关闭）。

每轮结束的状态行显示 token 用量与缓存命中率（取自网关返回的 `prompt_tokens_details.cached_tokens`，兼容 DeepSeek 的 `prompt_cache_hit_tokens`）。

## 开发

```bash
pnpm verify   # build + typecheck + test
pnpm test     # vitest（ai 层注入 fetch + SSE fixture；mcp 层用 stdio fixture 服务器与假 fetch，不发真实请求）
pnpm lint     # oxlint
pnpm dev      # tsx 直跑 cli（免构建）
```

## 里程碑

已交付（M1）：agent 循环（async generator 事件流）、append-only 消息模型、工具调用闭环、工具结果超限落盘、JSONL 会话持久化/回放、缓存命中率统计。

已交付（M2）：插件容器（`PluginHost`：工具/命令/钩子注册 + 钩子组合）、权限服务（三档审批 + always 记忆）、内置工具插件 `read_file`/`list_dir`/`write_file`/`edit_file`（工作区路径白名单）与 `bash`（跨平台 shell 探测：Windows 优先 Git Bash，回落 PowerShell 并强制 UTF-8 输出编码）、core 三钩子点、`/plugins` 命令与 `--approval` 参数。

已交付（M3）：`@nova-agent/mcp` 包（`.nova/mcp.json` 发现链、stdio/Streamable HTTP 传输、`mcp__<server>__<tool>` 统一注册与审批接入）、Skills（`.nova/skills/` 双层发现 + `skill` 工具 + `/skill` 命令 + 渐进加载）、系统提示静态化与会话首条 user 上下文片段（环境/用户指令/技能索引）、中断语义完善（`turn_aborted` 标记 + 排队工具标记未执行）、REPL/TUI 命令补齐。

已交付（M4）：自动 compact（`autoCompactTokenLimit` 阈值触发，压缩后按 codex 式三段重建：上下文片段 + 最近用户消息按字符预算保留 + 摘要）、`/compact` 与手动压缩共用同一实现、缓存指标深化（状态行/状态栏/`/session` 均显示上轮命中率）。

已交付（M5）：`nova exec` 非交互模式（`--json` JSONL 事件输出、管道输入、审批请求自动拒绝、会话照常落盘）、AGENTS.md 逐层发现链注入 `<project_docs>` 片段（32KB 共享预算）、CLI 参数解析统一。

已交付（M6）：deepseek-harness 六项改进落地——会话日志 v2（不可变事件流 + 投影压缩 + 孤儿锁检测 + v1 会话自动升级）、token 锚点压缩预判、并行工具执行（`isConcurrencySafe`）+ 工具级协作超时、后台 jobs（bash 后台 + `jobs` 工具，`JobKindMap` 预留 `subagent` 扩展位）、todo 工具（log-only 整表替换）、审批收紧（bash "always" 按命令前缀记忆 / fail-closed / 服务内 `never` 策略 / approval 审计事件）。另含输出截断防御（length 停止时整批工具调用判失败）与缓存浪费审计（噪声底 1024 tok）。

后续（见 docs/GOALS.md）：按 provider 的缓存能力探测表、jobs 完成通知改为钩子注入（替代轮询）、subagent 能力（`JobKindMap` 已预留）、长会话压测与 Windows 终端细节打磨。
