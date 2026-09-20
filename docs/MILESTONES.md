# NovaAgent 里程碑编年史

> 从 AGENTS.md §7 拆出的已交付细节档案（2026-09-17 治理换血）：每条里程碑的机制与决策背景。
> AGENTS.md 只保留现状与规矩；新里程碑落地后详录追加于此，AGENTS.md §7 加一行指针。

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
- **M8.5 — CSI 修饰键与词级移动**：`KeyDecoder` 保留 CSI 参数（`[1;5D` 类序列不再退化成裸方向键），composer 获得 Ctrl+←/→ 词级光标移动。

### 治理换血与结构棘轮（M9，进行中）

> 诊断：历轮重构都是事后清账，没有防再生的机械棘轮；文书税（决策笔记体系 + 全量 verify 仪式 + 文案级断言）拖慢迭代却不保护结构。M9 先换治理，再在棘轮之下做行为保持不变重构——每阶段独立提交、`pnpm verify`+`pnpm lint` 全绿、可中途停止。

- **M9.0 — 治理换血（阶段 0 + A）**：
  - **决策笔记体系删除**（A1）：`scripts/agent-notes/`（662 行）与其 CI 整体移除——决策理由归 commit message 与机制条目，不再有第三份笔记义务。
  - **结构棘轮**（A2）：`scripts/dep-direction.mjs` 机检包间 import 方向（§4 白名单事实化）；`scripts/structure-budget.mjs` + `structure-budget.json` 管**逐文件行数硬上限**（超限即失败；`--update` 同步时下调静默、上调逐条打印 RAISED——增长必须显式发生过）；`.oxlintrc.json` 增补 complexity / max-depth / 长函数 / no-nested-functions（以现状校准为 warn，存量警告即重构靶单）。两者合为 `pnpm gates` 挂进 `verify`。
  - **verify 分层**（A3）：`pnpm check`（lint + gates + 变更相关测试，秒级快环）vs `pnpm verify`（build + typecheck + 全量 test + gates，提交前全环）。
  - **编年史拆分**（A4）：AGENTS.md §7 已交付里程碑详录迁入本文件（AGENTS.md 396 → 约 235 行，只留现状与规矩）。
  - **断言松绑**（A5）：视图层文案级 `toBe(整串)` 改契约断言（宽度不变量、结构顺序、关键字段、降级行为）——观感微调不再触发红测试（§6「断言粒度」）。
  - **最小 CI**（A6）：`.github/workflows/verify.yml`（push/PR 跑 verify + lint）——棘轮要有机械执行处。
- **M9.1 — 共享助手收敛（阶段 B）**：core 新增并导出 `errMessage`（消 30 处 `err instanceof Error ? …` 样板；worker 自包含文件按设计保留内联，ai 保留局部助手守住 ai→core 纯类型边界）与 `truncateUtf8Head/Tail`（agent 落盘 / jobs 读取 / AGENTS.md 裁剪三份同构循环归一，整字符边界不劈 UTF-8 序列）；plugins `builtin/args.ts`（`strArg`/`intArg` 归一 fs/search 的字节级重复）；bash 超时/输出上限/settle 宽限等重复魔数具名化，tui 历史栈接 `HISTORY_LIMIT`。全仓净 +49 行是共享模块与注释开销，消重实收 −59。
- **M9.2 — 四 runner 重复消除（阶段 C）**：用户消息提交、`llm_retry`/`empty_completion` 文案、done→状态行收尾、回合失败「修日志→归类」骨架（`repairTurnLog`/`classifyTurnFailure`）、审批效果预览（`approvalEffectPreview`）、审批 toast 正文（`approvalNotifyBody`）、hooks 重绑（`attachHooks`）、`newSessionDir`/模型列表缓存，全部单源进 `runner-loop.ts` / `runner-shared.ts` / `session-runtime.ts`。
  - **声明的行为例外（漂移修复）**：repl 审批预览宽度统一走 `toolArgSummary`（此前自己一套 slice）；exec/qqbot 调色板装配统一走 `resolvePalette`（开始尊重 `ui.theme`/`NO_COLOR`——此前恒暗色）。
  - **真实缺陷修复（消重时发现）**：TUI 首装与 exec 两条路径 `hooksRef.current` 从未赋值——嵌套 subagent 的 `runOnce` 因此绕开父审批门（exec 的 `never` 策略形同虚设）。`attachHooks` 单源后两条网都在。
