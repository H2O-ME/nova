# NOVA 通用化纲领

> **文档状态**：Normative（G0a 决策冻结）
> **本文件回答**：Nova 的定位是什么、通用化的执行契约是什么、哪些批次要做、每批开工的前置条件是什么。
> **权威关系**：本文件的**批次表取代** `NOVA-0.5.0-REFACTOR.md` §7 的批次表地位；后者降级为历史记录，其未完成批次已映射进本文件 §5。其余细则分工不变：依赖边界见 `NOVA-BOUNDARIES.md`、UI 结构见 `NOVA-UI-ARCHITECTURE.md`、视觉见 `NOVA-DESIGN-SYSTEM.md`、测试见 `NOVA-TESTING.md`。
> **执行纪律**：`NOVA-0.5.0-REFACTOR.md` §4–§6（命令语义、git 纪律、测试表述纪律）与 §12（Scope Protocol）**继续有效**，本文件不重复。

---

## 0. 核心目标

> **不是让 Nova 看起来不像编程 Agent，而是让编程成为 Nova 可以可靠执行的一类任务，而不再成为它组织整个产品的默认假设。**

这句话是本纲领全部裁决的判据。任何改动若无法回答"它是否让编程从默认假设降为可选能力之一"，就不属于本纲领范围。

## 1. 定位

```text
Nova = 通用型本地 agent 工作台

不是：AI 聊天应用
不是：编程专用 IDE
不是：DeepSeek Harness 的复刻
是：  在当前工作目录运行的通用任务 agent —— 写作、研究、数据、日常自动化、编程都在范围内
```

### 1.1 保留（通用能力，不动）

| 资产 | 为什么保留 |
| --- | --- |
| 工作区（workspace） | 它回答"在哪干活"，不是"代码库"。目录浏览、目录选择、会话工作区都属于它 |
| `bash` / `fs` / `search` 工具 | 读写文件与执行命令是通用任务的地基，不是编程专属 |
| 会话 / 审批 / 权限 / 插件 / Skills 内核 | 已经是 provider-agnostic 的通用容器（18 服务键 + 4 事件键） |
| 多模态附件（images / image-store / image-projection） | 通用能力，见 §3.2 |
| 多 surface（Web / TUI / REPL / exec / QQ） | 同一内核事件流的不同消费者，地位平等 |

### 1.2 降级（编程特化，从默认假设变为可选能力）

| 资产 | 从 | 到 |
| --- | --- | --- |
| Git 变更面板（右栏"变更"页） | 常驻界面 + 内核假设 | 可选 UI；底层能力保留 |
| 文件树面板、常驻终端、任务面板 | 常驻右栏四页 | 按需入口（见 §6 G5/G6） |
| `system-prompt` 的 persona | "local coding agent" | 通用 agent（见 §6 G0b） |
| `--dsw-*` 视觉底座 | 新代码的过渡契约 | 迁移完成后删除（见 §6 G7a） |

## 2. 执行契约（P0）

### 2.1 不新增抽象层

> **不新增 Task / Run / Artifact 抽象层。**

通用任务共享的执行契约就是**现有契约**：

```text
Session → runAgent → ToolCall → Approval → Persistence
```

加上 `NOVA-0.5.0-REFACTOR.md` §8 Batch 2 已经规定的 `Run` + `ExecutionScope`。

**通用化改变的是 persona 与能力装配，不是执行模型。** 判据：任何"为了让 Nova 更通用"而新增的实体类型，必须先证明现有契约无法表达；否则不立项。

### 2.2 保留 0.5.0 已规定的 Run 与 ExecutionScope

"不新增抽象层"**不豁免**已有契约。`Run` 生命周期（`created → running → cancelling → completed / failed / cancelled`）与 `ExecutionScope`（Run 创建时冻结）按 0.5.0 原文执行。字段集**逐字段接入**：0.5.0 列的八字段是**目标契约**，不是一次到位的实现清单——每个字段落地时同批带生产者与消费者（见 §6 G1b 修订）。

### 2.3 现状证据（G0a 源码核对）

