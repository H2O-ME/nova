# @nova-agent/cli

## 0.4.0

### Minor Changes

- 1b6376d: **内核收拢 + 可插拔 Surface（M11）**：拆掉"每个 runner 各自记簿记、各自猜阶段"的重复，把内核做成**唯一协议面 + 多家 surface**。
  
  - **`AgentSession` 句柄与 `KernelEvent` 协议**（core 新增公共导出）：surface 只拿到句柄——`prompt` / `abort` / `compact` / `resolveApproval` / `subscribe` / `pendingApprovals` / `usageSnapshot` / `dispose`——不再自己跑 `runAgent` 生成器、不再自己落盘。"model-visible means logged" 由内核 `consume()` 直接保证：凡进了模型可见面的事件必已进日志，surface 无从遗漏。
  - **旁路通道收编为事件**：`phase`（thinking/writing/tool/waiting/compacting）、`approval_request`、`tool_progress`、`subagent_update`、`job_update`、`notice`、`compaction/*` 全部并进 `KernelEvent`——原先 TUI 自推 phase、审批走 host 里一个隐形 await、job 靠轮询、压缩进度只存在于 SessionEvent 的四处旁路，现在是一条流。
  - **审批事件化（fail-closed 不变）**：`PermissionService` 的 ask 注入点保留为底层，内核提供适配器把 ask 转成"发 `approval_request` + 等 `resolveApproval`"；surface 断连或 abort 时挂起审批收敛为 deny。headless 消费者（exec/qqbot）继续走确定性拒绝。
  - **能力下沉**：`compact` / `auto-compact` / 上下文片段 / 工作区路径 / 会话索引从 cli 下沉 core（新公共导出）。`plugins/runtime.ts` 的 `createAgentKernel` 成为**装配单源**——host、审批桥、`PermissionService`、`JobRegistry`、上下文片段一处装配，provider 注入；core 保持 provider 与宿主无关。
  - **cli 变瘦**：argv → 装配哪个 surface + 配置发现 + provider 工厂 + 模型元数据。斜杠命令语义收为 `command-runner.ts` **一个 runner 两壳共用**（对内核做什么、参数怎么解析、报什么文案单源），顺带修掉 `nova --repl` 的 `/skill <name>` 死路（原先进「未知命令」）。exec/repl/qqbot 全部改为内核事件流的消费者——功能与 JSON 事件流 schema 不变。
  - `core` 另导出 `AgentSurface`（纯类型）：官方 surface 与第三方 surface 同地位，只依赖 core/plugins 公共 API，由 cli 按 argv 装配。
- 1b6376d: **TUI 全量重写：删除旧实现，新增 `@nova-agent/tui-app`**（M11 批4）。旧 `@nova-agent/tui-view` 全包（≈3,000 行纯视图层）、`cli/tui` 壳（≈4,500 行）与旧 `tui-mode.ts` **一行不留地删除**——渲染计算与产品逻辑长期纠缠、反复拖累开发。新包是 `nova` 的默认形态（非 TTY 与 `--repl` 仍回落 readline REPL）。
  
  - **三层分工**：纯函数层（`blocks` 事件归约 → `entries` 滚动条目 → `render` 显示行 → `panels` 卡片 → `frame` 整帧装配，`Palette` 注入、可假时钟直测）／按键层（`keys.ts` 一个 reducer：审批 → 模态面板 → 全局键 → 输入区，动作是描述不是执行）／壳层（`app.ts` 只留 alternate screen、raw 键盘、**一个时钟** `TICK_MS=33`、内核订阅与 tps/cache 计量——壳层不做版面算术）。
  - **M10 的逐值设计成果全部移植**：GrokNight RGB 四档调色板（truecolor / 16 色 / light / plain）、`layout.ts` 度量与**整屏一条左缘**、留白节奏与密度规则（工具行紧排、其余块一空行、提问自带 vpad）、**动词短语聚合行**、工具行**三态折叠**、reasoning 定高活窗口、导轨 `sin²` 行波、`<10s` 一位小数的活体行、贴底锚定（仅"转录里只剩欢迎卡"时居中）、输入卡 / 审批卡 / 队列 lane / 快捷键条 / 欢迎卡 / 列表面板。
  - **键位**：`Enter` 发送、`Shift+Enter` 换行、`/` 命令面板（Tab 补全 / ↑↓ 选择）、`Tab` 未开会话前循环 普通→PTC→混合、`↑↓` shell 式输入历史（草稿自动寄存）、`PageUp`/`PageDown`/滚轮滚动、工具行点击三态折叠（动词组行点击即展开成员）、`Ctrl+C` 中断 → 清草稿 → 两段退出、`Esc` 中断。
  - **保留的交互**：长粘贴折成 chip（缓冲区存全文，提交一字不差）、审批「总是允许」行 ←/→ 调授权词数（词前缀匹配）、「拒绝」行打字补理由并回流给模型、外部内容显示净化与焦点重读（沿用 `@nova-agent/tui`）。
  - **有意的取舍**：上下文仪表只有总量（无分区着色、无悬停换形）；↑↓ 是历史而非多行光标移动；启动**不等** models.dev（`contextWindow` 先取配置，目录异步到达后回填，冷缓存/断网不再先给十几秒空屏）。
  - **同批修掉的真 bug**：彩色终端下状态栏整字段被丢（调色板字符串用 `.length` 算宽 → 改走 `stringWidth`）；动词组行的 `▸` 是死 affordance（点击无反应 → `toggleEntry` 认 `group:` 前缀）。