- **M9.3 — 斜杠命令核下沉（阶段 D）**：repl/TUI 两份 13-case switch 的公式与文案进 `command-core.ts`（help/model/theme/审批切换/new/init/agents 写入/未知命令等行数组纯函数），`nextApprovalMode` 返回 `ApprovalMode` 消灭两处 cast；command-core 直测。
- **M9.4 — tui-mode.ts 出壳（阶段 E，1546 → 1092 行，−29%）**：延续 M7.12 投影器模式，每抽一块配假时钟 + 真实 `TuiStore` + `plainPalette` 直测，行数预算随收缩同步拧低。
  - **E-1 命令呈现**：`tui/commands.ts`（`TuiCommands` 类，斜杠命令的落块/重绘/退场序列，动作经访问器注入）。
  - **E-2 开屏模式选择**：`tui/mode-select.ts`（`ModeSelector` 类，show/move/confirm/dismiss/collapse 收拢 5 个散落闭包，原位塌缩契约不变更）。
  - **E-3 会话切换**：`tui/session-switch.ts`（`switchSessionTo` 纯依赖注入：回放、工作区护栏、rebind、重渲染全部入参化）+ `tui/gutters.ts`（USER/ASSISTANT gutter 与裸 ANSI 开态常量出壳）。
  - **E-4 弹窗选择链**：`frame.ts` 新增 `resolveActiveView()`（审批 > 模型面板 > 会话面板 > 命令面板的优先级纯函数）。
  - **E-5 压缩等待态**：`tui/compact-wait.ts`（`CompactWait` 类，begin/end/cancel/计时/完成行；计时器经 `every(fn)` 注入，类不碰 setInterval）。
  - **E-6 整帧装配**：`tui/frame-assembler.ts`（`FrameAssembler` 类，flatten 缓存 + `lastFlatLen` 滚动锚定 + 上下文仪表缓存 + 呼吸行文本 + 写屏）。
  - **E-7 事件呈现归约**：`onAgentEvent` 12-case 的呈现分支并入投影器 `onEvent(event, ctx)`；壳层只剩 stats 合并、簿记委派与三处专属副作用（子代理行 sync / usage 排渲染 / done 停表）。
  - **配套测试**：`mode-select`(7) / `session-switch`(6) / `active-view`(5) / `compact-wait`(6) / `frame-assembler`(4) / `turn-projector` onEvent 组(+5) / `commands` command-core 组(+4)——54→59 文件、578→615 用例。
  - **未达与止损**：目标 ≤600 行未达成——剩余约 470 行是启动装配（rt 绑定/审批/autoCompact/agentRun 接线）、`agentTurn` 编排、输入处理与生命周期/stdin，属"一次性大改写"而非逐块抽离，风险收益比不划算，留待阶段 F 之后评估。棘轮已把壳层上限钉死 1092：**后续只降不升**。
- **M9.5 — repl.ts 出壳 + tui-view 门面删除（阶段 F，709 → 650 行）**：
  - **门面删除（F-1）**：M7.0 tui-view 拆包期的 5 个纯转发文件（`ui.ts`/`statusbar.ts`/`composer.ts`/`popup.ts`/`reasoning.ts`）整体删除——8 处 src 导入 + 3 处测试导入全部改直连 `@nova-agent/tui-view`，消除"第二套导入面"。AGENTS §4/§6 措辞同步指向 tui-view 实名模块。
  - **ReplProgress（F-2，`repl-progress.ts`）**：四族瞬态行归单主——spinner 生命周期、推理流尾行（`⋯`）、bash 实时输出尾行（`└`）、嵌套子代理暗行（`⧉`，门闩仍按父调用 id 绑定、只有前台 subagent 期间显形）。契约：`\r\x1b[2K` 可擦的单物理行、写前 `fitTail` 裁进列预算、NO_COLOR/非 TTY 整体静默。spinner/write/writeln/cols 全注入，假 writer 直测 9 条。
    - **声明的行为例外**：输出尾行缓冲从 repl 手滚的 `slice(-2000)` 并入 TUI 同源的 `TOOL_TAIL_KEEP_CHARS`（8000）——显示仍被 `fitTail` 裁到单行，观感不变，但消灭了"两套实现"。
  - **报告行下沉（F-3）**：`/session` 报告体、`/model` 清单行、`/plugins` 清单行进 `command-core.ts` 纯函数（+3 直测）。**刻意不并 TUI 面**——TUI 对应的是 bold 头 + 暗色 + 面板/图例的另一观感，并面会改行为。
  - **未达与止损**：目标 ≤400 行未达成——repl 剩余主体与壳层同性质（启动装配 / SIGINT 分层 / 审批 `askApproval` / `applyWorkspace` / `autoCompact` 接线的闭包），属一次性大改写；棘轮把上限从 711 拧到 650，只降不升。测试 59→60 文件、615→627 用例。
