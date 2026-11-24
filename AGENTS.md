# AGENTS.md — NovaAgent

> 本文件是仓库的**唯一权威文档与 Agent 行为守则**。`README.md` 只是门面页。**机制变了就改这里**。

---

## 0. Agent 工作行为守则（最高优先级，违者即偏离目标）

所有进入本仓库工作的 Agent 必须无条件严格遵守以下执行姿态，以杜绝推进缓慢、过度测试与 Token 浪费：

1. **统一使用中文回复**：
   - 除非代码本身、标识符或用户有特别指示，所有思考总结、执行过程说明、错误分析与最终回复**一律必须使用中文**。
2. **最小必要修改（Minimal Blast Radius）**：
   - 紧贴用户本次任务，**严禁主动发起与需求无关的代码重构、格式整理或“预防性优化”**。
   - 严禁为了所谓“设计优雅”随意碰触未受影响的上下游模块；改动越克制，回归风险越低。
3. **拒绝过度思考与哲学推演（No Over-Thinking）**：
   - 面向架构与接口设计时，直接依循本文档既有的单例、单一入口与容器契约，**严禁在思考链（CoT）中复盘历史改动或进行多轮利弊辩经**。
   - 快速假设、快速修改代码，以真实的编译与快环测试为唯一裁决依据。
4. **按需测试，拒绝过度测试（No Over-Testing）**：
   - **日常验证首选快环**：改动完成后优先运行 `pnpm check`，或直接执行单测试文件 `pnpm vitest run <file>`。
   - **严禁擅自跑全量 `pnpm verify` 或全仓测试**，除非用户明确要求提交前封板验收。
   - **仅测试核心契约与关键边界**：新增或修改逻辑只需补充 1~3 个覆盖正向流与错误回落的确定性单测，**坚决不写排列组合式、变异式的冗长测试**；只测不变量，不测具体文案。
5. **行数只守「巨型文件」，不参与「要不要拆」**：
   - 单文件阈值 **600 行**（`scripts/structure-budget.mjs`）。低于它完全自由，**新建文件无需登记**任何账本。
   - 是否拆分只由**职责边界**决定：一个文件同时承担两件可命名的事就拆，只为把行数压到某个数字而拆是明确禁止的。
   - 已超阈值的 5 个存量文件记在豁免表里，**只许缩不许涨**；涨了要 `pnpm gates:update` 显式承认（diff 里看得见）。

---

## 1. 项目概览

自研、插件化、轻量化的跨平台本地 agent 运行时：在**当前工作目录**运行，通过任意 OpenAI 兼容端点对接模型，以「一切皆插件」的内核统一扩展工具、斜杠命令、钩子、Skills 与能力服务；界面只是同一内核事件流的消费者。所有数据集中在 `~/.nova/`，**工作区目录零写入**。

**产品定位（2026-11-22，2026-11-24 修正）**：通用、轻量、本地的个人 agent，参照 WorkBuddy 的定位——办公、写作、资料整理、数据、日常自动化与编程**并列**，都是它要可靠执行的任务类型。「通用化」是**不止编程**（类似 ZCode 的编程 / 办公双模式），不是「去编程」；被降级的是「编程作为组织整个产品的默认假设」，不是编程本身。桌面右栏因此只保留**文件目录 + 文件预览**（变更 / 任务 / 终端 / 起始页已删除，宿主侧 PTY 与 git 变更帧一并移除）；模型在对话里用 **A2UI v1.0**（`render_ui` 工具）生成卡片、表单与按钮，用户的操作作为下一条消息回到 agent。

