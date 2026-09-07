# NovaAgent

自研、插件化、轻量化的跨平台本地智能体框架（M6.3 里程碑）。

- **架构**：pnpm monorepo，`core`（agent 事件流循环 + 会话 + 钩子）/ `ai`（OpenAI 兼容手写 SSE 客户端）/ `plugins`（插件容器 + 权限 + 内置工具 + skills）/ `tui`（自研行级差分渲染 + 按键解码 + CJK 宽度）/ `cli`（全屏 TUI + readline 回落）。设计目标见 [docs/GOALS.md](docs/GOALS.md)。
- **一切皆插件**：工具、斜杠命令、生命周期钩子（beforeLLMCall / beforeToolCall / afterToolResult）全部经 `PluginContext` 注册；内置 fs/bash 工具与 skills 走同一 API、同一审批门。
- **全屏 TUI**（codex 风格）：alternate screen + 差分重绘、`/` 命令面板（↑↓ 选择、Tab 补全、输入历史）、审批弹窗（y/n/a）、状态栏（模型/审批档位/token/缓存命中率）、PageUp/PageDown 滚动、Ctrl+C 中断与两段退出；非 TTY 或 `--repl` 自动回落 readline。**新会话按 Tab 循环执行模式**（普通 → PTC → 混合，重建插件 host 生效，Node 不满足 22.19 时拒绝并保持原模式；区别随时可查 `/mode`，切换不留历史行、状态栏模式标即时变化）；**单行状态栏**三段式 `上下文仪表 │ 模型 · 执行模式 · 审批档位 │（右缘）tps · cache`——`│` 分大组、`·` 分组内，层级靠分隔符而非字数堆砌。**上下文仪表**按整窗真实比例分段上色（提示词青/工具 schema 绿/注入片段蓝/技能索引品红/消息黄，加粗「已用/总量 · 百分比」，超窗标红；压缩阈值 `压缩 %` 只在真正逼近时出现——17% 的压缩进度是噪音不是信息，T0 常驻、T1 起 ≥50% 才显示、T2 ≥70%）。**空间不足按优先级整字段降级**，绝不词中截断（旧版把模型名切剩 `c`、`审批 自动编辑` 切剩 `审批 自` 就是纯字符裁剪的恶果）：T0 全量 → T1 去 `模式/审批` 标签、模型去供应商前缀 → T2 仪表只留条+百分比、审批降单字（读/编/全）、模型截断 → 极窄时**弃模型名**（banner 与 `/model` 已可见，留压力/模式/审批这些「这一轮正在发生什么」）。右缘 **tps 速度表**（▁▂▇ 58，500ms×10 环形窗口，**会话级连续滚动**——发新消息不清空、不闪回 0；恒绿色，不再因工具等待/空闲转灰，"是否在生成"由 composer 前缀 spinner 表达）与 **cache 命中率**钉死屏缘：cache 取**会话累计**命中率且**粘住可见性**——provider 随机分流到不报缓存的后端会让单轮值 0↔N% 抖动、整段闪现，故一旦本会话见过缓存上报就常驻（从未上报的 provider 则整段隐藏、不占屏缘宽度）；仪表组定宽不随 tick 变宽、百分比与数值 `padStart` 位数跳动不挪分隔符、空间不足截左不截右——杜绝旧版动词轮换/秒数递增引发的闪烁与 cache「时有时无」；活动指示在 composer 前缀 spinner，累计 token 与分段明细在 `/session`，模态能力标在 `/model` 与 `/session`。流式动画（spinner + 整秒计时）挂在 composer 输入行，状态行稳定字段不随帧 tick 横移，窄终端按显示宽降级不折行。
- **模型元数据（models.dev）**：启动后台拉取 `https://models.dev/api.json`，解析为精简目录落盘缓存（`~/.nova/cache/models-dev.json`，24h TTL，断网用旧缓存），按模型 id 精确 → 尾段匹配解析**上下文窗口、输入/输出模态、推理/工具/附件能力**，喂给结构进度条分母，明细在 `/model` 面板与 `/session` 展示；自部署或目录未收录时用 `provider.contextWindow` 手动兜底。
- **上下文缓存友好**（codex WorldState 式简化版）：系统提示字节稳定（persona + 工作方式 + 工具规则），环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改——稳定前缀 = 高缓存命中。请求携带 `prompt_cache_key` 与 `x-session-id`/`x-session-affinity` 会话亲和头（pi 式缓存路由，sessionId=会话 id），让网关把同一会话固定路由到同一缓存节点。状态栏与 `/session` 显示累计与上轮缓存命中率，`/session` 另报**缓存浪费审计**（超 1024 token 噪声底的 miss tok/轮次，仅在 provider 报告过缓存后计数）。中断轮次写入 `turn_aborted` 标记，模型能感知上一轮被打断。
- **工具结果 head+tail 截断**（codex truncate_middle 式）：超过 40KB 的工具输出全文落盘 `~/.nova/cache/tool-outputs/<sessionId>/`（`wx` 排他写入，按会话分组），消息体内保留头部 60% + 尾部 40%（尾部通常携带测试失败详情等最新信息），中段标记行内附读取提示——模型可用 read 工具取回全文。`read_file` 自身带 8 MiB 上限与二进制探测，超大/二进制文件直接报错并提示改用 bash 分块读，不再整文件 `readFile` 撑爆内存。
- **会话日志 v2（不可变事件流 + 投影）**（dsh "model-visible means logged"）：JSONL 从裸消息升级为事件流（message / compaction/* / todo/write / approval 审计），**压缩不再重开会话**——原位追加 `compaction/start → summary → end` 三个事件，模型可见面（上下文片段 + 最近用户消息 + 摘要）由 `Session.deriveMessages()` 投影重建，原始历史永不改写；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）；v1 旧会话打开时原子升级。**日志抗损坏**：进程被杀导致的半行（末尾无换行的残缺 JSON）在 `Session.open` 时自动截断修复（不告警，降级为"那次追加没发生"），中段真损坏行则跳过并告警——单条坏行不再让整个会话无法 resume。
- **文件工具硬化（M1 沙箱的纵深）**：`write_file`/`edit_file` 的越界检查跑在 **realpath 规范化路径**上（解析最深存在祖先的真实路径 + 未存在余段），堵死工作区内符号链接指向外部再被写入跟穿逃逸；写用**同目录 tmp + rename 原子替换**（崩溃/读者不见半文件）；`edit_file` 带**陈旧检测**——读后文件被外部改动（mtime/size 变）则拒绝编辑并让模型重读，杜绝拿旧快照静默覆盖。`write_file` 缺 `content` 直接报错（不再写空串清空文件）。
- **工作区搜索工具 `search_files`**：编码 agent 的必备高频件，此前只能绕道 bash。`content_regex`（逐行正则，返回 `path:line: text`）与 `name_glob`（工作区相对路径 glob，如 `**/*.test.ts`）二选一；默认跳过 `.git`/`node_modules`/`dist` 与点目录、绝不跟随符号链接、单文件 1 MiB 扫描上限、结果数上限（默认 200）。与 fs 读同级只读、并发安全。
- **审批预览（diff）**：`edit_file` 审批弹窗上方实时渲染 `- 旧行 / + 新行` 摘要、`write_file` 显示目标与首行（REPL 与 TUI 弹窗共有，异步 best-effort、不阻塞、预览只读不改文件）——用户批准的是"这次编辑实际会做什么"，而非截断的 args JSON。工具经可选 `preview(args)` 声明效果预览，第一方与第三方插件同 API。
- **自动 compact（锚点预判 + 兜底）**：以最近一次成功调用的 usage 为锚点，发请求**前**用增量估价（CJK 1 token/字、其余 4 字符/token）预判下一轮 prompt tokens，超阈值提前压缩；调用后超限仍作为兜底触发；`/compact` 手动触发同一流程；TUI 状态栏实时显示"预估 N tok"。**exec 无人值守模式在每次 `beforeLLMCall` 轮内做同样的预判**（exec 全程只有一个 runAgent，边界检查触发不到，钩子是唯一压缩点）。摘要请求以**序列化裁剪后的 transcript**发送（`[User]/[Assistant]/[Tool x]` 行式，tool result 截 2000 字符，静态上下文片段与旧摘要剔除），摘要本身也省 token；会话已有摘要时走**增量合并**（pi preserve-and-update：旧摘要嵌入 `<previous_summary>`，只对新消息做保留式更新）。
- **并行工具执行**（dsh isConcurrencySafe 式）：工具可声明 `isConcurrencySafe` 纯同步分类器，相邻多个 opt-in 调用整段并行（审批仍逐个串行），结果按原调用顺序写入日志保持确定性；`read_file`/`list_dir`/`search_files`/`jobs`/`todo_write` 默认并发安全，bash/fs-write 不并发。并行段用 `Promise.allSettled` 收敛——单个调用的落盘失败转成错误结果而非无人 await 的 promise，避免 unhandledRejection 崩掉进程、留下缺 result 的 tool_calls 毁掉后续请求。工具还可声明 `timeoutMs` 协作超时（合并 AbortSignal + race 兜底，绝不进模型 schema）。`finish_reason=length` 的截断消息中**所有 tool call 一律不执行**（pi 式防御：流式参数经 best-effort 修复可能静默不完整），整批以错误结果回填让模型重发；ai 层重试优先尊重 429 的 `Retry-After` 头。TUI 键入绕过帧预算同步渲染（pi 式抢占），流式输出仍走 16ms 合帧。
- **PTC 模式（Code Mode，Cloudflare/dsh run_code 简化版）**：LLM 写代码比发工具调用更强——`tools.code.mode` 三态 `native|ptc|both`。开启后模型获得 `run_code {code, description}` 传输工具：针对工具注册表写一段 **async TypeScript 程序**，程序里 `await tools.name(args)` 即子调用，**穿过与原生调用完全相同的管线**（审批门 + beforeToolCall 钩子 + 超时/中断，经 `ctx.dispatch` 回流到循环）；被拒的子调用以 `ToolCallError.toolName` 抛回程序可 try/catch。只有程序 print/return 的**策展输出**进入上下文，中间结果不落消息日志、只落 `code-dispatch` 审计事件（args/result 预览封顶）。子分发按提交序启动：并发安全工具在 `maxParallelSubCalls`（默认 10）内重叠、写类调用排空池独占执行。执行基底是**每 run 全新 worker 线程**（非安全边界，信任姿态等同 bash）：宿主 `stripTypeScriptTypes` 剥型（仅可擦除 TS，行号保持）、`env:{}` 空环境、堆上限、**busy-time（eventLoopUtilization）+ 墙钟双预算**、外层输出字节账本、端口协议逐字段防御（对端跑的是模型代码）。SDK 声明由 schema 字典序生成（JSDoc 折入描述、异常键名带引号可达，字节稳定不吃缓存）；`ptc` 态只向模型暴露 `run_code`（其余工具降为程序内绑定 + 系统提示尾部 "direct calls are OFF" 声明）。审批弹窗上方 preview 渲染程序前 12 行。需要 Node ≥ 22.19。
- **后台任务 jobs**（dsh jobs seam 简化版）：`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，stdout/stderr 流入字节上限缓冲，`jobs` 工具（action: list / output / stop）轮询增量输出与终止任务；`done` 在资源释放后才 resolve，会话退出统一 dispose；`JobKindMap` 预留 `subagent` 扩展位。
- **Skills**（GOALS §7）：`.nova/skills/<name>/SKILL.md`（项目级 + `~/.nova/skills/` 用户级，项目级优先），frontmatter 只含 name/description，启动只注入索引，正文按需加载——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发。
- **三档审批 + fail-closed**：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）；execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 按**命令程序前缀**记忆（`git status` 放行后续 `git ...`，不波及 `rm`），其余按工具名+类型记忆；asker 抛错一律拒绝（fail-closed）；exec/CI 走服务内 `never` 策略，确定性拒绝、不进任何 asker；每次决定写入 `approval` 审计事件（log-only，可回放）。
- **todo 工具**（dsh 极简式）：`todo_write` 整表替换、last-write-wins，条目仅 `content` + 三态 `status`（故意不给 id/priority）；快照持久化为 log-only `todo/write` 事件，resume 后可从日志重建，不占模型上下文。
- **AGENTS.md 发现链**（codex 式）：从工作区根到当前目录逐层收集 AGENTS.md（根在前），共享 32KB 字节预算，注入 `<project_docs>` 片段；`/init` 生成初版。
- **双形态**：`nova`（无参）→ 交互 TUI/readline；`nova exec "<task>"` → 非交互单次执行，`--json` 输出 AgentEvent JSONL（CI 友好，可管道传入任务）；exec 无法交互确认，未放行的审批请求自动拒绝。
- **数据落盘（零工作区写入，codex 式）**：一切数据都在 `~/.nova/` 下——配置 `~/.nova/config.json`（唯一来源）、技能 `~/.nova/skills/`（+项目级 `.nova/skills/`，只读）、会话 `~/.nova/sessions/YYYY/MM/DD/`（按日期归档，全局不分项目）、溢出缓存 `~/.nova/cache/tool-outputs/<sessionId>/`。运行 nova 的目录就是工作区，但 nova 不在其中创建任何文件。
- **轮数上限与自定义 shell**：`maxTurns` 限制单次任务最大轮数（默认 30，上限 500，到顶以 `max_turns` 停止）；`tools.bash.shellPath` 显式指定 bash 可执行文件（默认自动探测）；`systemPrompt` 作为附加用户指令注入会话首条上下文片段（不是替换内核系统提示，前缀缓存不受影响）。
- **输出截断防御 + 缓存浪费审计**（pi cache-stats 式）：`finishReason=length`（输出 token 上限截断）时，该批工具调用全部判失败——流式参数可能静默半截，模型下一轮重发完整调用；usage 统计含缓存浪费（`missTokens`：仅统计超出噪声底 1024 tok 的全价 token，供应商从未上报过缓存则不计），`/session` 与 TUI 状态栏可见。
- **模型接入**：任意 OpenAI 兼容端点（`baseURL` + `apiKey` + `model`，可选 `temperature` / `maxTokens`），支持流式、工具调用、重试与断流自愈（429/5xx 指数退避并优先尊重 `Retry-After`；流中途断开、网关 error 事件、无 finish_reason 收尾同样自动重试，半截输出先以 `reset` 事件通知消费者丢弃再从头重放）、usage/缓存命中统计（兼容 DeepSeek 的 `prompt_cache_hit_tokens`）；推理模型的 `reasoning_content` 流以暗色尾迹实时显示（REPL/TUI），不写入会话日志、不破坏前缀缓存；TUI 里思考正文只保留最后 2 行活尾，一段思考结束后整块折成一行 `已思考 Ns` 摘要——过程可感知，但自言自语不占对话区。`/model` 自动拉取站点模型目录（`GET /models`，60s 缓存）：TUI 弹出**交互式选择面板**（↑↓ 滚动、Enter 切换、Esc 取消，长列表滑动窗口不灌历史），REPL 列出后追问序号切换。

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
#   "tools": {
#     "bash": { "enabled": true, "timeoutMs": 60000, "shellPath": "C:/Program Files/Git/bin/bash.exe" },
#     "code": { "mode": "ptc" }        // 可选：PTC 模式（native|ptc|both，缺省不加载；TUI 里新会话按 Tab 可直接循环切换）；
#                                       // 另支持 maxParallelSubCalls/computeMs/maxWallMs/maxOutputBytes/maxOldGenerationSizeMb
#   },
#   "provider": { ..., "contextWindow": 200000 } // 可选：上下文窗口兜底（缺省自动查 models.dev）
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