### Patch Changes

- 1b6376d: 拒绝转追问（Grok 组件7 移植）：审批弹窗选中「拒绝」行后打字即补充拒绝理由（⌫ 删字、Enter 携理由拒绝、y/a 快捷批准不受影响），理由经 `{answer:'deny', reason}` → `decideDetailed` → hook verdict 一路回流，模型看到 `Permission denied: by user: <理由>` 而非光秃拒绝；AskFn 加宽 DenyGrant（老询问器零改动），空/畸形理由回落普通拒绝。
- b6255b3: 审批「总是允许」粒度可交互调节（Grok 组件6 移植）：弹窗选中 always 行时 ←/→ 调整授权词数（命令前 N 词实时预览、Enter/a 携带 `{answer:'always', scopeWords:N}`）；PermissionService 按**词前缀匹配**放行同前缀命令（`git status` 范围放行 `git status -sb`、不波及 `git commit`），N 越界/复合命令回落默认记忆粒度，畸形 grant fail-closed 拒绝；AskFn 返回值加宽（仍接受原 AskAnswer 字符串），弹窗提示行补全列裁剪。
- 42c1bfb: 治理换血与消重拆壳（M9.0–M9.K，行为保持不变重构）。
  
  - **公共面新增**：core 导出 `errMessage`（错误转消息字符串单源）与 `truncateUtf8Head` / `truncateUtf8Tail`（UTF-8 整字符边界字节裁剪，收编 agent 落盘 / jobs 读取 / AGENTS.md 裁剪三份同构循环）；plugins 导出 `resolveShellName`（bash/powershell 解析单源，收编 cli `declaredShell` 与 bash `invocation` 两份真相）；呈现层的 `Palette` 接口补 `reset` / `clearLine` / `clearRight` 开态原语（收编手滚 raw ANSI；无色调色板对控制码返回空串，保证 NO_COLOR 恒静默）。
  - **结构棘轮**：`pnpm gates`（依赖方向机检 + 逐文件行数硬上限，只降不升）、`pnpm check` 快环 / `pnpm verify` 全环分层、oxlint complexity/max-depth/长函数规则上线；决策笔记体系删除。
  - **消重**：四 runner 的用户消息提交/重试与空补全文案/回合失败归类/审批预览与 toast/hooks 重绑单源；repl 与 TUI 的 13 个斜杠命令下沉 command-core（M11 批5 进一步收为 `command-runner.ts` 一个 runner 两壳共用）；`repl.ts` 的瞬态进度行出壳 `ReplProgress`、`/session` `/model` `/plugins` 报告行下沉；core 的 989 行 `agent.ts` 拆为 `agent/{notices,request,stream,tools,loop,options}.ts` + 桶文件（40+ 条行为测试不动）；plugins 的 fs/bash/search/run-code 内联 execute 体提为顶层具名函数，工厂只留 schema+接线；各包 `test/helpers/` 收敛 `scriptedProvider`（5 拷贝）与 `withFakeHome`（2 拷贝）。
  - **声明的行为例外（漂移修复）**：repl 审批预览宽度统一走 `toolArgSummary`；exec/qqbot 调色板装配走 `resolvePalette`，开始尊重 `ui.theme` 与 `NO_COLOR`（此前恒暗色）；repl bash 输出尾行缓冲并入 TUI 同源的 `TOOL_TAIL_KEEP_CHARS`（显示行仍裁到单行，观感不变）。
  - **缺陷修复**：TUI 首装与 exec 路径的 `hooksRef` 从未赋值——嵌套 subagent 因此绕开父审批门（exec 的 never 策略形同虚设）；重绑单源后审批门对嵌套调用恢复生效。
  - **热路径微优化（行为不变）**：`request-trim` 的 snip+micro 共享一次 `groupMessages`（snip 未改动时同引用短路）；`estimateTextTokens` 的 CJK 判定由正则改为码点区间比较（消除每字符 regex.test）；`OpenAICompatClient` 的工具序列化按数组身份 `WeakMap` 缓存，`PluginHost.tools` 返回稳定引用跨轮失效仅在 registerTool——启动后稳定工具集下每请求免一次 sort+map。
