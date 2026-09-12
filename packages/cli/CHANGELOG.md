# @nova-agent/cli

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