TUI 命令面板：输入 `/` 弹出带边框的下拉面板（命令 + 说明对齐、选中行整行反色、↑↓ 选择、Tab 补全、Enter 执行、Esc 关闭），支持 `/help /init /model /mode /approvals /plugins /skill /session /new /compact /clear /exit`；`/session` 同时打开会话切换器（最近会话按活跃排序、首条提问作标题，↑↓ 选择、Enter 恢复上下文并切换，Esc 取消）；切换会回到该会话创建时的工作区——工具根目录、项目技能、AGENTS.md 一并切过去（原目录已删除时保留现工作区并提示）；PageUp/PageDown 或鼠标滚轮滚动历史（上滚时状态栏提示，↓/滚轮回到底部）；Ctrl+C 中断当前轮（空闲时按两次退出）。composer 支持多行：粘贴保留换行并软换行显示（最多 8 行窗口，上下溢出有提示），多行输入下 ↑↓ 在行间移动光标。**输入为空且会话未开始时 Tab = 执行模式切换**（普通/PTC/混合循环，命令面板打开时 Tab 仍是补全；切换不往历史区打反馈行，三模式区别见 `/mode`）；状态区单行三段式 `上下文仪表 │ 模型 · 执行模式芯片（当前项反色，新会话并列三枚示意 Tab 循环）· 审批 │ 右缘 tps 速度表 · cache 率`：`│` 分大组、`·` 分组内；空间不足按优先级整字段降级（去标签/去前缀 → 单字审批 → 弃模型名），绝不词中截断（流式 spinner 在 composer 前缀，稳定字段不抖动）。长命令运行时工具行实时显示已耗时与输出尾行。需要审批、长任务完成/出错时弹系统通知（Windows toast / macOS osascript / Linux notify-send，`notify: false` 关闭）。