| 契约点 | 现状 | 判据 |
| --- | --- | --- |
| `runAgent` | `packages/core/src/agent/loop.ts:29`；`runId` 在 `AgentOptions` 中**可选**，未设时由 loop **自铸**（`loop.ts:35`） | 0.5.0 Batch 2A 的"临时 runId"判据**成立** |
| `ToolCallScope` | `packages/core/src/agent/tools.ts:154` **现场拼装** `{...}` | Batch 2A 的"每 tool call 现场拼 scope"判据**成立** |
| 能力容器 | `packages/core/src/plugin/capabilities.ts`：**18 个服务键 + 4 个事件键**（`beforeLlmCall` / `beforeToolCall` / `afterToolResult` / `beforeTurnEnd`） | 通用容器**已经成立**，通用化不需要新建容器 |

## 3. 决策裁决

### 3.1 旧规范 × 新方向的冲突（10 项）

| # | 旧规范 | 新方向 | 处置 |
| --- | --- | --- | --- |
| 1 | `NOVA-UI-ARCHITECTURE.md` §1 "Nova 是 Agent Development Workspace" | 通用型工作台 | 改写（G0b） |
| 2 | `NOVA-UI-ARCHITECTURE.md` §6.2 "Nova 是 Coding Agent，Tool UI 更重要" | 通用型 | 改写（G0b） |
| 3 | `NOVA-UI-ARCHITECTURE.md` §2 三栏含 **Inspector** 为硬约束 | 取消常驻 Inspector | 改写布局规范（G5/G6） |
| 4 | `NOVA-UI-ARCHITECTURE.md` §5 7 个 Slot 白名单 | 需重定集合 | 重定（G6） |
| 5 | `NOVA-DESIGN-SYSTEM.md` §7 `--dsw-*` 在 Batch 10 删除 | 提前到视觉批 | 迁移顺序变更（G7a） |
| 6 | `NOVA-0.5.0-REFACTOR.md` §7 Batch 0–10 | 重编为 G 系列 | 批次重编（本文件 §5） |
| 7 | `nova-dev` 技能 §三.1 "**对齐 dsh，不要自创**" | 脱离 dsh | 纪律作废（G0b） |
| 8 | `dsh-parity-inventory.md` = 验收口径 | 历史参照 | 降级（G0a，本批） |
| 9 | `packages/plugins/src/system-prompt.ts:16` "local coding agent" | 通用型 | 改写（G0b） |
| 10 | `NOVA-0.5.0-REFACTOR.md` §7 Batch 2/3/5 阻塞于在途批 | 在途批已提交 | 状态更新（本文件 §7） |

**保持不变**：Run / ExecutionScope / Protocol / Session / Client Model 的全部契约；`NOVA-BOUNDARIES.md` 的依赖白名单与四条边界规则；`NOVA-TESTING.md` 的全部纪律；`NOVA-DESIGN-SYSTEM.md` 的视觉方向（Quiet / Dense / Precise / Neutral + 小圆角 + 无阴影 + opacity/transform-only 动效）。

### 3.2 core 能力归属（G3 的输入，**已修正审计的过度概括**）

`docs/architecture-audit-2026-10.md` §2 称 core "还包含 git/clone、目录浏览、图片存储、subagent 工具实现等产品能力"。G0a 逐项核对消费者后**修正**：

| 能力 | 真实消费者 | 判定 |
| --- | --- | --- |
| `images` / `image-store` / `image-projection` | `core/src/types.ts:1`、`kernel/session.ts:26`、`agent/request.ts:5` | **通用**（多模态附件）→ 留 core |
| `directory-*` / `file-listing*` | `file-io.ts:15`、`directory-listing.ts:34` | **通用**（工作区目录机制）→ 留 core |
| `session-workspace` / `session-title` | `kernel/session.ts:39`、`kernel/title.ts:16` | **通用** → 留 core |
| `git` / `git-clone` | `web/src/git-frames.ts:27`（变更面板）、`web/src/session-frames.ts:98`（**从 URL 克隆建会话**） | **编程特化** → 按 §3.3 细分 |

> 结论：**真正编程特化的只有 git。** 图片、目录浏览、会话标题/工作区都是通用能力，不属于"混入的产品能力"。