- **M9.6 — core/agent.ts 拆分（阶段 G，973 → 20 行桶文件）**：实现进 `src/agent/` 六模块——`options.ts`（`AgentOptions`/`ToolDispatcher` 与循环族常量）、`notices.ts`（`NoticeState`/`requeueUnaccounted`/stale-todo 常量）、`request.ts`（`assembleRequest`：hook 链→请求级修剪→ephemeral 尾）、`stream.ts`（`streamCompletion`：流式累加/reset 回卷/空补全重试/`finishAborted`）、`tools.ts`（`runToolCalls` 分段并行 + preflight 门 + PTC dispatcher + 超时宽限 + 溢出落盘）、`loop.ts`（`runAgent` 主体 + 弃用清理）；`agent.ts` 收为**公共面桶文件**，导出面逐符号不变（内部私有的一律保持私有）。计划写的是五模块，实拆多列 `options.ts` 一层——斩断 loop↔tools/stream 的 `AgentOptions` 反向依赖（函数环引用 ESM 可行，常量 TDZ 面不值得赌）。逐字转写零行为改动，40+ 条既有行为测试（事件序列/别名契约/回队矩阵）守护；core 总行 +94 为模块 docstring 与 import 布线（同 M9.1 模式）。
- **M9.7 — plugins 工具工厂 execute 体提取（阶段 H）**：fs/bash/search/run-code 四类工具的内联 `execute` 闭包提为顶层具名函数，工厂体只留 schema + 接线（`executeReadFile`/`executeListDir`/`executeWriteFile`/`executeEditFile`/`executeBash`/`executeSearch` + run-code 的 `createDispatchQueue` 工厂）。barrel 命名导出面不变，`search-worker.ts` 与 PTC `worker.ts` 入口**不动**（tsdown keyed entry 双世界解析红线）；search-worker 刻意自包含的重复字符串改经 `workerData.truncatedNoteTemplate` 注入（worker dist 不再内嵌重复字面量）。行为逐字不变，117 条 plugins 测试 + 627 全量绿。run-code 的 196 行最大函数按四段切片：validation+abort → dispatch-queue factory → bindings+audit → run+settle。
- **M9.8 — 类型收口与杂项（阶段 I）**：
  - **I-1 qqbot `current!`/`hooksRef!` 收口**：`qqbot-mode.ts` 的非空断言簇换成 `currentRef` 容器 + `requireActive(name)` 显式窄化（`runner-shared.ts` 新增导出 helper，未绑定即带名抛错）。`runPeerTurn` 经 `currentRef.value = bound` 一处赋值——绑定的不对称被结构化。
  - **I-2 shell 解析归一**：plugins 新增导出 `resolveShellName(shellPath)`，bash 工具的 `invocation()` 与 cli 的 `declaredShell` 共用同一真相源（此前两份独立的 bash/powershell 判定逻辑）。
  - **I-3 Palette 开态原语**：tui-view 的 `Palette` 接口补 `reset`/`clearLine`/`clearRight`（控制码与文本色分工）；`plainPalette` 对控制码返回空串保证 NO_COLOR/非 TTY 恒静默（此前只对文本色静默，控制码仍漏出 raw ANSI）；`theme.ts` `createLightPalette` 同步加 `base` 控制码。tui-mode/repl/spinner/repl-progress 的手滚 `\x1b[0m`/`\r\x1b[2K`/`\x1b[0K` 全改走 `paint().reset()`/`clearLine()`/`clearRight()`。repl-progress 测试改用 `fakePalette` 注入可读占位符（`<RST>`/`<CL>`/`<CR>`），消除 `no-control-regex` lint 噪声。
