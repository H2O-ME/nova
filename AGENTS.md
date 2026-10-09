# AGENTS.md — NovaAgent

> 本文件是仓库的**唯一权威文档与 Agent 行为守则**[cite: 1]。`README.md` 只是门面页[cite: 1]。**机制变了就改这里**[cite: 1]。

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
5. **行数预算即时控制**：
   - 编写代码前必须评估目标文件是否接近上限；如需拆分，应就地提取同级纯函数文件，杜绝整块写完后再耗时返工。

---

## 1. 项目概览

自研、插件化、轻量化的跨平台本地 agent 运行时：在**当前工作目录**运行，通过任意 OpenAI 兼容端点对接模型，以「一切皆插件」的内核统一扩展工具、斜杠命令、钩子、Skills 与能力服务；界面只是同一内核事件流的消费者[cite: 1]。所有数据集中在 `~/.nova/`，**工作区目录零写入**[cite: 1]。

- **运行时**：Node.js ≥ 20；PTC 代码模式要求 ≥ 22.19（`stripTypeScriptTypes`）[cite: 1]。
- **工具链**：TypeScript（strict，`noUncheckedIndexedAccess`）、ESM-only；构建 `tsdown`、测试 `vitest`、lint `oxlint`、包管理 pnpm[cite: 1]。无 prettier[cite: 1]。
- **跨平台**：Linux / Windows 兼容（macOS 顺带兼容）[cite: 1]。路径一律 `node:path` + 抽象层，**禁止硬编码 `/` 或 `\`**[cite: 1]。

---

## 文档索引（细则不在本文件，按任务只读相关的那一份）

| 文档 | 何时读 |
| --- | --- |
| `docs/NOVA-GENERALIST.md` | **通用化纲领**：定位、执行契约、批次表（G 系列）、每批开工条件与删除判据 |
| `docs/NOVA-0.5.0-REFACTOR.md` | 历史总纲：命令语义（§4）、git 纪律（§5）、测试表述纪律（§6）、Scope Protocol（§12）——其批次表**已被通用化纲领取代** |
| `docs/NOVA-BOUNDARIES.md` | 改动跨包依赖、插件边界、测试边界时 |
| `docs/NOVA-UI-ARCHITECTURE.md` | 改动 WebUI 结构、Client Model、Slot 时 |
| `docs/NOVA-DESIGN-SYSTEM.md` | 改动视觉、token、动效、间距时 |
| `docs/NOVA-TESTING.md` | 新增或删除测试时 |
| `docs/dsh-parity-inventory.md` | **历史参照（非验收口径）**：迁移期查询"哪些 UI 是移植来的" |

> **重构期测试纪律例外**：§0.4「拒绝过度测试」持续有效；重构批次的验收以 `docs/NOVA-GENERALIST.md` §6 各批「验收」段为准，两者冲突时以后者为准。

---

## 2. 常用命令矩阵

| 命令 | 适用场景 / 说明 | 耗时/开销 |
| --- | --- | --- |
| `pnpm check` | **开发快环（首选）**：lint + gates + `--changed` 增量测试[cite: 1] | 快 |
| `pnpm vitest run <path>` | **单文件精准验证**：开发时只跑对应测试文件 | 极快 |
| `pnpm typecheck` | 逐包类型检查（改了 core/plugins 后要先 build 才能查上层）[cite: 1] | 中 |
| `pnpm gates` | 结构棘轮：依赖方向白名单 + 逐文件行数上限[cite: 1] | 快 |
| `pnpm gates:update` | 同步行数上限（仅在确需增行时执行）[cite: 1] | 快 |
| `pnpm dev` | tsx 直跑 cli 源码（免构建调试）[cite: 1] | - |
| `pnpm build` | 全量构建（修改底层包且需要 dist 验证时）[cite: 1] | 较慢 |
| `pnpm verify` | **全环封板验收**：build + typecheck + test + gates（仅在任务交付时使用）[cite: 1] | 慢 |

> ⚠️️ 运行 `pnpm nova` 跑的是 `packages/cli/dist`[cite: 1]。本地开发调试一律优先使用 `pnpm dev`[cite: 1]。

---

## 3. 架构白名单与核心约束

### 依赖方向白名单（严格遵守，严禁跨层引入）[cite: 1]
`dep-direction.mjs` 静态扫描源码文本，名单之外引入即报错中断[cite: 1]：
- `core`: `[]`（绝对底层，零上游依赖）[cite: 1]
- `ai`: `[core]`[cite: 1]
- `plugin-subagent` / `plugin-context` / `plugin-ptc`: `[core]`[cite: 1]
- `plugins`: `[core, plugin-subagent, plugin-context, plugin-ptc]`[cite: 1]
- `web`: `[core, plugins, plugin-context]`（绝不能引入 `cli`）[cite: 1]
- `qqbot`: `[core, plugins]`[cite: 1]
- `cli`: `[plugins, ai, core, qqbot, web]`[cite: 1]

### 核心设计不变量（遵循既有设计，禁止自行扩展）
1. **单一事实来源**[cite: 1]：
   - 审批答案解析：唯一定义在 `core/approval.ts: parseAskResult`[cite: 1]。
   - 文本控制字符清洗：唯一定义在 `core/src/text.ts: oneLineText / hasControlChars`[cite: 1]。
   - 呈现意图形状：唯一定义在 `core/presentation.ts`，视图卡片解析只走 `callViewOf` / `resultViewOf`[cite: 1]。
   - 工具缺失结果补齐：唯一定义在 `session/session-repair.ts: missingToolResults`[cite: 1]。
2. **容器与插件规范**：
   - 注册工具统一用 `registerTool(ctx, def, permission)`，注册命令用 `registerCommand(ctx, def)`[cite: 1]。
   - 插件故障记录在状态 `error` 中，绝不从 `create/update/reconcile` 中抛出未处理异常崩溃主进程[cite: 1]。
3. **会话日志 v2（不可变事件流）**[cite: 1]：
   - 模型可见性与日志强绑定：`Session.appendEvent` 是单文件唯一写入者，严禁直接使用底层 fs 追加[cite: 1]。
   - 动态上下文注入一律追加在会话首条 user 消息（`<user_instructions>` 片段），保证前缀稳定提升缓存命中率[cite: 1]。
4. **权限与审批**[cite: 1]：
   - 审批档位与记忆按会话隔离（每会话独立）；唯有 `approvalPolicy`（`ask` / `never`）为进程级状态[cite: 1]。

---

## 4. 关键文件索引（定位修改直接切入）

- **Agent 循环与内核状态机**：`packages/core/src/agent/`、`packages/core/src/kernel/session.ts`[cite: 1]
- **容器与核心能力键**：`packages/core/src/plugin/capabilities.ts`（18 个服务键唯一定义处）[cite: 1]
- **内置工具集**：`packages/plugins/src/builtin/`（`fs.ts`, `bash.ts`, `search.ts` 等）[cite: 1]
- **Web 服务端与帧协议**：`packages/web/src/controller.ts`、`packages/web/src/server.ts`[cite: 1]
- **WebUI 状态与 Reducer**：`packages/web/ui/src/state.ts`、`packages/web/ui/src/state-events.ts`[cite: 1]
- **CLI 装配与 Surface 分发**：`packages/cli/src/kernel-boot.ts`、`packages/cli/src/surfaces.ts`[cite: 1]

---

## 5. 测试与提交流程纪律

1. **测试隔离**：测试均已配置隔离至临时目录，严禁在测试用例中操作真实 `~/.nova/` 目录[cite: 1]。
2. **测试策略控制**：
   - 针对具体修改，编写最简的输入输出断言[cite: 1]。
   - UI 测试车道严禁引入重量级 DOM 或浏览器环境，保持纯函数/静态标记检验[cite: 1]。
3. **行数预算超限处理**：
   - 若功能变动导致文件超出预设行数上限，应优先就地拆分纯函数模块；若确属合理增量，运行 `pnpm gates:update <文件名>` 同步指标[cite: 1]。