### 3.3 Git 的细分归属（拍板）

| 能力 | 归属 | 理由 |
| --- | --- | --- |
| `gitClone` | **暂留 core** | 当前用于创建工作区并衔接会话切换（`session-frames.ts:98` 克隆后切工作区、刷新会话列表）。通用的是"创建工作区"的需求，Git 只是实现方式之一 |
| `git_status` / `git_diff` / `git_log` | **编程专用能力** | 主要服务于源码变更检查与版本历史 |
| `git_stage` / `git_unstage` / `git_commit` | **编程专用能力** | 修改 Git 索引或创建提交，有独立的权限与操作语义 |
| Git 变更面板（右栏"变更"页） | **可选 UI** | 不应成为通用 Agent 主界面的常驻区域 |

**边界强调**：`gitClone` 留在 core，**不代表**整个 Git 子系统都留在 core。但 **G3 不得直接搬迁实现**——那会牵动依赖白名单、插件注册与现有消费者。**G3 先完成 ownership 审计，再决定是否拆包**；"编程能力包化"不是预设的必做重写任务。

#### G3 ownership 审计（2026-10-10 现算，事实陈述，不含搬迁）

| 事实 | 证据 |
| --- | --- |
| **git 不是模型可用的工具** | `packages/plugins/src/builtin/` 的工具清单里没有 `git_*`；全仓唯一的 `git_status` / `git_diff` / … 名字出现在 `web/src/client-frames.ts:315-333`、`web/src/frame-router.ts:118-137` —— 它们是**客户端帧**，不是工具定义 |
| `core/src/git.ts`（229 行，8 个导出）与 `core/src/git-clone.ts`（52 行）的消费者**只有 `web`** | `web/src/git-frames.ts:27`、`web/src/session-frames.ts:13`；`ai` / `plugins` / `plugin-*` / `qqbot` / `cli` **零引用** |
| 两者是**一体**，不能只搬一个 | `core/src/git-clone.ts:10` → `import { git } from './git.js'`（`git()` 是 `git.ts:75` 的 spawn 封装） |
| `git.ts` 存在的**唯一理由**是右栏"变更"页 | 该面板是 §3.4 的删除目标（G6）；`git-clone.ts` 的理由是"从 URL 建会话"（`session-frames.ts:98`） |

**审计结论（供拍板，不预设答案）**：

- `git.ts` 的消费者与 `gitClone` 的消费者**在同一层**（都在 `web`）。既然"G6 删右栏"会让 `git.ts` 失去唯一理由，那么把 `git.ts` **连同** `git-clone.ts` 一起搬进 `web`（`web` 本可自持模块，依赖白名单不受影响），core 就彻底不含编程专用能力——这是与 §1 核心目标最一致的选项。
- 但这与 §3.3 已拍板的"`gitClone` 暂留 core"**冲突**，因为 `git-clone.ts` 依赖 `git.ts` 的 `git()`；只搬一半就会复制一份 spawn 实现（缺陷族 #2）。
- **替代选项**：保留 `git.ts` + `git-clone.ts` 于 core，接受"core 为可选 UI 面板背负编程能力"，并在 §3.3 表里把这条代价写明。
- **无论选哪个，本次不动实现**（遵守"审计结论出来前不做任何搬迁"）。

### 3.4 rightbar 删除代价（G6 的输入，量化）

| 项 | 数量 | 明细 |
| --- | --- | --- |
| UI 源文件 | **40** | `packages/web/ui/src/rightbar/` 全部 |
| UI 引用者 | **7** | `state.ts`、`state-events.ts`、`App.tsx`、`AppFrame.tsx`、`columns.ts`、`layout-store.ts`、`shell/copy.ts` |
| UI 测试 | **14** | `rightbar-{changes,files,layout,panel,tabs,tree}`、`tasks-model`、`terminal-model`、`terminal-shell`、`change-tree`、`git-diff-rows`、`diff-{highlight,lines,view}` |
| web 测试 | **2** | `rightbar-frames.test.ts`、`term-session.test.ts` |
| 承载能力 | 4 | 变更（git frames）/ 文件（fs frames）/ 任务（job frames）/ 终端（term frames + PTY） |