- **M9.9 — 测试 fixture 去重（阶段 J）**：`scriptedProvider`（core 4 拷贝 + cli 1 拷贝共 5 处逐字重复）与 `withFakeHome`（cli 2 拷贝各 40 行同构）搬到各包 `test/helpers/` 共享模块。**只搬不改断言**（Plan §J 红线）：`scriptedProvider`/`collect` 行为逐字保留、`withFakeHome` 行为逐字保留。core 与 cli 分包存放 helper——跨包 test-helper import 会违反 `dep-direction` 棘轮，cli 侧保留独立副本。净 -36 行（重复消除）。
- **M9.10 — 热路径微优化（阶段 K，三项独立提交，行为不变）**：
  - **K1 request-trim 双分组复用**：`trimRequestMessages` 原先 snip + micro 各跑一次 `groupMessages`，冷路径上 snip flat 后 micro 又重排——实际 snip 输出本身就是原子分组（marker 是无 tool_calls 的独立 assistant 组）。抽出共享 `applyMicro(groups, keep, fallback)` helper：`microMessages` 保持公开 API 行为不变（同引用 fallback 短路、整数校验、placeholder 替换逐字一致），`trimRequestMessages` 改为单次 `groupMessages` → 若超 50 组就地合成 head+[marker]+tail 分组数组、否则沿用原 groups → 直喂 `applyMicro`。身份保持：snip 不触发且 micro 不触发时返回 `messages` 同引用（下游缓存依赖）。
  - **K2 estimate CJK 判定 regex→码点区间**：`estimateTextTokens` 每请求对每条消息的每个字符调 `CJK_RANGE.test(ch)`——长 transcript 上是每请求上万次 regex match。改成显式码点区间数组 + 整数比较循环：等价语义（所有区间都在 BMP，`codePointAt(0)` 对 BMP 字符即字符码点；astral 在两侧都落入 other），消除每字符 regex 引擎开销。CJK 区间注释里逐条标注来源。
  - **K3 工具序列化按数组身份缓存**：两处配合缓存——① `PluginHost.tools` getter 原先每次 fresh `map` 返回新数组（下游即使按身份缓存也永远 miss），改成 `toolsCache` 缓存、`registerTool` 时失效；② `OpenAICompatClient` 新增 `toolWireCache: WeakMap<ToolDefinition[], wire[]>`，同引用输入直接返回缓存 wire 数组（已字典序排序 + toProviderTool 映射），不同工具集落地为新引用自然 miss。client.test.ts 新增 1 条专测：同引用跨两轮输出等价 + 不同引用同内容仍正确序列化。启动后稳定工具集下每请求免一次 sort+map。


### M10 — Grok Build TUI 设计移植（实现本体已随 M11 批1 删除）

> 对旧 TUI 反复打磨出的**观感结论**（度量、节奏、Grok 源证据、真机探针判定）。实现本体（`tui-view` 全包 + `cli/tui` 壳 + 旧 `tui-mode.ts`，≈7,500 行）已在 M11 批1 删除；这些逐值成果是批4 `tui-app` 重写的移植清单，其落地形态见 AGENTS.md §5 的 TUI 节。以下为删除前 AGENTS.md §5 的记录原样归档（2026-09-19 迁出）：

> ⚠️ **以下段落描述的是批1 删除的旧实现**（`tui-view` / `cli/tui` / 旧 `tui-mode.ts`），作为**设计参照**保留（度量、节奏、Grok 源证据仍有效），批5 全面重写。
alternate screen + 行级 diff 重绘（React-free）；`/` 命令面板（↑↓ 选择、Tab 补全、输入历史）；审批弹窗（y/n/a + 1-9、always 行 ←/→ 调授权词数、拒绝行打字补理由）；模型/会话切换面板 1-9 数字快选；PageUp/PageDown/滚轮滚动（上滚不改状态栏样式——常驻视图保持稳定，↓/滚轮回到底）；仪表悬停（?1003 any-motion：悬停上下文仪表换形，T2 档让格给「已用/总量」数字、总宽不变，拖拽仍被吞）；Ctrl+C 中断当前轮（空闲时两段退出）；多行 composer（粘贴保留换行、软换行最多 8 行窗口、↑↓ 行间移动；**长粘贴折成 `⧉ 粘贴 N行 X字` chip**——纯显示折叠，缓冲区存全文、提交一字不差，←/→ 整越、边界退格先展开防一键吞粘贴）；**运行中消息队列**（轮进行中回车入队不拒绝——队列暗色 lane 常驻 composer 上方，本轮结束后自动下发队首，Esc 中断后接续发送）；流式 markdown（列表缩进 2 列挂圆点，换行续行对齐条目文本列）、工具输出**三态折叠**（Collapsed 头行 → Truncated 12 行预览 → Expanded 400 行封顶，点击轮转、▸/▾ affordance）、reasoning 定高活窗口（定格 2 行 + 活尾 1 行、每行裁到单一显示行绝不折行、空行不进窗——每个 delta 只重写活尾一行，整段不重排；**答案起笔定格成 `▸ 已思考 N.Ns`**（<10s 一位小数）、与答案同组紧排，轮内不留空行，**点击可展开思考全文**——▸/▾ 前缀为 affordance，全文仅存会话内存（reasoning 从不落盘，resume 后不可展开），展开正文逐行暗色、软折行走 gutter 预算）；长命令实时显示已耗时与输出尾行；**跑动时输入卡上方一条活体行**（`turn-status.ts`，Grok `turn_status.rs`：转轮 + 阶段词 + 本轮累计耗时，`<10s` 一位小数 / `<60s` 整秒 / 更久 `m+s`，空闲整块消失——它占转录两行，窗口随之收缩，与 Grok 同）；系统通知（Windows toast / macOS osascript / Linux notify-send）。分层：`tui`（终端原语）→ `tui-view`（纯视图，零 IO）→ `cli/tui/`（`store.ts` TuiStore / `keys.ts` 按键责任链 / `frame.ts` 帧装配 / `turn-projector.ts` 轮次投影状态机——流式平滑、assistant/思考块生命周期、工具行形变、行动画、中断清场，假时钟 + `plainPalette` 可单测 / `subagent-lives.ts` 子代理接管活行与后台行状态机）→ `tui-mode.ts`（壳层：生命周期 + IO + `agentTurn` 事件归约的委派，块级投影一律走 TurnProjector；TUI 可变状态全部收敛在 TuiStore 实例里，壳层与按键链读写同一实例）；决策背景见 `docs/tui-design.md`。

