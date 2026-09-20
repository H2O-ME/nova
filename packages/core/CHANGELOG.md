# @nova-agent/core

## 0.4.0

### Minor Changes

- 1e35cdb: Hook verdicts go structural: `ToolCallVerdict` is now a discriminated union (`allow` carries nothing, `deny` carries only `reason`, `rewrite` requires plain-object `args`), validated by the new `validateToolCallVerdict` pure function. The plugin host rejects malformed verdicts fail-closed (deny with an actionable reason) and rejects `beforeLLMCall` hooks that widen the tool set (narrowing, e.g. the PTC projection, still passes). `runAgent` re-validates at its own gate so hand-rolled `AgentHooks` implementations get the same fail-closed net. No built-in plugin changes behavior — none rewrites or widens.
- 1b6376d: **内核收拢 + 可插拔 Surface（M11）**：拆掉"每个 runner 各自记簿记、各自猜阶段"的重复，把内核做成**唯一协议面 + 多家 surface**。
  
  - **`AgentSession` 句柄与 `KernelEvent` 协议**（core 新增公共导出）：surface 只拿到句柄——`prompt` / `abort` / `compact` / `resolveApproval` / `subscribe` / `pendingApprovals` / `usageSnapshot` / `dispose`——不再自己跑 `runAgent` 生成器、不再自己落盘。"model-visible means logged" 由内核 `consume()` 直接保证：凡进了模型可见面的事件必已进日志，surface 无从遗漏。
  - **旁路通道收编为事件**：`phase`（thinking/writing/tool/waiting/compacting）、`approval_request`、`tool_progress`、`subagent_update`、`job_update`、`notice`、`compaction/*` 全部并进 `KernelEvent`——原先 TUI 自推 phase、审批走 host 里一个隐形 await、job 靠轮询、压缩进度只存在于 SessionEvent 的四处旁路，现在是一条流。
  - **审批事件化（fail-closed 不变）**：`PermissionService` 的 ask 注入点保留为底层，内核提供适配器把 ask 转成"发 `approval_request` + 等 `resolveApproval`"；surface 断连或 abort 时挂起审批收敛为 deny。headless 消费者（exec/qqbot）继续走确定性拒绝。
  - **能力下沉**：`compact` / `auto-compact` / 上下文片段 / 工作区路径 / 会话索引从 cli 下沉 core（新公共导出）。`plugins/runtime.ts` 的 `createAgentKernel` 成为**装配单源**——host、审批桥、`PermissionService`、`JobRegistry`、上下文片段一处装配，provider 注入；core 保持 provider 与宿主无关。
  - **cli 变瘦**：argv → 装配哪个 surface + 配置发现 + provider 工厂 + 模型元数据。斜杠命令语义收为 `command-runner.ts` **一个 runner 两壳共用**（对内核做什么、参数怎么解析、报什么文案单源），顺带修掉 `nova --repl` 的 `/skill <name>` 死路（原先进「未知命令」）。exec/repl/qqbot 全部改为内核事件流的消费者——功能与 JSON 事件流 schema 不变。
  - `core` 另导出 `AgentSurface`（纯类型）：官方 surface 与第三方 surface 同地位，只依赖 core/plugins 公共 API，由 cli 按 argv 装配。