> **删除只能是 UI 层目标。** 协议帧、`frame-router.ts`、`term-session.ts`、`job-session-ownership`、`gitClone` 后端能力**一律不动**。

### 3.5 视觉现状（G7a 的输入）

| 项 | 数值 |
| --- | --- |
| UI 源文件 / 行数 | 240 / 34,902 |
| `*.module.css` | 89 |
| 引用 `--dsw-*` 的 CSS 文件 | **95** |
| 引用 `--nova-*` 的 CSS 文件 | **12** |
| 头部含 "deepseek-harness" 的 UI 源文件 | **149 / 240** |
| token 基线（spacing / radius / shadow / duration / ease） | 767 / 82 / 12 / 129 / 111 |

> 迁移远未完成：95 个文件仍在 `--dsw-*` 上，只有 12 个用 `--nova-*`。**G7a 的删除判据必须以此为准，不得按批次编号机械删除。**

## 4. 批准范围声明

> **批准产品方向 ≠ 批准所有实现顺序。**

本纲领的定位、执行契约、归属划分与批次划分**已获批准**，可作为裁决依据。但：

- 每一批**开工前**仍须完成依赖核对与文件所有权核对（`NOVA-0.5.0-REFACTOR.md` §12 Scope Protocol）；
- **有条件通过的批次**（G6 / G7a / G7b）必须满足 §6 各自列出的开工判据，未满足不开工；
- 本文件中的任何**依赖清单不得作为开工依据**——它会过期，须在开工当天现算。

## 5. 批次表

```text
G0a 决策冻结     本纲领 + 旧规范权威关系 + 依赖审查 + 批次映射      ← 只改文档（已完成）
G0b 定位落地     system-prompt.ts persona + 产品文案同步            ← 已完成 f800c21
G1  Runtime 所有权 Run + ExecutionScope + Protocol                  ← 实现部分已完成（G1a+G1b）；G1c'/G1d 消费者门控
G2  Session 所有权 repository/writer/projection/repair + 删除序列    ← 0.5.0 Batch 5 原契约
G3  能力归位     ownership 审计已完成（§3.3 审计补充）；是否搬迁待拍板 ← 0.5.0 Batch 4 剩余；不预设重写
G4  Client Model ui/src/client/ React-free + App.tsx 拆分            ← 0.5.0 Batch 6 原契约
G5  UI 原型验证  方案 A：Conversation 主舞台 + 按需抽屉 + 内联结果卡   ← 不改协议/Runtime；可与 G1–G4 并行
G6  形态重构     删常驻 rightbar                                    ← 有条件通过
G7a 视觉自研     --dsw-* → --nova-*；删 design-platform.css         ← 有条件通过
G7b 测试与清理   按域重组                                           ← 有条件通过
G8  封板         版本 + changeset + verify + smoke
```

**与 0.5.0 的映射**：G1←Batch 2/3、G2←Batch 5、G3←Batch 4 剩余、G4←Batch 6、G6←Batch 7B（改造）、G7a←Batch 7A/8/10、G7b←Batch 9、G8←Batch 10 收尾。0.5.0 的 Batch 0/1/4 已交付并封板，**不重开**。

**依赖顺序**：G0a → G0b → G1 → G2 → G3 → G4 → G6 → G7a → G7b → G8。**G5 可与 G1–G4 并行**（它不改协议与执行语义），但 G6 依赖 G5 的结论。

## 6. 各批五段式

每批交付时必须同时列出：**新增 / 改 / 删除 / 不可改变 / 验收**。以下是各批的判据要点，实施细节在开工当天按 Scope Protocol 补齐。

### G0a — 决策冻结（本批）

- **新增**：本文件；`AGENTS.md` 文档索引段。
- **改**：`NOVA-0.5.0-REFACTOR.md` 头部权威关系标注；`dsh-parity-inventory.md` 头部降级标注；`NOVA-UI-ARCHITECTURE.md` §1/§6.2 待改写标注。
- **删除**：无。
- **不可改变**：任何代码；`NOVA-BOUNDARIES.md` / `NOVA-TESTING.md` / `NOVA-DESIGN-SYSTEM.md` 正文。
- **验收**：五份文档 diff 仅含文档；`pnpm check` 绿（无代码改动，门禁不应变化）。