- **运行时**：Node.js ≥ 20；PTC 代码模式要求 ≥ 22.19（`stripTypeScriptTypes`）。
- **工具链**：TypeScript（strict，`noUncheckedIndexedAccess`）、ESM-only；构建 `tsdown`、测试 `vitest`、lint `oxlint`、包管理 pnpm。无 prettier。
- **跨平台**：Linux / Windows 兼容（macOS 顺带兼容）。路径一律 `node:path` + 抽象层，**禁止硬编码 `/` 或 `\`**。

---

## 文档索引（细则不在本文件，按任务只读相关的那一份）

| 文档 | 何时读 |
| --- | --- |
| `docs/NOVA-GENERALIST.md` | **通用化纲领**：定位、执行契约、批次表（G 系列）、每批开工条件与删除判据。**历史留档类文档已于 2026-11-20 精简删除**（0.5.0 总纲 / 设计系统 / UI 架构 / Windows 纲领 / 测试纪律 / dsh 对账 / 两份审计留档），内容可从 git 历史或 `.docs-archive/` 取回 |
| `docs/NOVA-BOUNDARIES.md` | 改动跨包依赖、插件边界、测试边界时 |
| `packages/web/ui/DESIGN.md` | **改任何 UI / 样式 / 组件前必读**：样式层决策树、token 词汇表（脚本生成）、守卫规则、常见 recipe、验证矩阵 |

> **重构期测试纪律例外**：§0.4「拒绝过度测试」持续有效；重构批次的验收以 `docs/NOVA-GENERALIST.md` §6 各批「验收」段为准，两者冲突时以后者为准。

---

## 2. 常用命令矩阵

| 命令 | 适用场景 / 说明 | 耗时/开销 |
| --- | --- | --- |
| `pnpm check` | **开发快环（首选）**：lint + gates + `--changed` 增量测试 | 快 |
| `pnpm vitest run <path>` | **单文件精准验证**：开发时只跑对应测试文件 | 极快 |
| `pnpm typecheck` | 逐包类型检查（改了 core/plugins 后要先 build 才能查上层） | 中 |
| `pnpm gates` | 结构棘轮：依赖方向白名单 + 单文件 600 行阈值 + 测试边界 + UI token 全仓上限 + DESIGN.md token 表新鲜度 | 快 |
| `pnpm gates:update` | 同步行数豁免表 / UI token 上限（仅是「承认存量」，不是日常动作） | 快 |
| `pnpm tokens:doc` | 重新生成 `packages/web/ui/DESIGN.md` 的 token 表（改 token 后必跑） | 快 |
| `pnpm dev` | tsx 直跑 cli 源码（免构建调试） | - |
| `pnpm build` | 全量构建（修改底层包且需要 dist 验证时） | 较慢 |
| `pnpm verify` | **全环封板验收**：build + typecheck + test + gates（仅在任务交付时使用） | 慢 |

> ⚠️️ 运行 `pnpm nova` 跑的是 `packages/cli/dist`。本地开发调试一律优先使用 `pnpm dev`。

---

## 3. 架构白名单与核心约束

### 依赖方向白名单（严格遵守，严禁跨层引入）
`dep-direction.mjs` 静态扫描源码文本，名单之外引入即报错中断：
- `core`: `[]`（绝对底层，零上游依赖）
- `ai`: `[core]`
- `plugin-subagent` / `plugin-context` / `plugin-ptc`: `[core]`
- `plugins`: `[core, plugin-subagent, plugin-context, plugin-ptc]`
- `web`: `[core, plugins]`（绝不能引入 `cli`；`plugin-context` 已从名单移出——它经 `contextInsights` 能力键取值，服务缺席即降级，不让一个可选扩展成为这个表面的安装期硬需求）
- `cli`: `[plugins, ai, core, web]`

> **渠道型 surface 不随本仓发行**：它们是自己独立的包/仓库，按 `surfaces` / `plugins.entries` 配置行加载，cli 源码不点名、白名单里也没有条目。

### 核心设计不变量（遵循既有设计，禁止自行扩展）
1. **单一事实来源**：
   - 审批答案解析：唯一定义在 `core/approval.ts: parseAskResult`。
   - 文本控制字符清洗：唯一定义在 `core/src/text.ts: oneLineText / hasControlChars`。
   - 呈现意图形状：唯一定义在 `core/presentation.ts`，视图卡片解析只走 `callViewOf` / `resultViewOf`。
   - 工具缺失结果补齐：唯一定义在 `session/session-repair.ts: missingToolResults`。
2. **容器与插件规范**：
   - 注册工具统一用 `registerTool(ctx, def, permission)`，注册命令用 `registerCommand(ctx, def)`。
   - 插件故障记录在状态 `error` 中，绝不从 `create/update/reconcile` 中抛出未处理异常崩溃主进程。
3. **会话日志 v2（不可变事件流）**：
   - 模型可见性与日志强绑定：`Session.appendEvent` 是单文件唯一写入者，严禁直接使用底层 fs 追加。
   - 动态上下文注入一律追加在会话首条 user 消息（`<user_instructions>` 片段），保证前缀稳定提升缓存命中率。
4. **权限与审批**：
   - 审批档位与记忆按会话隔离（每会话独立）；唯有 `approvalPolicy`（`ask` / `never`）为进程级状态。

### ZCode 参照纪律（防屎山，2026-11-21 起）

改动以下五类之前，先学 ZCode 的同类方案，再写 3–5 行「对照了哪个模块 / 采用什么 / 放弃什么 / 为什么」小结（进提交说明或代码注释），最后按本仓惯例落地：

- 新增包 / 改包间依赖 → `architecture-policy.yaml`（模块注册表）
- 新增或修改协议、帧、跨进程数据 → `packages/*/contract.ts` 模式
- 新增工具或任何外部副作用入口 → CLI adapter 规范
- 改 UI 架构、状态管理、样式 → 本仓 `packages/web/ui/DESIGN.md`；ZCode 对照物 `packages/ui/AGENTS.md`
- 并发、队列、输入接纳、所有权路由 → `CommandInbox` / owner-lease 语义

参照源码：优先 `.reference/zcode/`（只读、不随本仓发行）；本机已有只读副本 `D:\web\zcode-desktop-ui-study`（含 `DESIGN.md` / `packages/ui/AGENTS.md` / `architecture-policy.yaml`）。找不到对应物时写明「原创取舍」。**禁止修改参照源码；禁止拷贝代码入库**（确需移植：重写为本仓风格 + Apache 2.0 来源标注 + 向用户说明）。

**不学**：体量与文档规模、平台绑定、Electron 级依赖、为对齐而过度分层。

### 已落地的 ZCode 对照（2026-11-25，声明式 hooks + 插件包）

对照 `apps/zcode-cli/packages/core/src/hooks/{output,runner,configured-runner-input,configured-runner-callback}.ts`、`packages/contracts/src/hooks/index.ts`、`docs/hooks-runtime-contract.md`。

- **采用**：7 事件名与 matcher 三态语法（精确名列表 / 正则 / `*`）、`process`/`command` 两种执行体、Claude 兼容 stdin（camel+snake 双写、临时 `transcript.jsonl`）、stdout JSON 契约（`decision` / `continue` / `stopReason` / `additionalContext` / `hookSpecificOutput` 判别联合）、退出码 0/2/其他、`onError` 默认 fail-open 且 **`deny` 仅对 PreToolUse 生效**、多 hook **聚合**（deny>ask>allow，非首赢）、Stop 续跑上限 3 次、`hooks.enabled` 显式开启、插件目录包（`.zcode-plugin/plugin.json` + skills/commands/hooks）。
- **放弃**：五路来源合并与 `.agents`/`.claude` legacy 兼容（本仓无生态包袱）、工作区 hooks 的 digest + Trust admission（下一批）、extension host 三级 UI 分权（ZCode 自述"按插件授权不是安全边界"，本仓不引入）、`prompt`/`agent`/`http`/`callback` 等未实现 Hook 类型。
- **偏离并注明**：工具 hook 的 `additionalContext` 暂拼进 tool result 文本（ZCode 走独立 `tool_hook_context` 附件；本仓尚无附件通道，已在 `hook-bridge.ts` 注明）、`updatedInput` 未做工具 schema 二次校验（缺校验器，下一批）。
- **为什么**：事件与执行器复用既有容器事件链与 fiber 生命周期，配置驱动部分只是「把外部命令接到那些键上」，不新增第二套分发机制。
- **随产品发行的插件包默认关、且不随 `hooks.enabled` 走**（2026-11-25 第二批）：这两条都是**照 ZCode 源码定的，不是自创**。① ZCode 里「已安装插件 hooks 按现有 plugin 来源规则执行」，`hooks.enabled` 只作用于配置文件来源（`docs/hooks-runtime-contract.md` 契约 2/3；`createRuntimeHookRunner` 里任一插件带 hook 即强制启用 runner）——所以本仓 `hook-row` 的 config 源受 `enabled` 门控、pack 源不受。② ZCode 里插件必须显式 install 才存在，而 Nova 无 install 步骤，于是 `packs/`（随产品携带）用 `enabled: true` 行充当那次 install：**携带 ≠ 同意执行**，因为包的 hooks 以用户权限跑本地命令、mimosa 之类还会往扫描根旁写 `.mimosa/`，默认开就破了「工作区零写入」。三级根与两级默认值写在 `packs/README.md`。

---

## 4. 关键文件索引（定位修改直接切入）

- **Agent 循环与内核状态机**：`packages/core/src/agent/`、`packages/core/src/kernel/session.ts`
- **容器与核心能力键**：`packages/core/src/plugin/capabilities.ts`（18 个服务键 + 4 个原有事件键唯一定义处；4 个新增生命周期键在 `plugin/hook-events.ts`，由它 re-export）
- **声明式钩子（ZCode 兼容）**：契约 `core/src/plugin/hook-contract.ts`（7 事件、`process`/`command` 两种定义、stdin/stdout 与 matcher 形状）、校验 `hook-schema.ts`、语义 `hook-output.ts`（`processHookOutput` + `mergeHookRunResult` + `exitCodeBlockOutput`，移植自 ZCode `core/src/hooks/output.ts`，Apache-2.0）、执行 `plugins/src/hook-run.ts`（spawn/变量表/transcript/超时/截断）、桥接 `plugins/src/hook-bridge.ts`（7 事件 → 容器事件键，聚合而非首赢）。配置两个入口：`~/.nova/config.json` 的 `hooks` 段（**默认关，必须 `enabled: true`**）与插件包的 `hooks/hooks.json`
- **插件包（ZCode 目录格式）**：`plugins/src/pack-loader.ts`（`.zcode-plugin`/`.claude-plugin`/`.nova-plugin` 的 `plugin.json` + `skills/` + `commands/` + `hooks/`，所有声明路径 `resolveInside` 限制在包内）、`pack-install.ts`（三级发现 + `plugins.entries` 里 `pack:<name>` 行开关）、`packs/`（随产品发行；格式、开关与默认值见 `packs/README.md`）
- **内置工具集**：`packages/plugins/src/builtin/`（`fs.ts`, `bash.ts`, `search.ts` 等）
- **桌面传输与帧协议**：`packages/web/src/desktop-host.ts`（装配 + stdio 管道）、`packages/web/src/pipe.ts`（行分帧 + 尺寸豁免）、`packages/web/src/controller.ts`（内核 ↔ 帧）
- **帧协议形状**：`packages/web/src/protocol.ts`（导出面）、`client-frames.ts` / `server-frames.ts`（两个方向）、`client-frame.ts`（不可信入站校验）、`wire-limits.ts`（全部上限）
- **桌面壳**：`apps/tauri-bench/src-tauri/src/lib.rs`（spawn / 行泵 / `nova_send` / `nova_ready` / stdin EOF 退出）。这是**唯一**的桌面壳：Rust 只做窗口与进程管道，界面代码一律 TypeScript（与 ZCode 的 Electron/TS 前端同一语言）。原 WinUI 3 C# 壳已删，勿再引入第二套原生壳
- **DesktopUI 状态与 Reducer**：`packages/web/ui/src/state.ts`（公共入口，re-export）+ `packages/web/ui/src/state/`（`types` / `initial` / `actions` / `reduce` / `ready` 五片，按职责拆）、`packages/web/ui/src/state-events.ts`；`packages/web/ui/src/client/`（8 文件：connection / model / protocol / messages / runs / approvals / requests / sessions）
- **DesktopUI 原语与控件层**：`packages/web/ui/src/components/ui/`（shadcn 风格 **chat 专用**原语：Bubble/Message/Attachment/Marker/Button/MessageScroller；**不是通用原语层，没有 dialog/input/select**）、`packages/web/ui/src/kit/`（跨页控件 Dialog/Button/IconButton——新弹窗必须组合 `kit/Dialog` + `shell/modal-layer`）；原 `src/ui/`（Aceternity 装饰层）已删除，勿再引入
- **A2UI**：协议形状与校验唯一定义在 `packages/core/src/a2ui.ts`（fail-closed 第一道门）；工具 `render_ui` 在 `packages/plugins/src/builtin/ui.ts`；渲染器在 `packages/web/ui/src/a2ui/`（`A2uiView.tsx` = 官方 processor + `A2uiSurface`，`action-context.tsx` 动作回传）。**2026-11-22 起改用官方 `@a2ui/react` / `@a2ui/web_core` 0.15.0（打包增量约 1.05 MB）**：自研折叠/绑定层已删——BASIC catalog 的 18 个组件与输入绑定由官方 lit 组件提供，样式经 `A2uiView.module.css` 把 `--a2ui-*` 全映射到 `--nova-*`，`.a2ui-dark` / `.a2ui-light` 随 `useTheme` 切换。喂入前只做两处边界归一（version → `'1.0'`、缺省 `catalogId` → `basicCatalog.id`），消息形状不动；官方 zod 校验是第二道门，任一道拒绝即整卡不渲染。动作载荷保留协议的 `surfaceId` / `sourceComponentId` / `timestamp` / `context` 与 `sendDataModel` 回传，经 prompt 帧作为下一条用户消息入队。**真机测出的三条硬规则由 core 在自己那道门里拦（都比官方 zod 报得更清楚，不再靠渲染层兜）**：① 必须先 `createSurface` 才能 `updateComponents` / `updateDataModel`（否则官方抛 `Surface not found for message: <id>` 整批作废）；② `Button.action` 是 `{event:{name,...}}` / `{functionCall:{...}}` 的封闭联合，`event.name` 必填（缺了官方只会说 `Unrecognized key(s) in object: 'event'`）；③ v1.0 绑定写 `{"@path":"/x"}`，`{"path":"/x"}` 是 v0.9 拼写，官方 schema 的 union 两者都收但渲染器只解 `@path`，于是静默画成 `[object Object]`——工具描述与示例必须同步用 `@path`，否则等于在教模型出错
- **DesktopUI 右栏**：`packages/web/ui/src/rightbar/`（22 文件，只有**文件目录 + 文件预览**：`TreeDock` / `FilesView` / `FileTabView` + `files-model` / `editor-model` / `strip-state` / `git-marks`）
- **DesktopUI 规格**：`packages/web/ui/DESIGN.md`（唯一 UI 规格入口；token 表由 `scripts/ui-token-doc.mjs` 生成）
- **DesktopUI token 桥**：`packages/web/ui/src/tailwind.css`（shadcn 语义色全部指向 `--nova-*`，`dark:` 变体绑定 `body[data-nova-dark]`；这里一旦写死颜色，两层组件就会分叉）
- **CLI 装配与 Surface 分发**：`packages/cli/src/kernel-boot.ts`、`packages/cli/src/surfaces.ts`

---

## 5. 测试与提交流程纪律

1. **测试隔离**：测试均已配置隔离至临时目录，严禁在测试用例中操作真实 `~/.nova/` 目录。
2. **测试策略控制**：
   - 针对具体修改，编写最简的输入输出断言。
   - UI 测试车道严禁引入重量级 DOM 或浏览器环境，保持纯函数/静态标记检验。
3. **测试规模基线（2026-11-22 通用化后）**：仓库现有 **96 个测试文件 / 1,201 个用例**（11-20 精简前为 210 文件 / 6,176 断言；精简后 106/1,287，桌面化删掉 8 个针对已删除 HTTP/WS 传输层的文件，通用化再删掉右栏变更/任务/终端页的模型测试）。**这是上限，不是起点**——新测试必须先证明它保护的是现有测试覆盖不到的不变量。这是文档纪律，不是机器门禁（`test-boundary.mjs` 只管测试放哪，不数数量）。
   - **保留的是契约与安全边界**：审批解析、不可信输入嗅探、session 隔离、run 生命周期、权限矩阵、协议帧校验、三道 UI 守卫（style/motion/palette）、`client-pure`（断言 client 不 import React）。
   - **已删除的是纯渲染/纯文案/纯 UI 几何**：markdown 解析细节、composer 文本处理、settings 各 section 的快照式断言、rightbar 折叠模型等。需要时从 git 历史取回。
   - **不要因为「测试看着少了」就补回去**。删掉的每一类都在提交信息里记了名。
4. **行数超阈值处理**：
   - 只有单文件超过 **600 行**才会红。低于阈值的文件不进入任何账本，也不需要任何同步动作。
   - 确需突破时（如新工具集天然就大）运行 `pnpm gates:update` 把文件放进豁免表；豁免只能缩，不能再涨。
   - **不要为了压行数而拆文件**：拆分的唯一正当理由是职责边界，不是行数。
5. **文档精简（2026-11-20，2026-11-21 增补 UI 规格）**：文档只保留 **5 份**——本文件、`README.md`、`docs/NOVA-GENERALIST.md`、`docs/NOVA-BOUNDARIES.md`、`packages/web/ui/DESIGN.md`（包级 UI 规格）。八份历史文档已删（0.5.0 总纲 / 设计系统 / UI 架构 / Windows 纲领 / 测试纪律 / dsh 对账 / 两份审计留档）。
   - 恢复方式：`git show <commit>:docs/<name>.md`，或本地 `.docs-archive/`（已 gitignore，含删除前的工作区版本）。
   - **新文档的准入判据**：它必须回答一个**当前机制**问题且无法并入这 5 份之一；优先放包级（如 `packages/web/ui/DESIGN.md`）而不是顶层。历史、计划、审计过程一律不进仓库——那是提交信息与 git 历史的职责。