- 42c1bfb: 治理换血与消重拆壳（M9.0–M9.K，行为保持不变重构）。
  
  - **公共面新增**：core 导出 `errMessage`（错误转消息字符串单源）与 `truncateUtf8Head` / `truncateUtf8Tail`（UTF-8 整字符边界字节裁剪，收编 agent 落盘 / jobs 读取 / AGENTS.md 裁剪三份同构循环）；plugins 导出 `resolveShellName`（bash/powershell 解析单源，收编 cli `declaredShell` 与 bash `invocation` 两份真相）；呈现层的 `Palette` 接口补 `reset` / `clearLine` / `clearRight` 开态原语（收编手滚 raw ANSI；无色调色板对控制码返回空串，保证 NO_COLOR 恒静默）。
  - **结构棘轮**：`pnpm gates`（依赖方向机检 + 逐文件行数硬上限，只降不升）、`pnpm check` 快环 / `pnpm verify` 全环分层、oxlint complexity/max-depth/长函数规则上线；决策笔记体系删除。
  - **消重**：四 runner 的用户消息提交/重试与空补全文案/回合失败归类/审批预览与 toast/hooks 重绑单源；repl 与 TUI 的 13 个斜杠命令下沉 command-core（M11 批5 进一步收为 `command-runner.ts` 一个 runner 两壳共用）；`repl.ts` 的瞬态进度行出壳 `ReplProgress`、`/session` `/model` `/plugins` 报告行下沉；core 的 989 行 `agent.ts` 拆为 `agent/{notices,request,stream,tools,loop,options}.ts` + 桶文件（40+ 条行为测试不动）；plugins 的 fs/bash/search/run-code 内联 execute 体提为顶层具名函数，工厂只留 schema+接线；各包 `test/helpers/` 收敛 `scriptedProvider`（5 拷贝）与 `withFakeHome`（2 拷贝）。
  - **声明的行为例外（漂移修复）**：repl 审批预览宽度统一走 `toolArgSummary`；exec/qqbot 调色板装配走 `resolvePalette`，开始尊重 `ui.theme` 与 `NO_COLOR`（此前恒暗色）；repl bash 输出尾行缓冲并入 TUI 同源的 `TOOL_TAIL_KEEP_CHARS`（显示行仍裁到单行，观感不变）。
  - **缺陷修复**：TUI 首装与 exec 路径的 `hooksRef` 从未赋值——嵌套 subagent 因此绕开父审批门（exec 的 never 策略形同虚设）；重绑单源后审批门对嵌套调用恢复生效。
  - **热路径微优化（行为不变）**：`request-trim` 的 snip+micro 共享一次 `groupMessages`（snip 未改动时同引用短路）；`estimateTextTokens` 的 CJK 判定由正则改为码点区间比较（消除每字符 regex.test）；`OpenAICompatClient` 的工具序列化按数组身份 `WeakMap` 缓存，`PluginHost.tools` 返回稳定引用跨轮失效仅在 registerTool——启动后稳定工具集下每请求免一次 sort+map。
- 37ea5d6: core 新增「呈现意图词汇表」（`packages/core/src/presentation.ts`）：`ToolCallKind` / `FileLocation` / `FileDiff` 与 `card` 判别的 `ToolCallView` / `ToolResultView`，只描述一次工具调用**是什么**（无文案、无颜色、无列宽），让 TUI / WebUI / headless 从同一份结构渲染而不再按工具名 special-case。`ToolDefinition` 增加两个**可选**纯函数 `presentCall?(args)` / `presentResult?(args, content)`（§10 面 4）——不声明的工具照旧以 generic 卡渲染；两者都不进 provider 线上载荷，前缀缓存不受影响。内置工具已声明自己：bash → terminal（含 exitCode / droppedBytes）、write_file / edit_file → diff（FileDiff，presentCall 不读盘）、search_files → search（FileLocation + truncated）、read_file / list_dir → read、todo_write → plan。
  
  同时把两项**领域语义**从渲染包迁入 core：失败判定 `isFailureContent`，以及"哪些工具是只读的 / 参数是路径"的分类（`toolCallKind` + `isReadOnlyKind` / `isPathArgKind`）——旧渲染包的两张硬编码工具名表由此派生（该包已随 M11 批1 删除；`tui-app` 与 Web 前端一律走词汇表，不持有名字表）。
  
  **视图解析归宿主**：core 另导出 `callViewOf(tools, call)` / `resultViewOf(tools, call, content)`（从活工具表取声明）与 `ToolViewSource` 缝——事件出站方在帧上附视图，界面 `switch (view.card)` 消费，浏览器侧零按名特判、零失败启发式。

### Patch Changes