### G0b — 定位落地

- **新增**：无（persona 是改写，不是新增）。
- **改**：`packages/plugins/src/system-prompt.ts` persona（去 "coding agent" 身份，保留工具使用规则）；`NOVA-UI-ARCHITECTURE.md` §1/§6.2 正文；`nova-dev` 技能 §三.1 纪律；`README.md` 定位段。
- **删除**：persona 中的编程专属假设（如把"工作区 = 代码库"的措辞）。
- **不可改变**：工具执行语义、审批与权限行为、插件行为、prompt 前缀的字节稳定性（`<user_instructions>` / `<project_docs>` 注入机制不动）。
- **验收**：现有 agent/kernel 测试全绿；**明确验证 persona 改动不影响工具执行、审批与插件行为**；快环绿。

### G1 — Runtime 所有权

- **契约**：**严格继承** `NOVA-0.5.0-REFACTOR.md` §8 Batch 2/3 原文，不削弱：Run 生命周期、ExecutionScope 创建时冻结、`RunContext = { scope, signal }`、`PROTOCOL_VERSION` + 帧级 `eventId` + 帧级 `runId`、握手校验。
- **删除**：`runAgent` 内临时 runId（`loop.ts:35`）；每 tool call 现场拼 scope（`tools.ts:154`）；kernel 级可变 model 依赖；各消费者对 `AgentStatus` 的近似终态判断。
- **不可改变**：Provider HTTP/SSE 行为；Tool 执行语义；Session 持久化格式；Web UI 布局；插件公开 API。
- **验收**：`packages/web/test/session-midrun-switch.test.ts` 保护的"中途切换不改变在跑的 Run"仍然成立。
- **开工前置**：开工当天重算 `session.ts` / `protocol.ts` / model state 的实际依赖，**不得引用任何过期清单**。

#### G1 开工前核对（2026-10-10，现算）

**① Current ownership**

| 项 | 现状 | 位置 |
| --- | --- | --- |
| `ExecutionScope` | **已存在**，3 字段 `sessionId?` / `runId?` / `principal?`，全部可选 | `core/src/types.ts:431` |
| `ToolCallScope` | `extends ExecutionScope`，纯别名 | `core/src/types.ts:418` |
| scope 生产 | 从 `AgentOptions` 三字段**投影**（不是"现场拼"） | `core/src/agent/tools.ts:154` |
| `runId` 生产 | `runAgent` 未设时**自铸** | `core/src/agent/loop.ts:35` |
| `runId` 消费 | **零** —— 全仓（core/web/cli/qqbot/plugins）无读取者 | 见下 |
| `AgentStatus` | `'idle' \| 'running' \| 'compacting'`，**非** 0.5.0 期望的六态生命周期 | `core/src/kernel/session.ts:142` |
| Protocol | 无 `PROTOCOL_VERSION` / `eventId` / 帧级 `runId` | `web/src/protocol.ts` |

**② Target ownership**：0.5.0 Batch 2/3 原文（`Run` 实体 + 六态生命周期；`ExecutionScope` 八字段为目标契约、逐字段接入；Run 创建时冻结；`RunContext = { scope, signal }`）。八字段的逐字段判据见下方 **G1b 修订**。

**③ Current dependencies**：`ExecutionScope` 消费者 = `core/{approval, agent/tools, tools/nested-run, plugin/capabilities, kernel/session}` + `plugins/{hooks, permission-gate}`。`runId` 消费者 = **无**。`anchoredRunStats` 的 key 是 `afterMessageId`（**消息 id**，`session-projection.ts:29`），**不是** runId。

**④ Target dependencies**：③ + Run 的消费者（`run/stats` 带 runId、surface 的状态显示走 Run 生命周期）。

**⑤ Forbidden**：0.5.0 Batch 4 已封板结论；Provider HTTP/SSE、Tool 执行语义、Session 持久化格式、Web UI 布局、插件公开 API。

