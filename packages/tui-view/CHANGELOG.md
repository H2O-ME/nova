# @nova-agent/tui-view

## 0.2.1

### Patch Changes

- f364394: 后台子代理可见性 + 内置工具对 shell 的信息量反超：`JobRegistry` 快照新增 `startedAt`/`progress`（peek，不占模型输出游标），后台 subagent 的嵌套活动（N tools · 最近调用）喂入 TUI——每个运行中的后台委派钉一行 `⧉ 子代理 label · Ns · …`（自带刷新 interval，活过父轮仍更新），结束原位改写为状态+用量行。`list_dir` 输出携带文件字节数（不再输给 `ls -la`）；bash 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`（Windows 下 python heredoc 免手写编码样板）；系统提示的 `run_code` 引用改为模式中性表述。
- f364394: 思考流式尾行去掉轮换动画字符：最后一行显示纯暗色正文，不再前缀 braille 码字（"生成中"由 composer 前缀 spinner 表达）；spinner tick 对 reasoning 活窗口的周期性重绘随之移除。
- c851e03: REPL 补齐 `/mode`：命令目录（COMMAND_SPECS）一直声明该命令，readline 实现却没有对应 case，输入 `/mode` 落「未知命令」。现在 repl 输出与 TUI 同语义的三态说明（普通 / PTC / 混合，❯ 标当前模式，取自 config 的 `tools.code.mode`）；`CODE_MODE_HINT` 从 TUI 壳层闭包常量提升为 tui-view 导出（TUI `/mode` 行为不变）。
- f364394: 开屏页重设计：splash 顶部加 ASCII figlet 版字 logo（窄终端自动省略），信息盒下新增交互式执行模式选择块——↑↓/滚轮移动、Enter 确认、Esc 保持当前、直接打字立即开始（首条提交自动塌缩为确认行）；Node < 22.19 时 PTC/混合行置灰并在移动中跳过；选择器为纯视图函数 + 按键责任链新层，块原位塌缩不留交互残骸；`toggleCodeMode` 抽出 `setCodeMode` 供 Tab 循环与开屏选择共用。
- Updated dependencies [f364394]
- Updated dependencies [f364394]
- Updated dependencies [f364394]
  - @nova-agent/core@0.2.1
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
  - @nova-agent/plugins@0.2.0
  - @nova-agent/core@0.2.0
  - @nova-agent/tui@0.2.0