- 1e35cdb: Request-level middle compression: new pure `request-trim.ts` (`groupMessages` / `snipMessages` / `microMessages` / `trimRequestMessages`) runs between the `beforeLLMCall` chain and the ephemeral notice tails in `assembleRequest` — snip drops whole middle tool groups past 50 (head 3 + marker + tail), micro ages older tool result bodies into re-runnable placeholders keeping the newest 3 groups verbatim. Units are atomic tool groups (never message indices), inputs are never mutated, and the trimmed snapshot lives on a fresh array so the in-place auto-compact alias contract, the canonical log, and the compaction projection stay intact.
- 1e35cdb: Stale-plan nudge: the loop now counts assistant tool turns without a persisted `todo/write` snapshot and, after three, injects one ephemeral reminder into the next request (same request-scoped channel as job notices — never logged, never in the compaction projection, re-armed when the carrying request dies). Detection keys on the durable session event, not the tool name; pure-Q&A turns never count.

## 0.3.0

No changes in this release.

## 0.2.1

### Patch Changes

- f364394: 后台子代理可见性 + 内置工具对 shell 的信息量反超：`JobRegistry` 快照新增 `startedAt`/`progress`（peek，不占模型输出游标），后台 subagent 的嵌套活动（N tools · 最近调用）喂入 TUI——每个运行中的后台委派钉一行 `⧉ 子代理 label · Ns · …`（自带刷新 interval，活过父轮仍更新），结束原位改写为状态+用量行。`list_dir` 输出携带文件字节数（不再输给 `ls -la`）；bash 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`（Windows 下 python heredoc 免手写编码样板）；系统提示的 `run_code` 引用改为模式中性表述。
- f364394: 空补全重试，根除主循环静默停摆：content 为空、无工具调用、带 finish_reason 的补全（推理型 provider 把全部输出流进 reasoning_content 的病理）旧版会推进一条空 assistant 消息并以 complete 静默收场——用户看到思考停止后 agent 无声终止、无任何报错。现在 runAgent 视其为 provider 病理，自动重试同一请求 2 次（请求每轮构建一次、前缀稳定缓存友好；耗尽抛错并回队 job 通知），新增 `empty_completion` 事件（--json 事件流 additive），TUI/REPL 落「⟳ 空回复…自动重试 a/N」提示行。
- f364394: 子代理报告只认最终 assistant 消息：修复"报告只剩开场白"——旧采集取运行中最后一条非空文本，推理型 provider 在收尾轮把输出全部放进 reasoning_content、content 为空时，中途旁白会被当成已完成报告回流父会话并标记 completed；现在空最终消息如实返回 "ended without a report"（附可行动原因：reasoning_content 提示/轮数上限/中止），job 状态落 failed 触发父代理重派。

## 0.2.0

### Patch Changes

- d69b9ba: Unified TokenGate (auto-compact.ts shared by all runners): preflight uses anchor-or-full-estimate so resume of a large session can no longer blow the context window on its first request; compactConversation/compactSession accept an optional AbortSignal forwarded to the summarizer. always-approval scope narrows compound commands to the whole normalized chain. TUI error path discards uncommitted partial assistant blocks (screen/log divergence fix); REPL gets an equivalent dim hint. agentTurn gets a catch guard so errors outside the event loop surface as blocks, not unhandled rejections.
- c9a8f61: P3 polish: jobs.ts comment drift fixed (completion injection channel exists since M6.4); dead code removed (extractReasoningHeader, reasoningRows, questionLines, isBlankAnswer + their tests); {env:NAME} throws naming the missing variable instead of silently expanding to empty; --version/-v/--help/-h only match as leading flags; interactive mode warns on stray positionals; runCompact no longer zeros cumulative session stats; PTC both-mode SDK slims bindings to name + one-line summary (native schemas carry full types); search_files in-process walk checks abort signal; spacing.ts contract comment aligned with frame.ts tight-pair implementation.
- 21dfe53: Structural refactor: extracted createSessionRuntime (packages/cli/src/session-runtime.ts) merging the ~60-line duplicated session/client/host/skills/fragment startup across all three runners (exec/repl/tui); runtime exposes reloadWorkspaceContext for workspace switches so fragment closures stay consistent. TuiStore convergence: removed all three `as any`/`as unknown as TuiStore` casts from tui-mode.ts by fixing structural compatibility (sessionPicker/approval types already matched; appendTail implemented inline; blocksVersion wired as getter; onChange made public on TuiStore). store.ts onChange promoted from private constructor param to public field for structural assignability.