**核对结论（两条，均改变 G1 的范围判断）**

1. **scope 已显式贯穿**（有 `.changeset/execution-scope-threading.md` 为证）→ 0.5.0 描述的"每 tool call 现场拼 3 字段"**已部分完成**，G1 的删除目标缩小为"由 `Run` 提供而非 `AgentOptions` 投影"。
2. **`runId` 只写不读** → 若只建 `Run` 实体而不建消费者，就是**复制本仓高频缺陷族 #3**（`nova-dev` 技能 §三.4）。**G1 必须"实体 + 消费者"同批做**，这与 0.5.0 §7「不单独提前，提前做只会得到没人读的代码」是同一判据。

**G1 拆分（建议，按可独立提交单元）**

```text
G1a  Run 实体 + 六态生命周期（core/src/runtime/run.ts）                                  ✅ 425fb71
G1b  scope 所有权归位：Run 冻结 ExecutionScope；AgentOptions 三扁平字段 → scope?           ✅ d89a0ea
G1c  surface 状态走 Run 生命周期                                                          ✅ 随 G1a 达成
G1c' run/stats 带 runId                                                                   ⏸ 消费者门控
G1d  Protocol Contract：PROTOCOL_VERSION + 帧级 eventId + 帧级 runId + 握手校验            ⏸ 消费者门控
```

> **G1 实现部分已收口**（G1a + G1b）。G1c'/G1d 的现算消费者为空，判据与理由见下方"G1c / G1d 收口"。

> **G1a 不得单独提交**——它必须与 G1c 的至少一条真实消费者同时落地，否则 `runId` 从"零消费"变成"新字段零消费"，缺陷只是换了个名字。

#### G1b 修订（2026-10-10，按源码证据取消"扩八字段"）

0.5.0 §8 Batch 2 把 `ExecutionScope` 定为八字段（`sessionId / runId / parentRunId / principal / channel / workspace / provider / permissions`）。开工前现算显示，**照此扩字段会一次制造 5 个无人读的死字段**，正是本仓缺陷族 #3：

| 字段 | 生产者 | 消费者 | 判定 |
| --- | --- | --- | --- |
| `sessionId` | `kernel/session.ts`（Run 创建时） | `plugins/permission-gate.ts`（唯一读点） | 保留 |
| `runId` | `kernel/session.ts`（Run 创建时） | **无**（仅 `subagent-scope.test.ts` 断言） | 保留，消费者在 G1d 落地 |
| `principal` | **无** —— 全仓无人给 `AgentOptions.principal` 赋值 | **无** | 保留为**声明契约**（见下） |
| `parentRunId` / `channel` / `workspace` / `provider` / `permissions` | 无 | 无 | **本次不新增** |

`principal` 的设计用途（让 QQ 中继会话按"随调用者走的主体"钳制档位）在当前通道**不存在**：`qqbot/src/peers.ts:454 capOwnedTier` 改用**会话创建时钳制**达成同一目的，而 `peers.ts:451` 自己写明中继路径"does not have yet"这个主体。按 `NOVA-GENERALIST.md` §2 的"契约进 Core ≠ 实现进 Core"，它**留作声明契约**，不删；将来 QQ 中继接通时**必须与生产者同批**加回消费者，否则按缺陷族 #3 删除。

**因此 G1b 的交付改为"所有权归位"，不含字段扩张**：`Run` 在创建时构造并冻结一份 `ExecutionScope`（`Run.scope`），`AgentOptions` 的三个扁平字段合并为 `scope?: ExecutionScope`，`agent/tools.ts` 删除现场投影改为直接读取。字段扩张留给**每个字段各自接入时**同批完成（生产者 + 消费者一起），判据与 G1a/G1c 同一条。

#### G1c / G1d 收口（2026-10-10 现算）：消费者门控，暂缓

G1a（Run 实体）与 G1b（scope 归位）已落地。**G1c 与 G1d 的原定交付内容在现算下都没有消费者**，按本文档 §2.2 与 §6 的同一判据（实体必须与消费者同批）**暂缓**：