每轮结束的状态行显示 token 用量与缓存命中率（取自网关返回的 `prompt_tokens_details.cached_tokens`，兼容 DeepSeek 的 `prompt_cache_hit_tokens`）。

## 开发

```bash
pnpm verify   # build + typecheck + test
pnpm test     # vitest（ai 层注入 fetch + SSE fixture，不发真实请求）
pnpm lint     # oxlint
pnpm dev      # tsx 直跑 cli（免构建）
```

## 里程碑

已交付（M1）：agent 循环（async generator 事件流）、append-only 消息模型、工具调用闭环、工具结果超限落盘、JSONL 会话持久化/回放、缓存命中率统计。

已交付（M2）：插件容器（`PluginHost`：工具/命令/钩子注册 + 钩子组合）、权限服务（三档审批 + always 记忆）、内置工具插件 `read_file`/`list_dir`/`write_file`/`edit_file`（realpath 规范化的工作区边界 + 原子写 + 陈旧检测）与 `bash`（跨平台 shell 探测：Windows 优先 Git Bash，回落 PowerShell 并强制 UTF-8 输出编码）、core 三钩子点、`/plugins` 命令与 `--approval` 参数。

已交付（M3）：Skills（`.nova/skills/` 双层发现 + `skill` 工具 + `/skill` 命令 + 渐进加载）、系统提示静态化与会话首条 user 上下文片段（环境/用户指令/技能索引）、中断语义完善（`turn_aborted` 标记 + 排队工具标记未执行）、REPL/TUI 命令补齐。