**单行状态栏**三段式 `上下文仪表 │ 模型 · 执行模式 · 审批档位 │（右缘）tps · cache`——`│` 分大组、`·` 分组内，层级靠分隔符而非字数堆砌：
- **上下文仪表**：按整窗真实比例分段上色（提示词青 / 工具 schema 绿 / 注入片段蓝 / 技能索引品红 / 消息黄），加粗「已用/总量 · 百分比」；**用量断点混色**（`usageUrgency`：中性 <50% → 青 <70% → 黄 <90% → 红 ≥90%，ANSI-16 混不了渐变、断点快照即 Grok 自己的 t<0.5 取整规则）；`压缩 %` 只在真正逼近阈值时出现（T0 常驻、T1 ≥50%、T2 ≥70%）；**一格都画不出时整条 bar 按整字段降级丢掉**（批12：百万窗口开局 13k 用量只能画 0 格，八格 `░` 底纹说的是"什么还不知道"，读起来是噪声——丢掉后 `已用/总量 · 百分比` 自己说话，用量涨到一格条形就回来；悬停换形同理，让格会让掉最后一格的悬停不换）。
- **空间不足按优先级整字段降级，绝不词中截断**：同一档位内**先丢瞬时提示**（中断/退出——它们只是锦上添花，不该把「已用/总量」挤出状态栏），再降档：T0 全量 → T1 去 `模式/审批` 标签、模型去供应商前缀 → T2 仪表只留条+百分比、审批降单字（读/编/全）、模型截断 → 极窄时弃模型名（banner 与 `/model` 已可见）。上滚**不进**状态栏：滚动位置从画面本身可见，状态栏样式恒定。右缘仪表组定宽不随 tick 变宽、百分比与数值 `padStart` 位数跳动不挪分隔符、截左不截右。
- **tps 速度表**：500ms×10 环形窗口，**会话级连续滚动**（发新消息不清空、无新输出不排空到 0），恒绿色（"是否在生成"由 composer 前缀 spinner 表达）。
- **cache 命中率**：取**会话累计**值且**粘住可见性**——provider 随机分流到不报缓存的后端会让单轮值抖动、整段闪现，故一旦本会话见过缓存上报就常驻，从未上报则整段隐藏。
- **模型元数据（models.dev）**：启动后台拉 `https://models.dev/api.json`，解析为精简目录落盘缓存（`~/.nova/cache/models-dev.json`，24h TTL，断网用旧缓存），按模型 id 精确→尾段匹配解析上下文窗口/模态/推理/工具/附件能力，喂给结构进度条分母；明细在 `/model` 面板与 `/session`。
- **执行模式**：新会话未开始时按 Tab 循环 普通 → PTC → 混合（rebuildHost 统一重绑 host+hooks；Node 不满足 22.19 时拒绝并保持原模式；区别见 `/mode`，切换不留历史行、状态栏模式标即时变化）。