- ef55de7: Terminal capability gates and focus re-assertion (M10 R6, ported from Grok Build): `detectCaps` now disables ?2026 synchronized output inside tmux (`TERM_PROGRAM=tmux` / `TMUX` set) — tmux repaints the whole pane when a sync block closes, so the wrapper amplifies paints there instead of preventing them; color is unaffected. `LineScreen` enables DEC 1004 focus reports and exposes `reassertModes()`; the TUI shell calls it on every focusin because Windows ConPTY relays can strip DEC private modes mid-session, silently degrading SGR mouse to X10 and painting raw mouse reports as escape garbage into the frame. `KeyDecoder` decodes `CSI I`/`CSI O` as new `focusin`/`focusout` key events (consumed at the chain head, never leaking into the composer).
- 3f15834: stdout 背压门（M10 R3，Grok WriterSync 单飞的 Node 等价物）：`LineScreen` 任一写入让 `write()` 返回 false（缓冲越过高水位）即关闭渲染门——后续帧整帧丢弃且**不更新差分缓存**（缓存恒等于屏幕物理内容），`drain` 事件开门并回调重排一次重绘，恢复首帧从旧真相直接 diff 到最新画面（latest-wins）。慢终端（SSH/ConHost）流式高峰期不再堆积一帧比一帧旧的过期写入。
- Updated dependencies [1b6376d]
- Updated dependencies [b6255b3]
- Updated dependencies [1e35cdb]
- Updated dependencies [1b6376d]
- Updated dependencies [1b6376d]
- Updated dependencies [1b6376d]
- Updated dependencies [42c1bfb]
- Updated dependencies [37ea5d6]
- Updated dependencies [1e35cdb]
- Updated dependencies [494541f]
- Updated dependencies [1e35cdb]
- Updated dependencies [ef55de7]
- Updated dependencies [1999ce0]
- Updated dependencies [1fc1728]
- Updated dependencies [3d9b23a]
- Updated dependencies [3f15834]
  - @nova-agent/plugins@0.4.0
  - @nova-agent/core@0.4.0
  - @nova-agent/tui-app@0.4.0
  - @nova-agent/tui@0.4.0
  - @nova-agent/web@0.4.0
  - @nova-agent/ai@0.4.0
  - @nova-agent/qqbot@0.2.3

## 0.3.0

### Minor Changes

- 23b36f6: TUI 主题基建：新语义主题层（tui-view `resolvePalette`，dark=原配色原样平移、默认观感逐字节不变）+ 终端能力探测（tui `detectCaps`：NO_COLOR / TERM=dumb 恒定无色、COLORTERM=truecolor 升 24-bit）+ `LineScreen` 可选 synchronized output（`?2026`，探测启用，消除撕裂）。配置新增 `ui.theme`（dark/light/plain，strict schema 兼容新增）、新 `--theme` flag 与 `/theme` 命令（REPL/TUI 均可运行中即时切换）；light 主题为亮背景高对比方案（truecolor 优先、16 色回落）。

### Patch Changes

- cfad259: composer 词级移动：KeyDecoder 的 CSI 方向键此前丢弃全部参数，`1;5C`（Ctrl+Right）被静默解成普通 right——现在保留修饰键参数并产出 `ctrl+left`/`ctrl+right`（其余修饰组合回落普通方向，行为不变）；composer 绑定 Ctrl+←/→ 词级光标移动（切词边界与 Ctrl+W 一致）。
- 47fa203: TUI 滚动锚定与位置指示：用户上滚后（PageUp/滚轮）新输出不再把视口往直播拽——流式追加的行数等量补偿 scroll offset，视口钉在用户当时看的绝对位置，回到底部后恢复跟随；上滚时呼吸行显示「⋯ 上方还有 N 行 · Home 跳顶 / End 回到底部」（不占内容行、不进状态栏，守 tui-design 红线）；光标已在行首/行尾时再按 Home/End 升级为历史区跳顶/回底。
- Updated dependencies [cfad259]
- Updated dependencies [47fa203]
- Updated dependencies [23b36f6]
  - @nova-agent/tui@0.3.0
  - @nova-agent/tui-view@0.3.0
  - @nova-agent/ai@0.3.0
  - @nova-agent/core@0.3.0
  - @nova-agent/plugins@0.3.0
  - @nova-agent/qqbot@0.2.2