已交付（M4）：自动 compact（`autoCompactTokenLimit` 阈值触发，压缩后按 codex 式三段重建：上下文片段 + 最近用户消息按字符预算保留 + 摘要）、`/compact` 与手动压缩共用同一实现、缓存指标深化（状态行/状态栏/`/session` 均显示上轮命中率）。

已交付（M5）：`nova exec` 非交互模式（`--json` JSONL 事件输出、管道输入、审批请求自动拒绝、会话照常落盘）、AGENTS.md 逐层发现链注入 `<project_docs>` 片段（32KB 共享预算）、CLI 参数解析统一。

已交付（M6）：deepseek-harness 六项改进落地——会话日志 v2（不可变事件流 + 投影压缩 + 孤儿锁检测 + v1 会话自动升级）、token 锚点压缩预判、并行工具执行（`isConcurrencySafe`）+ 工具级协作超时、后台 jobs（bash 后台 + `jobs` 工具，`JobKindMap` 预留 `subagent` 扩展位）、todo 工具（log-only 整表替换）、审批收紧（bash "always" 按命令前缀记忆 / fail-closed / 服务内 `never` 策略 / approval 审计事件）。另含输出截断防御（length 停止时整批工具调用判失败）与缓存浪费审计（噪声底 1024 tok）。