**设计语言（Grok 度量逐值移植，M10 批6）**：观感差距先在设计语言有没有一层——**其次才是配色**（批13 把 dark 主题的 truecolor 档整体换绑 GrokNight RGB：accent 青 `#1abc9c`、次要文本 `#6c6c6c`、边框 `#505058`、成功 `#9ece6a`、警告 `#e0af68`、失败 `#f7768e`；`detectCaps` 同时补 truecolor 品牌表与"Windows 无条件为真"，只报 16 色的终端仍逐字节沿用原 ANSI）——Nova 原先每个组件自己算宽度、自己 pad、自己写降级 tier，一处算错整块错位。`tui-view/layout.ts` 把 Grok 实际在用的常量收进来成原语：**屏幕分区**（`bottomStack` = 转录 → 呼吸行 → 弹窗 → 队列 → 输入卡片 → 状态栏 → 快捷键条，转录区是**唯一**收缩者，其余全是定长行，Grok agent.rs:228-299；**收缩者内部的空白落点**由 `anchorHistory` 决定——贴底时空白整段上浮到内容上方（最新一行永远贴着输入卡片，空白落在屏幕顶缘读作"上面还有历史"），**唯一的例外是开屏**（批12：转录里只有那张 welcome 卡片时空白对半分、卡片落在视口中部，整屏读作"一个欢迎页"；批11 曾把它统一进贴底，真机截图证明冷启动那半屏空更像 bug），上滚后不挪）；**转录列基线** `MARK_COL=2 / CONTENT_COL=4`（`MARK_LEAD` + 标记后 1 格气口）：标记列就是卡片用的那 2 格内衬，于是 `❯`（用户）、`•`（答案）、`⠙/✓/✗`（工具）、`▌`（导轨）、`◈`（子代理）全部落在同一列、正文全部从第 4 列起（原先用户/答案在第 4 列、工具在第 6 列，一轮读起来是两条错位的轨）；**条目之间恒留呼吸**（`frame.ts:isDenseRun`，批14 照 Grok 的 `scrollback/state/layout.rs:1555-1563` 逐值改）——转录里每个块对之间 1 空行，**只有连续折叠的工具行**算 dense run 彼此不留（一轮几十个工具调用不会把屏幕撑成空行串），用户提问再自带一行 vpad（净 2 行）。批7 曾把"紧排"套到整轮（提问→思考→答案→工具挤成一块实心砖），那是把 Grok 的 dense-run 例外抄成了通则；**圆角卡片** `cardTop/cardRow/cardBottom`（`╭─╮│╰─╯`，顶框右缘可嵌 caption、底框右缘可嵌 info，`╮╯` 前留 2 格，info 空则整段省略）；**整屏一套边框语言**——开屏卡、输入卡、`/model` `/session` 面板、审批卡的框线一律走新增的 `Palette.border` 槽（dark 的 truecolor 档用 GrokNight 的 `prompt_border_active #505058`、16 色档仍是 bright-black、light 用中灰、plain 恒等），不再裸写制表符：裸框线落在终端默认强度上，跟有色内容并排就显"廉价"，而边框色是**结构色不是主题色**，故与 `dim` 分槽。**四张卡共用同一对边距**（批10：`popupInner()` 把弹窗宽绑到 `composerCardWidth`，边框行与内容行同一 `POPUP_LEAD`——弹窗从第 0 列铺、输入卡内缩 2 格，屏幕上就有两条左缘，两张卡并排像两个应用的窗口叠在一起）；**底部 chrome 内缩同一对边距**（批11：状态栏与快捷键条也从第 `CHROME_PAD_COLS` 列起、定宽 `cols-1-CHROME_PAD_COLS`，与卡片左缘对齐——"一条左缘"管的是整屏不是四张卡；`statusZone.gaugeEnd` 加同样偏移，仪表悬停的命中点跟着挪不偏）；审批卡也是这套语言里的一个卡片（标题栏承载 `! 需要审批 [执行]`、光标行**整行反色铺满内宽**——那条色带才是"这是个控件"的信号）；输入行的 `❯` 同理改由 `composerLead(p)` 经调色板绘制（原先硬编码 cyan+bold 转义码——light 主题下是不知所措的亮青、plain 流里仍吐 ANSI，`COMPOSER_PREFIX` 导出随之移除、`COMPOSER_PREFIX_WIDTH` 成字面量）；**动效只有一个时钟**（`TICK_MS=33`，Grok 30fps）：`TuiStore.tick` 是唯一计数器，壳层一个定时器递增它，**转轮帧是派生量**（`spinnerFrame = tick / 4` ≈ 132ms/帧，与 Grok 同拍；原先它自带一个 90ms 计数器）、导轨行波取 `railPhase(tick, row)`、打字机揭示定时器也改成同周期（30→33ms，两个近频时钟会打出可见的抖拍）；
**两种分隔符宽度不通用**：状态簇 `" │ "`(3)、快捷键簇 `"  │  "`(5)。**输入区从"一行 `❯`"升级为卡片**（Grok prompt：左右内衬 2、单行草稿恒 3 行、正文宽连边框一起扣、光标落在卡片第二行故 `cursorPosition` 多一层 `leadRows`）。**快捷键条**（`hint-bar.ts`，屏幕最后一行）是这套语言里最关键的分工：**占位符只说"在这里输入"，键位归键位条**——原先键位散在开屏面板、占位行、弹窗提示里，哪儿都在说、哪儿都不像设计；键位随"谁占用键盘"换一套（命令面板 / 模型会话选择 / 审批 / 开屏选择器 / 运行中 / 静息），超宽按原序从尾部**整条丢弃**（不折行、不加省略号），且 **Tab 只在真能切模式时才印出来**（骗人的键位提示比没有提示更糟）。同一条规则在批10 走完剩下的路：**四张卡的底框边都不再印键位**——审批弹窗原有的 `↑↓ 选择 · Enter 确认 · Esc 拒绝` 提示行与模型/会话/命令面板底边的 `↑↓ 选择 · Enter 切换 · Esc 取消` 一并收掉（窄列时快捷键条整条丢弃、弹窗照印，两处不一致必有一边在骗人），卡片脚边只放**面板自己的内容**（审批卡=一句授权语义，选择卡=留空），审批键位改由 `HintState.approvalScope` / `denyTyping` **随光标所在行**出现（停在「总是允许」且命令确有多词可收窄才印 `←→:调授权词数`，停在「拒绝」才印 `打字:补理由 │ Backspace:删字`）。**字形必须经真机探针选定**（批7b）：在 zh-CN Windows Terminal / Cascadia Mono 里逐字形打标尺行测宽与字形存在性——`⧉`(U+29C9) 该字体根本没有、渲染成十六进制豆腐块，于是粘贴 chip 与子代理标记改用探针确认存在的 `▤`/`◈`（`CHIP_MARK`/`SUBAGENT_MARK` 单源）；同时证实本项目框线/导轨/箭头字形全为单格宽、全角 `！：` 为双格，**宽度表与终端一致**（对齐问题不在宽度表，见 commit）。**键名只印键盘上真有的字面**（批12）：快捷键条里的 `⏎`/`⌫` 未经探针就换回 `Enter`/`Backspace`——return/backspace 符号走终端字体回落，宽度不由我们的表做主，而键位提示渲染成豆腐块就是骗人。**反色 run 里不放非 ASCII 字形**（批11）：SGR 7 会换终端的字体回落，`•` 这类宽度"看上下文"的字形落在反色胶囊里可能比 `styledWidth` 多走一格——离线算宽全对、真机右边框错位，只能靠两张帧差分对比才找得到。故定宽卡片行的光标胶囊内只放 ASCII（`[` `]` 空格），状态一律靠颜色表达。

