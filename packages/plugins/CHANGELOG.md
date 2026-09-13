# @nova-agent/plugins

## 0.2.1

### Patch Changes

- f364394: 后台子代理可见性 + 内置工具对 shell 的信息量反超：`JobRegistry` 快照新增 `startedAt`/`progress`（peek，不占模型输出游标），后台 subagent 的嵌套活动（N tools · 最近调用）喂入 TUI——每个运行中的后台委派钉一行 `⧉ 子代理 label · Ns · …`（自带刷新 interval，活过父轮仍更新），结束原位改写为状态+用量行。`list_dir` 输出携带文件字节数（不再输给 `ls -la`）；bash 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`（Windows 下 python heredoc 免手写编码样板）；系统提示的 `run_code` 引用改为模式中性表述。
- Updated dependencies [f364394]
- Updated dependencies [f364394]
- Updated dependencies [f364394]
  - @nova-agent/core@0.2.1

## 0.2.0

### Patch Changes

- cf9f16c: 修复 `edit_file` 的 `$` 模式静默损坏：`applyEdit`/`tolerantReplace` 的替换值改用函数 replacer（`() => newString`），`$&`/`$1`/`` $` ``/`$'`/`$$` 一律按字面插入，不再被 RegExp 展开。修复 bash 输出头部截断丢尾：`runOnce`/`startBackground` 改用 `BudgetedBuffer` 双段缓冲（头部 60% + 环形尾部 40%，对齐 core 溢出落盘契约），中间丢弃字节数写入结果；背景 job 的 `readOutput` 保持 drain 语义，截断时给出提示。
- d69b9ba: Unified TokenGate (auto-compact.ts shared by all runners): preflight uses anchor-or-full-estimate so resume of a large session can no longer blow the context window on its first request; compactConversation/compactSession accept an optional AbortSignal forwarded to the summarizer. always-approval scope narrows compound commands to the whole normalized chain. TUI error path discards uncommitted partial assistant blocks (screen/log divergence fix); REPL gets an equivalent dim hint. agentTurn gets a catch guard so errors outside the event loop surface as blocks, not unhandled rejections.
- c9a8f61: P3 polish: jobs.ts comment drift fixed (completion injection channel exists since M6.4); dead code removed (extractReasoningHeader, reasoningRows, questionLines, isBlankAnswer + their tests); {env:NAME} throws naming the missing variable instead of silently expanding to empty; --version/-v/--help/-h only match as leading flags; interactive mode warns on stray positionals; runCompact no longer zeros cumulative session stats; PTC both-mode SDK slims bindings to name + one-line summary (native schemas carry full types); search_files in-process walk checks abort signal; spacing.ts contract comment aligned with frame.ts tight-pair implementation.
- 21dfe53: Structural refactor: extracted createSessionRuntime (packages/cli/src/session-runtime.ts) merging the ~60-line duplicated session/client/host/skills/fragment startup across all three runners (exec/repl/tui); runtime exposes reloadWorkspaceContext for workspace switches so fragment closures stay consistent. TuiStore convergence: removed all three `as any`/`as unknown as TuiStore` casts from tui-mode.ts by fixing structural compatibility (sessionPicker/approval types already matched; appendTail implemented inline; blocksVersion wired as getter; onChange made public on TuiStore). store.ts onChange promoted from private constructor param to public field for structural assignability.
- Updated dependencies [d69b9ba]
- Updated dependencies [c9a8f61]
- Updated dependencies [21dfe53]
  - @nova-agent/core@0.2.0