## 0.2.1

### Patch Changes

- f364394: 后台子代理可见性 + 内置工具对 shell 的信息量反超：`JobRegistry` 快照新增 `startedAt`/`progress`（peek，不占模型输出游标），后台 subagent 的嵌套活动（N tools · 最近调用）喂入 TUI——每个运行中的后台委派钉一行 `⧉ 子代理 label · Ns · …`（自带刷新 interval，活过父轮仍更新），结束原位改写为状态+用量行。`list_dir` 输出携带文件字节数（不再输给 `ls -la`）；bash 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`（Windows 下 python heredoc 免手写编码样板）；系统提示的 `run_code` 引用改为模式中性表述。
- f364394: 压缩保真与全文存档：摘要提示词去掉 300 字上限改 codex 七节结构（任务/进展/决策与原因/现状/问题/下一步/引用），摘要输入工具结果截断 2000→4000 字符，保留预算 20k→32k 字符并纳入纯文本 assistant 回复（`selectRecentMessages`）；压缩前完整 transcript 未截断存档至 `~/.nova/cache/tool-outputs/<sessionId>/pre-compact-*.txt`（trusted read root 免审批），摘要尾部附 `<archive>` 指针供模型按需 read_file 回查，增量压缩链式引用更早存档。TUI 压缩期间摘要输出经 `onDelta` 喂入 tps 速度表，仪表不再冻结。
- f364394: 空补全重试，根除主循环静默停摆：content 为空、无工具调用、带 finish_reason 的补全（推理型 provider 把全部输出流进 reasoning_content 的病理）旧版会推进一条空 assistant 消息并以 complete 静默收场——用户看到思考停止后 agent 无声终止、无任何报错。现在 runAgent 视其为 provider 病理，自动重试同一请求 2 次（请求每轮构建一次、前缀稳定缓存友好；耗尽抛错并回队 job 通知），新增 `empty_completion` 事件（--json 事件流 additive），TUI/REPL 落「⟳ 空回复…自动重试 a/N」提示行。
- aef3b56: `nova exec` 回补中断归类（ffdc595 契约漏了第三个 runner）：SIGINT 真正解绕运行时不再误发 `run_error`（退出码 1）——现在 `--json` 下发 `{"type":"notice","text":"任务已中断（SIGINT）…"}`、人类输出亮「已中断」、进程退出码 130（惯例 SIGINT 语义）；错误文案含 "aborted" 的网络超时仍照常走 `run_error` + 退出码 1，与 repl/TUI 的「归类以本轮 signal 是否触发为准」对齐。
- c851e03: REPL 补齐 `/mode`：命令目录（COMMAND_SPECS）一直声明该命令，readline 实现却没有对应 case，输入 `/mode` 落「未知命令」。现在 repl 输出与 TUI 同语义的三态说明（普通 / PTC / 混合，❯ 标当前模式，取自 config 的 `tools.code.mode`）；`CODE_MODE_HINT` 从 TUI 壳层闭包常量提升为 tui-view 导出（TUI `/mode` 行为不变）。
- 178f7b6: 四 runner（TUI/REPL/exec/qqbot）的事件消费簿记收敛为单源 `runner-loop.ts`：会话日志追加（message/tool_call_result/turn_aborted）、usage/锚点簿记（含 prompt_tokens=0 护栏）、中断归类（`isUserInterrupt`，ffdc595 契约）与完成/出错 toast（`createTurnNotifier`）此前各 runner 一份（持久化 switch ×4、锚点归零 ×6、toast ×3），每次修复需同步改四处。附带修复：qqbot 模式的最终 assistant 回复此前漏写会话日志（违反 "model-visible means logged"，resume 后不可见），现在随簿记统一落盘。
- f364394: 开屏页重设计：splash 顶部加 ASCII figlet 版字 logo（窄终端自动省略），信息盒下新增交互式执行模式选择块——↑↓/滚轮移动、Enter 确认、Esc 保持当前、直接打字立即开始（首条提交自动塌缩为确认行）；Node < 22.19 时 PTC/混合行置灰并在移动中跳过；选择器为纯视图函数 + 按键责任链新层，块原位塌缩不留交互残骸；`toggleCodeMode` 抽出 `setCodeMode` 供 Tab 循环与开屏选择共用。
- 91f0832: 子代理完成行恢复点击展开：M7.10 的接管式活行去重引入回归——`tool_call_result` 先把待定条目从 toolBlocks 清空、再判"活行是否即工具行本体"恒不成立，接管行被移除后由完成行重推，`detail`（嵌套执行日志）随之丢失，子代理完成行点开无物。投影器化（M7.12）时 `SubagentLives.settle()` 改为在条目尚存时判定接管并保持块原位，完成行重新随详情收起可展开（内存态，resume 后不可展开——与 reasoning 详情同一契约）。
- f364394: TUI 压缩可取消 + 进度可见：`/compact` 与自动压缩期间按 Esc/Ctrl+C 现在会中止摘要请求（与 REPL 的 compactAbort 对齐，此前 TUI 是唯一无法取消压缩的入口，卡住的压缩只能杀进程）；「正在压缩…」等待行实时显示已耗时，成功/取消行附带耗时。压缩请求的 AbortController 会在退出时一并清理，不再吊住进程。
- 298bd36: TUI 会话切换（`/session` 选择器）的回放面过同一 markdown 渲染：此前实时流式回答经 markdown 渲染（粗体/标题/列表/围栏），切回历史会话却推裸文本——同一回答两套观感。现在回放的 assistant 消息走 `renderMarkdownLite`，实时与 resume 长得一样。
- Updated dependencies [f364394]
- Updated dependencies [f364394]
- Updated dependencies [f364394]
- Updated dependencies [c851e03]
- Updated dependencies [f364394]
- Updated dependencies [f364394]
  - @nova-agent/core@0.2.1
  - @nova-agent/plugins@0.2.1
  - @nova-agent/tui-view@0.2.1
  - @nova-agent/ai@0.2.1
  - @nova-agent/qqbot@0.2.1
  - @nova-agent/tui@0.2.1

## 0.2.0

### Minor Changes

- 43114fb: 版本号单一来源与展示：新增 `cliVersion()`（createRequire 读 `packages/cli/package.json`），取代 `index.ts` 硬编码 `VERSION`；TUI 开屏（`buildSplash`）与 REPL banner（`banner`）改渲染 `nova vX.Y.Z`，`/session` 面板展示版本与模式。引入 `@changesets/cli` 与 root `release`/`changeset` 脚本，monorepo 以 fixed 锁步组统一版本。新增 SemVer 2.0.0 合规校验（官方 ECMAScript 正则 + 7 个包版本一致），由 vitest 覆盖。

### Patch Changes

- d69b9ba: Unified TokenGate (auto-compact.ts shared by all runners): preflight uses anchor-or-full-estimate so resume of a large session can no longer blow the context window on its first request; compactConversation/compactSession accept an optional AbortSignal forwarded to the summarizer. always-approval scope narrows compound commands to the whole normalized chain. TUI error path discards uncommitted partial assistant blocks (screen/log divergence fix); REPL gets an equivalent dim hint. agentTurn gets a catch guard so errors outside the event loop surface as blocks, not unhandled rejections.
- c9a8f61: P3 polish: jobs.ts comment drift fixed (completion injection channel exists since M6.4); dead code removed (extractReasoningHeader, reasoningRows, questionLines, isBlankAnswer + their tests); {env:NAME} throws naming the missing variable instead of silently expanding to empty; --version/-v/--help/-h only match as leading flags; interactive mode warns on stray positionals; runCompact no longer zeros cumulative session stats; PTC both-mode SDK slims bindings to name + one-line summary (native schemas carry full types); search_files in-process walk checks abort signal; spacing.ts contract comment aligned with frame.ts tight-pair implementation.
- 21dfe53: Structural refactor: extracted createSessionRuntime (packages/cli/src/session-runtime.ts) merging the ~60-line duplicated session/client/host/skills/fragment startup across all three runners (exec/repl/tui); runtime exposes reloadWorkspaceContext for workspace switches so fragment closures stay consistent. TuiStore convergence: removed all three `as any`/`as unknown as TuiStore` casts from tui-mode.ts by fixing structural compatibility (sessionPicker/approval types already matched; appendTail implemented inline; blocksVersion wired as getter; onChange made public on TuiStore). store.ts onChange promoted from private constructor param to public field for structural assignability.
- Updated dependencies [cf9f16c]
- Updated dependencies [d69b9ba]
- Updated dependencies [c9a8f61]
- Updated dependencies [21dfe53]
- Updated dependencies [43114fb]
  - @nova-agent/plugins@0.2.0
  - @nova-agent/core@0.2.0
  - @nova-agent/ai@0.2.0
  - @nova-agent/tui@0.2.0
  - @nova-agent/tui-view@0.2.0