**开屏 = 一张居中卡片（Grok welcome 二稿）**：`buildWelcome` 单块承载全部开场信息——工作区根 / 会话根（家目录前缀折成 `~/…`，让尾段活过裁剪）/ 技能计数 / 模式选择器 / 沙箱姿态，五行同处一框（与输入卡片同一套圆角细线，框线一律走调色板的 `border` 槽，见上），按终端列数**水平居中**，垂直位置走 `anchorHistory` 的 `center` 档（批12）：转录里只有这张卡时空白对半分，卡片落在视口中部，整屏读作一个欢迎页（`frameMap.topPad` 仍在——点击行号要先减掉合成空白）。**首条消息落地即并回文档流**（`tail`）——"空白落在顶缘读作上面还有历史"那条判语有个前提：**上面真的有历史**；冷启动没有历史，18 行顶缘空白就只是 18 行空（批11 把开屏也压进贴底，正是这条前提空转，`store.welcomeCenter` 那个可变标志也随之回来又被删——现在由"转录里只剩一块"推出，不留第二份真相）。身份三件套（模型 · 审批 · 模式）由常驻状态栏独占、卡片**绝不复读**；键位提示一律不进卡片（归底部快捷键条，见上），占位行只剩 `描述任务…`，且光标独占一格、绝不用反色盖住占位文本的汉字，光标格与占位文本之间再留一格气口（批12：块紧贴着字，真机读作"光标吃掉了第一个汉字"）。模式选择器是框内单行分段控件 `[ 普通 ] │ [ PTC  ] │ [ 混合 ] 将切到 PTC`：**三格等宽**（`普通`/`混合` 4 列、`PTC` 3 列，补齐到同一格宽才排成网格——长短不齐的括号读起来像手抖，不像控件），反色胶囊=光标、有色标签=已生效、尾注=「将切到 X / 当前模式」，三个通道分开写才不会"选择器指着 A、状态栏写着 B"（已生效原先印 `•`，批11 改上色，原因见上文反色字形规则）；卡片宽按**光标位在架的三种形态与塌缩形态里最宽的那个**量，选择器收起时右边框不横跳（居中时那一跳会整块左右挪）；整块卡片由 `ModeSelector` 拥有，↑↓ 原位重写、塌缩只是换回静态形态（不跳宽、不留交互残骸）。**状态栏模式字段只报当前档**——原先三档并排的 pristine 芯片与卡片选择器重复且一动就互相矛盾（一个控件一件事），`StatusView.pristine` 随之删除。