| 原定交付 | 现算消费者 | 判定 |
| --- | --- | --- |
| G1c：`run/stats` 带 `runId` | **无** —— 该事件的 6 个消费者（`session-aggregate`、`plugin-context/fold`、`web/{totals,trace,transcript}`、`context-insights`）**全部按 `afterMessageId` 锚定**（`session-projection.ts:24 anchoredRunStats`），没有一处需要"哪个 run" | 暂缓 |
| G1c：surface 状态走 Run 生命周期 | **已达成** —— `cli/src/repl.ts:202` 与 `core/test/kernel.test.ts:137` 已改读 `agent.running` / `agent.compacting`，二者由 `Run` 派生 | 完成 |
| G1d：帧级 `runId` | **无** —— `web/src/trace.ts` 逐事件成行、保持日志顺序，不按 run 分组 | 暂缓 |
| G1d：`PROTOCOL_VERSION` + 握手校验 | **弱** —— `ui/src/stale-build.ts` 已用内容哈希比对解决"旧 bundle 继续跑"（重载一次），且 `server-frames.ts:413 ready.version` 已带构建版本；再引入一条协议版本会与之重叠 | 暂缓 |

**收口判据**：`runId` 的真实消费者在 Nova 出现"同一会话内多个 run 需要被区分"的场景（例如 UI 按 run 归属渲染、或按 run 聚合的统计卡）时才会出现。届时**该场景与 `runId` 消费同批落地**，不提前建字段。

> **本节修正了 G1 的范围**：G1 的实现部分 = G1a + G1b，已完成；G1c/G1d 转入"消费者出现即做"。

### G2 — Session 所有权

- **契约**：继承 0.5.0 Batch 5：`core/src/session/{repository,writer,projection,repair}.ts`；删除序列补 PTY 停止、jobs 前置、await run settle、zombie 防护；12 个 `session-*.ts` 收进 `session/`；KernelEvent 分区（**不删事件、不造 wrapper**）。
- **不可改变**：**日志格式与单一写入者不变量**（`Session.appendEvent` 是唯一写入漏斗）；已持久化会话的可读性。
- **验收**：恶意 JSONL、append after delete、非 current 会话删除不复活日志。

### G3 — 能力归位

- **第一件事**：完成 ownership 审计（§3.2 / §3.3 是输入，不是结论），**在审计结论出来前不做任何搬迁**。
- **允许**：更新 `NOVA-BOUNDARIES.md` §4 的 ownership 表。
- **删除**：仅在审计判定成立时执行，且必须同步依赖白名单与消费者。
- **不可改变**：`NOVA-BOUNDARIES.md` §6 已封板的 Batch 4 结论（不重开）；`gitClone` 的现有行为。
- **验收**：审计结论写进 `NOVA-BOUNDARIES.md`；若拆包，`pnpm gates` 的依赖白名单同步且无消费者断裂。

### G4 — Client Model

- **契约**：继承 0.5.0 Batch 6：`ui/src/client/{connection,model,protocol,sessions,runs,messages,approvals}`；socket 与 reducer 移出 React；`App.tsx` 拆 `app/App.tsx` + `app/AppShell.tsx` + `app/routes/`。
- **删除**：`App.tsx` 内 socket / 业务 state；props drilling；越层值导入（`state-events.ts:10` 值导入服务端 `../../src/totals`）。
- **不可改变**：Runtime 行为、Web 协议语义、视觉设计、Tool 执行。
- **验收**：Client Model 不依赖 React（可断言）；reducer 纯函数测试仍绿。

### G5 — UI 原型验证（**有条件通过**）

- **形态**：**方案 A —— Conversation 主舞台 + 按需工作区抽屉 + 内联结果卡**。变更→`DiffCard`/审批卡内联；文件→`@` 引用或工具入口的按需抽屉；任务→`flow/StatusRows` 内联；终端→输出内联 + 交互式 PTY 按需展开。
- **不做**：**不把抽屉做成新的通用 Inspector**；不改协议；不改 Runtime。
- **必须先回答的 5 个问题**（原型验收）：
  1. 用户能否在不离开对话的情况下查看变更、理解审批内容？
  2. 用户能否快速找到某个文件并引用到当前任务？
  3. 长时间运行的任务是否始终有明确、可发现的状态？
  4. 交互式终端能否处理多轮输入，而不只是显示一次命令输出？
  5. 展开、关闭或切换工作区时，是否会丢失当前任务状态？
