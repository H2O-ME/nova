# @nova-agent/tui

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