**工具行单行预算**：工具行（运行/完成/组行）拿终端列数渲染，参数摘要吸收剩余宽度——但预算必须扣掉本行自带的**内容列内衬**（`toolBudget() = cols-1-CONTENT_COL(4)`，wrapBlock 按同一预算折行，行构建器裁进同一预算才不会把 ` · 行数 · 耗时` 尾巴顶成孤儿续行）——` · 行数 · 耗时` 尾巴恒留本行，不再折出孤儿续行。**工具块不再吃挂行缩进**：`TOOL_GUTTER` 现在是恒等 gutter（`{first:'',rest:''}`）——每行自带标记列内衬，再叠一层挂行会把导轨行推到第 8 列（旧版就是这个双缩进，`✓` 在第 4 列、`▌` 在第 8 列）。截断按**显示列数**而非字符数（CJK 计 2 列）：命令在参数边界切（`cd "…" && ls …`），路径切头保文件名（`…\manifest.json`）。连续只读调用（read/list/search）聚合为一行**动词短语组**（`  ✓ 读取 2 个文件, 搜索 1 个模式 ▸ · 0.5s`，Grok verb_group：成员按工具名分桶、任何成员在跑时整组翻「正在」时态、失败以红色 ` · N 失败` 后缀并入同行而非拆行、成员摘要挂点击 detail）。**状态导轨**（Grok accent_bar）：多行生存面（运行中 bash 尾行、三态折叠正文、失败首错行）以 `  ▌ ` 开头（与 `✓`/`✗`/`❯` 同处标记列），**导轨色即状态**——running 亮青/暗按**全局 tick 的 `railPhase` 行波**（Grok `sin²(tick*0.15 + row/32·2π)`，ANSI-16 混不了渐变、只取波形上下半；行偏移让多行面"亮段自上而下流过"，而不是各行按自己的 elapsed 反相乱闪）、完成绿、失败红常驻；单行 ✓/✗ 已有色彩承载、collapsed 行不挂导轨。审批弹窗头部与 diff 预览同样按列裁剪，弹窗不折行。

累计 token 与分段明细在 `/session`，模态能力标在 `/model` 与 `/session`；`/session` 另报缓存浪费审计（missTokens，噪声底 1024 tok）并可作会话切换器（↑↓ 选择或 1-9 快选、Enter 恢复上下文并切回该会话创建时的工作区）。

### M11 — 内核收拢 + 可插拔 Surface + WebUI + TUI 全量重写（进行中）

- **批0 — 呈现意图词汇表**：`core/presentation.ts`（`ToolCallKind` / `ToolCallView` / `ToolResultView`）——core 拥有调用的形状与语义，文案/颜色/列宽归 surface；`presentCall`/`presentResult` 不进 provider 载荷，前缀缓存不受影响。
- **批1 — 内核层**：`core/kernel/`（`AgentSession` 句柄 + `KernelEvent` 协议 + `ApprovalBroker` + `EventPump`）；compact/auto-compact/context/paths/session-index 下沉 core；`createAgentKernel`（plugins）为装配单源；审批/job/子代理/phase/队列/压缩进度全部收编为内核事件，"model-visible means logged" 由内核 `consume()` 保证；旧 TUI 删除，exec/repl/qqbot/nova 全部改内核事件消费者。
- **批2/批3 — Web surface**：`packages/web`（零依赖 RFC6455 WS + launch-token→HMAC cookie 认证 + `WebController` 回放与扇出）+ React 18/Vite/Tailwind 前端（状态归一处纯 reducer，markdown 元素树渲染无 innerHTML）；批3 把词汇表的视图解析钉在宿主侧（`callViewOf`/`resultViewOf` 从活工具表取声明，控制器出站前附 view），六卡工具面 + 会话控制 + 真机冒烟 20/20。
- **批4 — `tui-app` 新 TUI**：`nova` 的默认形态（非 TTY/`--repl` 回落 REPL）。纯函数层（blocks/entries/render/panels/frame）+ 按键责任链 reducer + 壳层（alternate screen、raw 键盘、单时钟、内核订阅）；壳层端到端测试 = 真 `createAgentKernel` + 脚本 provider + 内存终端（自写 ANSI 网格还原）+ 真按键字节。取舍：仪表只有总量、无悬停换形；↑↓ 是带草稿寄存的历史；启动不等 models.dev。真 bug：调色板字符串 `.length` 算宽、动词组行 `▸` 死 affordance。
- **批5a — 命令语义收口**：`cli/command-runner.ts` 一个 runner 两壳共用（对内核做什么/参数解析/报告文案单源，壳只出 note/pickModel/clear/bindSession/exit 端口），修掉 repl 的 `/skill` 死路；`openPanel` 关面板回 `onSelect(-1)`。