已交付（M6.1，对照成熟 agent 的缺陷修复）：会话日志抗损坏（半行自截断修复 / 中段坏行跳过告警）、文件工具硬化（realpath 防符号链接越界 + 原子写 + `edit_file` 陈旧检测 + 缺 content 报错 + `read_file` 尺寸/二进制守卫）、`search_files` 工作区搜索工具、审批弹窗 diff 预览（`edit_file`/`write_file`）、exec 模式轮内自动压缩（`beforeLLMCall` 钩子）、并行段 `Promise.allSettled` 防 unhandledRejection。`permissionFor` 分类器改为可异步（realpath 分类），工具新增可选 `preview(args)`。

已交付（M6.2）：PTC 模式（Code Mode）——`run_code` 传输工具 + 每 run 全新 worker 线程代码运行时（剥型、空环境、堆/busy-time/墙钟/输出四类预算、恶意端口防御）+ 工具 schema→TypeScript SDK 字典序生成（字节稳定）+ 子调用经 `ctx.dispatch` 走完整审批/钩子管线（`ToolCallError` 可捕获拒绝、提交序 + 有界重叠 + 独占屏障调度）+ `code-dispatch` 审计事件 + `tools.code.mode` 三态呈现投影（native/ptc/both）。`PluginContext` 新增 `tools()` 活视图，`ToolExecuteContext` 新增 `dispatch` 嵌套分发缝。

已交付（M6.3）：TUI 执行模式与上下文可视化——新会话未开始时 Tab 循环 普通/PTC/混合（rebuildHost 统一 host+hooks 重绑，顺带修掉会话切换后 hooks 滞留旧 host 的隐患）；状态栏单行三段式，新增上下文窗口结构进度条（提示词/工具/注入/技能/消息五段按整窗真实比例上色 + 压缩阈值，容量来自 models.dev 元数据；空间不足按优先级整字段降级、绝不词中截断）；models.dev/api.json 模型目录（context/模态/reasoning/tool_call），精简落盘缓存 + 断网降级 + `provider.contextWindow` 兜底；`/model` 面板与 `/session` 展示模型能力。`estimate.ts` 新增 `estimateTextTokens`。

已移除：MCP 客户端（`@nova-agent/mcp` 包与 `/mcp` 命令，M3 引入）——按实际使用场景裁剪，`nova` 不再读取 `.nova/mcp.json`。

后续（见 docs/GOALS.md）：按 provider 的缓存能力探测表、jobs 完成通知改为钩子注入（替代轮询）、subagent 能力（`JobKindMap` 已预留）、长会话压测与 Windows 终端细节打磨。
