# @nova-agent/cli

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
