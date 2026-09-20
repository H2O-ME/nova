# @nova-agent/tui

## 0.4.0

### Minor Changes

- 3d9b23a: Display sanitizer for external content (M10 R1, ported design from Grok Build's terminal_output emulation). New `@nova-agent/tui` export `sanitizeForDisplay`: keeps SGR sequences, strips every other escape (CSI cursor moves/erases, OSC, private modes, stray ESC), normalizes `\r\n`, drops lone `\r` without ever adding newlines, expands tabs, and removes C0/C1/DEL. Wired at three points: `LineScreen.render` (the TUI choke point — a `\x1b[2K` riding in a frame line used to execute on the real screen while the diff cache remembered stale text, desyncing rendering until `invalidate()`), `toolDoneLine` content, and `toolArgSummary` results. Width math now runs after sanitizing, so stripped bytes no longer inflate styledWidth and trigger phantom `…` truncation.

### Patch Changes

- 1b6376d: **TUI 全量重写：删除旧实现，新增 `@nova-agent/tui-app`**（M11 批4）。旧 `@nova-agent/tui-view` 全包（≈3,000 行纯视图层）、`cli/tui` 壳（≈4,500 行）与旧 `tui-mode.ts` **一行不留地删除**——渲染计算与产品逻辑长期纠缠、反复拖累开发。新包是 `nova` 的默认形态（非 TTY 与 `--repl` 仍回落 readline REPL）。
  
  - **三层分工**：纯函数层（`blocks` 事件归约 → `entries` 滚动条目 → `render` 显示行 → `panels` 卡片 → `frame` 整帧装配，`Palette` 注入、可假时钟直测）／按键层（`keys.ts` 一个 reducer：审批 → 模态面板 → 全局键 → 输入区，动作是描述不是执行）／壳层（`app.ts` 只留 alternate screen、raw 键盘、**一个时钟** `TICK_MS=33`、内核订阅与 tps/cache 计量——壳层不做版面算术）。
  - **M10 的逐值设计成果全部移植**：GrokNight RGB 四档调色板（truecolor / 16 色 / light / plain）、`layout.ts` 度量与**整屏一条左缘**、留白节奏与密度规则（工具行紧排、其余块一空行、提问自带 vpad）、**动词短语聚合行**、工具行**三态折叠**、reasoning 定高活窗口、导轨 `sin²` 行波、`<10s` 一位小数的活体行、贴底锚定（仅"转录里只剩欢迎卡"时居中）、输入卡 / 审批卡 / 队列 lane / 快捷键条 / 欢迎卡 / 列表面板。
  - **键位**：`Enter` 发送、`Shift+Enter` 换行、`/` 命令面板（Tab 补全 / ↑↓ 选择）、`Tab` 未开会话前循环 普通→PTC→混合、`↑↓` shell 式输入历史（草稿自动寄存）、`PageUp`/`PageDown`/滚轮滚动、工具行点击三态折叠（动词组行点击即展开成员）、`Ctrl+C` 中断 → 清草稿 → 两段退出、`Esc` 中断。
  - **保留的交互**：长粘贴折成 chip（缓冲区存全文，提交一字不差）、审批「总是允许」行 ←/→ 调授权词数（词前缀匹配）、「拒绝」行打字补理由并回流给模型、外部内容显示净化与焦点重读（沿用 `@nova-agent/tui`）。
  - **有意的取舍**：上下文仪表只有总量（无分区着色、无悬停换形）；↑↓ 是历史而非多行光标移动；启动**不等** models.dev（`contextWindow` 先取配置，目录异步到达后回填，冷缓存/断网不再先给十几秒空屏）。
  - **同批修掉的真 bug**：彩色终端下状态栏整字段被丢（调色板字符串用 `.length` 算宽 → 改走 `stringWidth`）；动词组行的 `▸` 是死 affordance（点击无反应 → `toggleEntry` 认 `group:` 前缀）。
- 42c1bfb: 治理换血与消重拆壳（M9.0–M9.K，行为保持不变重构）。
  
  - **公共面新增**：core 导出 `errMessage`（错误转消息字符串单源）与 `truncateUtf8Head` / `truncateUtf8Tail`（UTF-8 整字符边界字节裁剪，收编 agent 落盘 / jobs 读取 / AGENTS.md 裁剪三份同构循环）；plugins 导出 `resolveShellName`（bash/powershell 解析单源，收编 cli `declaredShell` 与 bash `invocation` 两份真相）；呈现层的 `Palette` 接口补 `reset` / `clearLine` / `clearRight` 开态原语（收编手滚 raw ANSI；无色调色板对控制码返回空串，保证 NO_COLOR 恒静默）。
  - **结构棘轮**：`pnpm gates`（依赖方向机检 + 逐文件行数硬上限，只降不升）、`pnpm check` 快环 / `pnpm verify` 全环分层、oxlint complexity/max-depth/长函数规则上线；决策笔记体系删除。
  - **消重**：四 runner 的用户消息提交/重试与空补全文案/回合失败归类/审批预览与 toast/hooks 重绑单源；repl 与 TUI 的 13 个斜杠命令下沉 command-core（M11 批5 进一步收为 `command-runner.ts` 一个 runner 两壳共用）；`repl.ts` 的瞬态进度行出壳 `ReplProgress`、`/session` `/model` `/plugins` 报告行下沉；core 的 989 行 `agent.ts` 拆为 `agent/{notices,request,stream,tools,loop,options}.ts` + 桶文件（40+ 条行为测试不动）；plugins 的 fs/bash/search/run-code 内联 execute 体提为顶层具名函数，工厂只留 schema+接线；各包 `test/helpers/` 收敛 `scriptedProvider`（5 拷贝）与 `withFakeHome`（2 拷贝）。
  - **声明的行为例外（漂移修复）**：repl 审批预览宽度统一走 `toolArgSummary`；exec/qqbot 调色板装配走 `resolvePalette`，开始尊重 `ui.theme` 与 `NO_COLOR`（此前恒暗色）；repl bash 输出尾行缓冲并入 TUI 同源的 `TOOL_TAIL_KEEP_CHARS`（显示行仍裁到单行，观感不变）。
  - **缺陷修复**：TUI 首装与 exec 路径的 `hooksRef` 从未赋值——嵌套 subagent 因此绕开父审批门（exec 的 never 策略形同虚设）；重绑单源后审批门对嵌套调用恢复生效。
  - **热路径微优化（行为不变）**：`request-trim` 的 snip+micro 共享一次 `groupMessages`（snip 未改动时同引用短路）；`estimateTextTokens` 的 CJK 判定由正则改为码点区间比较（消除每字符 regex.test）；`OpenAICompatClient` 的工具序列化按数组身份 `WeakMap` 缓存，`PluginHost.tools` 返回稳定引用跨轮失效仅在 registerTool——启动后稳定工具集下每请求免一次 sort+map。
- ef55de7: Terminal capability gates and focus re-assertion (M10 R6, ported from Grok Build): `detectCaps` now disables ?2026 synchronized output inside tmux (`TERM_PROGRAM=tmux` / `TMUX` set) — tmux repaints the whole pane when a sync block closes, so the wrapper amplifies paints there instead of preventing them; color is unaffected. `LineScreen` enables DEC 1004 focus reports and exposes `reassertModes()`; the TUI shell calls it on every focusin because Windows ConPTY relays can strip DEC private modes mid-session, silently degrading SGR mouse to X10 and painting raw mouse reports as escape garbage into the frame. `KeyDecoder` decodes `CSI I`/`CSI O` as new `focusin`/`focusout` key events (consumed at the chain head, never leaking into the composer).
- 1999ce0: Empty-frame drop and cursor-action dedup in `LineScreen` (M10 R2, design ported from Grok Build's presenter): a render whose frame is byte-identical to the previous one and whose hardware-cursor target hasn't moved now writes **zero bytes** — not even the ?2026 synchronized-output wrapper. Idle animation ticks on SSH/Windows consoles stop paying the write-amplification tax. The cursor `MoveTo` is only re-emitted when its target changes or when the frame actually rewrote rows (row writes land the physical cursor at their tail, which invalidates the remembered position).
- 1fc1728: 帧数组双缓冲乒乓（M10 R8）：`LineScreen.render` 的整帧数组不再每帧新建——prev 与本帧各占一块 scratch 缓冲、原位重填后轮换，流式高峰期每帧少一次 rows 长度数组分配（跨帧别名由乒乓排除）。
- 3f15834: stdout 背压门（M10 R3，Grok WriterSync 单飞的 Node 等价物）：`LineScreen` 任一写入让 `write()` 返回 false（缓冲越过高水位）即关闭渲染门——后续帧整帧丢弃且**不更新差分缓存**（缓存恒等于屏幕物理内容），`drain` 事件开门并回调重排一次重绘，恢复首帧从旧真相直接 diff 到最新画面（latest-wins）。慢终端（SSH/ConHost）流式高峰期不再堆积一帧比一帧旧的过期写入。

## 0.3.0

### Minor Changes

- 23b36f6: TUI 主题基建：新语义主题层（tui-view `resolvePalette`，dark=原配色原样平移、默认观感逐字节不变）+ 终端能力探测（tui `detectCaps`：NO_COLOR / TERM=dumb 恒定无色、COLORTERM=truecolor 升 24-bit）+ `LineScreen` 可选 synchronized output（`?2026`，探测启用，消除撕裂）。配置新增 `ui.theme`（dark/light/plain，strict schema 兼容新增）、新 `--theme` flag 与 `/theme` 命令（REPL/TUI 均可运行中即时切换）；light 主题为亮背景高对比方案（truecolor 优先、16 色回落）。

### Patch Changes

- cfad259: composer 词级移动：KeyDecoder 的 CSI 方向键此前丢弃全部参数，`1;5C`（Ctrl+Right）被静默解成普通 right——现在保留修饰键参数并产出 `ctrl+left`/`ctrl+right`（其余修饰组合回落普通方向，行为不变）；composer 绑定 Ctrl+←/→ 词级光标移动（切词边界与 Ctrl+W 一致）。

## 0.2.1

No changes in this release.

## 0.2.0

### Patch Changes

- d69b9ba: Unified TokenGate (auto-compact.ts shared by all runners): preflight uses anchor-or-full-estimate so resume of a large session can no longer blow the context window on its first request; compactConversation/compactSession accept an optional AbortSignal forwarded to the summarizer. always-approval scope narrows compound commands to the whole normalized chain. TUI error path discards uncommitted partial assistant blocks (screen/log divergence fix); REPL gets an equivalent dim hint. agentTurn gets a catch guard so errors outside the event loop surface as blocks, not unhandled rejections.
- c9a8f61: P3 polish: jobs.ts comment drift fixed (completion injection channel exists since M6.4); dead code removed (extractReasoningHeader, reasoningRows, questionLines, isBlankAnswer + their tests); {env:NAME} throws naming the missing variable instead of silently expanding to empty; --version/-v/--help/-h only match as leading flags; interactive mode warns on stray positionals; runCompact no longer zeros cumulative session stats; PTC both-mode SDK slims bindings to name + one-line summary (native schemas carry full types); search_files in-process walk checks abort signal; spacing.ts contract comment aligned with frame.ts tight-pair implementation.
- 21dfe53: Structural refactor: extracted createSessionRuntime (packages/cli/src/session-runtime.ts) merging the ~60-line duplicated session/client/host/skills/fragment startup across all three runners (exec/repl/tui); runtime exposes reloadWorkspaceContext for workspace switches so fragment closures stay consistent. TuiStore convergence: removed all three `as any`/`as unknown as TuiStore` casts from tui-mode.ts by fixing structural compatibility (sessionPicker/approval types already matched; appendTail implemented inline; blocksVersion wired as getter; onChange made public on TuiStore). store.ts onChange promoted from private constructor param to public field for structural assignability.