- **不可改变**：协议帧、`frame-router`、Runtime、执行语义。
- **验收**：5 个问题各有答案（原型可演示）；结论写进本文件 §6 G6。

### G6 — 形态重构（**有条件通过**）

- **开工判据（未满足不开工）**：
  1. 每项能力已证明有替代入口（§3.4 四页 → G5 结论）；
  2. 14 个 UI 测试 + 2 个 web 测试**逐个**给出迁移或删除理由（见 §4「批准方向 ≠ 批准顺序」）；
  3. 协议帧、`frame-router`、`term-session`、`job-session-ownership`、`gitClone` 后端**确认不动**。
- **删除**：`rightbar/` 40 文件；`App.tsx` 的 rightbar state（`rightbarOpen` / `strip` / `openFileTab` 等）；`AppFrame.tsx` 第三栏几何；`columns.ts` 的 rightbar 轨道求解。
- **不可改变**：协议语义、后端能力、已通过 G5 验证的能力入口。
- **验收**：`pnpm check` 绿；G5 的 5 个问题在新形态下仍成立。

### G7a — 视觉自研（**有条件通过**）

- **开工判据**：**必须确认新 token 与组件已迁移完成**才删 `--dsw-*`——**不得单纯按批次编号删除**。
- **改**：95 个引用 `--dsw-*` 的 CSS 文件逐个迁移到 `--nova-*`；token 基线单调下降。
- **删除**：`styles/design-platform.css`；149 个文件的 "ported from deepseek-harness" 注释头；逐值抄来的几何常量。
- **不可改变**：`NOVA-DESIGN-SYSTEM.md` §2 已冻结的视觉方向；停靠列不画阴影（`style-guard` 已钉住）。
- **验收**：`ui-token-guard` 基线下降；`style-guard` / `motion-guard` 绿；视觉差异以实机量测为证据。

### G7b — 测试与清理（**有条件通过**）

- **判据**：**迁移**行为契约测试，**而不是直接删除所有实现相关测试**。
- **新增**：`core/test-support/`；行为覆盖台账（行为名，不是文件名）。
- **删除**：仅在确认无行为契约损失后，删除 implementation-detail 测试与 obsolete adapter 测试。
- **验收**：`pnpm verify` 绿；删除的每个测试在台账中有对应行为被别处覆盖。

### G8 — 封板

- **改**：`AGENTS.md` 同步到新机制；`changeset` 走版本。
- **验收**：`pnpm verify` + `pnpm smoke:web`；`git diff --stat` 逐条核对是否越界。

## 7. 仓库状态核对（G0a，2026-10-09）

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 分支 / HEAD | `master` / `43fb8af` | `.git/HEAD` → `refs/heads/master`；`.git/refs/heads/master` |
| 工作区 | **clean**，无 merge/rebase 残留 | 无 `.git/MERGE_HEAD` / `rebase-*`；会话快照 status clean |
| 在途功能批 | **已提交**（`0ebc967..43fb8af`） | 最近提交全为功能批收尾 |
| Batch 2/3 阻塞 | **已解除** | 阻塞前提是"在途批未提交"，该前提已不成立 |
| 远程新纲领 | 未落地（404） | 本文件为**待审议方案**的落盘版本 |

> **G1 开工当天必须重算依赖**，不得引用本文件或 0.5.0 的任何依赖清单（会过期）。

## 8. 每批的通用纪律

- 日常 `pnpm check`；封板 `pnpm verify`；看画面只用 ZCode 内置浏览器（禁 CDP / Playwright）。
- 每批独立提交、**路径限定**，绝不 `git add -A`。
- 每批配 killing test 并做**变异验证**（改回旧行为必须变红）。
- **不得**把"测试全绿"表述为"证明行为未变"。
- 已封板的 Batch 4 **不重开**；在途改动先确认归属。
