# @nova-agent/core

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
