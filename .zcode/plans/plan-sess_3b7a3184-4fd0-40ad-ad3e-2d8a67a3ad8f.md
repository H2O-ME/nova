# tui-mode.ts 渐进重构：纯函数出闭包，TUI 首次可单测

## 目标与原则

把 2,147 行的 `startTui` 闭包拆成两层：**闭包壳**（只管定时器、终端 IO、状态突变）与**纯计算模块**（显式快照入参 → 字符串输出，可单测）。原则：

- **搬运为主，零行为变更**——不重新设计任何视觉；`ui.ts` 已确立的模式（Palette 第一参数、`plainPalette` 测无 ANSI、数据表驱动）原样延续。
- 渲染入参用**视图快照**（每帧由 renderFrame 组装的 plain object），不搬闭包里的 20 多个 `let`。
- 不动的东西：`renderFrame` 主循环与 `wrapBlock`/`scrollFromEnd` 钳制、`scheduleRender`/`preemptRender` 时序、`agentTurn`/`onAgentEvent`、repl/exec。
- 每个阶段一个 commit，各自 `pnpm verify` 全绿，可独立回滚。

## C1 · `statusbar.ts`（最大收益）

新文件 `packages/cli/src/statusbar.ts`（~250 行），从 tui-mode 搬出并纯化：

- `statusBar(view: StatusView): string` ← 现 `statusBarLine`(1911–1948) + `statusLeft`(1957–1975) + `modeChips`(1889–1896)，tier 循环与"先丢瞬时提示再降档"的选档顺序原样搬运。
- `contextForms(view: ContextView): [string, string, string]` ← `contextBreakdown`(1983–2033) 改为显式入参（systemPrompt / tools / messages / usageAnchor / anchorMsgCount / contextWindow / modelMeta）；档位选择仍在 ui.ts `contextGaugeForms`。
- `StatusView` 字段：`cols, model, approvalMode, codeModeLabel, pristine, streaming, interruptAt, inputEmpty, lastCtrlC, now, tpsRing, promptTokens, cachedTokens, cacheSeen, gaugeForms`。
- **缓存留在闭包**：`contextLineCache`(2040–2053) 的"按 key 记忆三档"逻辑留在 tui-mode（估计 messages 全量每帧重算是性能雷区），只把计算本体挪出去；新增纯函数 `gaugeCacheKey(view)`。
- 测试 `packages/cli/test/statusbar.test.ts`：重点钉住**降级顺序表**（T0 全量 → 丢提示 → T1 去标签 → T2 单字审批 → 弃模型 → 截断）与"tps 定宽不挪分隔符、截左保右"，plainPalette 精确断言。

## C2 · `composer.ts` + 根除 popup 高度双推导

新文件 `packages/cli/src/composer.ts`（~120 行）：

- `composerZone(rows, view: { spinnerFrame, streaming, genPhase })` ← 现 1832–1849；`renderComposerRow`(1852–1857) 本来就零闭包依赖，直接搬。
- `cursorPosition({ historyRows, popupRows, layout })`：改收 `popupRows: number`。**删除 `popupHeight`(1859–1871)**——renderFrame 已经构造了 `popupLines`，把 `popupLines.length` 传进 `cursorPosition`(1873–1883)，消灭两套平行推导。
- `layoutComposer`/`wrapComposer` 留在 ui.ts（已有测试），不动。
- 测试并入 `prompt-ui.test.ts` 新 describe 或 composer 自己的小文件。

## C3 · `popup.ts`：四个审批/选择弹窗的纯构建器

新文件 `packages/cli/src/popup.ts`（~200 行），把 renderFrame 内 1681–1781 的四分支组装搬出为：

- `buildApprovalPopup(view: { permissionLabel, toolName, summary, previewLines, index }, cols): string[]`（头部与 diff 预览按列裁剪的 M6.5 行为原样保留）
- `buildModelPopup`, `buildSessionPopup`（含 `formatStamp`/当前会话"（当前）"标记/`clipToWidth`）, `buildCommandPopup`（↑↓ 滑窗选中）
- 入参在 tui-mode 侧解包（picker 对象 → plain 数据），渲染输出逐字节一致。
- 顶层小工具 `padDisplay`(126–129)、`formatStamp`(132–136) 移入 ui.ts 并导出（popup.ts 与 tui-mode 共用）。
- 测试 `packages/cli/test/popup.test.ts`：审批弹窗单行不折行预算、会话 picker 窄列裁剪、命令面板滑窗边界。

## C4 · `handleKey` 拆分层（文件内，不换文件）

1328–1625 的 300 行 if 链改为同文件内的责任链，每层返回 `true` 表示吞掉按键：

`handleKey(k)` = `keyApprovalModal(k)` → `keyModelPicker(k)` → `keySessionPicker(k)` → `keyGlobal(k)`（ctrl+c/d/esc 中断退出，1426–1457）→ `keyComposerAndPopup(k)`（编辑/导航/历史/滚动，落到尾部统一 `scheduleRender`）。

逻辑逐分支原样搬运，仅函数边界是新的。行为不变所以不强行造测试（副作用层不可纯测，属壳层职责）。

## C5 · 文档与构建同步

- AGENTS.md §4 表 cli 行"关键文件"补 `statusbar.ts`、`composer.ts`、`popup.ts`；§6 代码约定加一条："**TUI 分层**：渲染计算 = 纯模块（快照入参、Palette 注入、plainPalette 可测）；闭包壳只留定时器/终端 IO/状态突变。新交互先问能不能写成纯函数。"
- tsdown 入口只认 `src/index.ts` import 链，新文件被 tui-mode 静态引用即进 bundle，无需改构建配置（探索已确认）。
- 收尾 `pnpm build` 使 dist 生效（`nova` 跑 dist）。

## 预期效果

tui-mode.ts 2,147 → 约 1,550 行；TUI 的表现层（状态栏降级、四个弹窗、composer）首次获得回归护栏——正是历史上反复打补丁最频繁的部位。新增测试约 350–400 行。

## 验证

1. 每步 `pnpm verify`（build+typecheck+test）+ `pnpm lint` 全绿。
2. 非 TTY 冒烟：`nova --repl` 走 readline 不受影响；`nova exec "echo hi" --json` 端到端一遍。
3. TUI 真机冒烟（需要你在真终端跑一次 `pnpm dev`）：状态栏三档降级、Tab 切模式、审批弹窗、`/model` `/session` 面板、上滚。

## 不做清单

不拆 `agentTurn`/`onAgentEvent`（中等价值，留作后续）；不动差分渲染/滚动钳制/`wrapBlock`；不给 TUI 引状态管理框架；不改 repl.ts、exec.ts。