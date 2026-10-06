# NOVA 0.5.0 重构总纲

> **文档状态**：Normative（规范）
> **目标版本**：`0.5.0`（当前 `0.4.0`）
> **本文件**：总纲与执行纪律。细则见 `NOVA-BOUNDARIES.md` / `NOVA-UI-ARCHITECTURE.md` / `NOVA-DESIGN-SYSTEM.md` / `NOVA-TESTING.md`。

---

## 1. 任务定义

本次不是 Rewrite，不是重新设计一个 Nova，也不是整理目录。

这是一次：

> **Ownership + Contract + Context Refactor**

目标是让 Nova 在代码规模继续增长后仍然满足：

1. Agent 可以局部理解代码；
2. 新功能不会自动污染 Core；
3. 插件不会与其他插件形成隐式耦合；
4. Web UI 不需要理解 Runtime 内部实现；
5. Session / Run / UI 状态不会互相污染；
6. 测试保护行为，而不是保护实现；
7. 架构规则由自动化 Gate 强制，而不是依赖 Agent 记忆；
8. 旧实现可以逐步迁移，不要求一次性重写。

## 2. 三条主线（地位平等，同时推进）

```text
                    Nova 0.5.0
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
      Runtime       WebUI System    AI Coding
      Ownership      Design         Context
          │             │             │
      Session/Run     Tokens        Boundaries
      Plugin         Components     AGENTS
      Protocol       Layout         Gates
      Lifecycle      Motion         Tests
```

**WebUI 是一等目标，不是 Runtime 收尾后的"顺便做"。** Nova 的界面问题（间距混乱、动效漂移、组件职责不清）与 Runtime 的 ownership 问题同级。

## 3. 版本与依赖纪律

在没有明确要求的情况下：

- 不自行修改版本号；
- 不自行执行 Changeset version；
- 不批量升级依赖；
- 不因为重构顺手修改与任务无关的功能；
- 不将本次工作扩大成 0.6.0 / 1.0.0 Rewrite。

最终版本升级必须通过现有 Changesets 流程完成。

## 4. 命令语义（写死，禁止 Agent 推测）

| 命令 | 实际执行 | 用途 |
| --- | --- | --- |
| `pnpm check` | `pnpm lint && pnpm gates && vitest run --changed` | **开发快环（首选）** |
| `pnpm gates` | `node scripts/dep-direction.mjs && node scripts/structure-budget.mjs && node scripts/test-boundary.mjs` | 结构棘轮 |
| `pnpm verify` | `pnpm build && pnpm typecheck && pnpm test && pnpm gates` | **封板全环** |
| `pnpm vitest run <path>` | 单文件 | 精准验证 |
| `pnpm smoke:web` | `node scripts/smoke-web.mjs` | 真机冒烟（走真 provider，不在 verify 里） |
| `pnpm dev` | tsx 直跑 cli 源码 | 免构建调试 |
| `pnpm build` | `pnpm -r build` | 全量构建（改 core/plugins 后 typecheck 上层前必须先 build） |

**纪律**：

- 日常用 `pnpm check`；**批末封板才用 `pnpm verify`**，禁止日常跑全环。
- **看画面只用 ZCode 内置浏览器**。禁止 CDP、Playwright 与任何浏览器自动化。
- `pnpm gates:update` 只在确需增行时执行，且 `(RAISED)` 必须在提交说明里显式解释。

## 5. git 纪律

**每批开工前必须执行**：

```bash
git status
git diff --stat
git diff
```

确认：

```text
Existing Worktree Changes  ≠  Current Batch Changes
```

**硬约束**：

- 提交一律**路径限定**，绝不 `git add -A`；
- **禁止**对非本批改动执行 `reset` / `checkout` / `clean` / `restore`；
- 发现 Forbidden Path 必须修改时，**停止当前任务并报告**，不得偷偷扩大 Scope；
- 每批独立提交，任一批验收不过就 `git revert` 该提交，不牵连其他批。

> **背景**：本仓曾出现工作树中同时存在多个会话半成品的情况。任何"顺手一起提交"都会把别人的在途工作卷进本批。

## 6. 测试表述纪律

> **不得将"测试全绿"表述为"证明行为未变"。**

测试只能证明**已被测试覆盖的行为**未变。本仓出现过"测试文档声称某文件被 E2E 覆盖，而测试实际重新构建 kernel、根本没经过该文件"的事故，该纪律由此而来。描述覆盖时必须写**行为**，不写文件名。

## 7. 批次表

```text
Batch 0   Architecture / Design / Testing Freeze
Batch 1   Nova Design System RFC + Token Foundation   ← 批末停下等审批
Batch 2   Run + ExecutionScope（2A Runtime / 2B 消费者）
Batch 3   Protocol Contract
Batch 4   Provider + Plugin Boundary
Batch 5   Session Ownership + Lifecycle
Batch 6   Client Model
Batch 7A  WebUI Structural Migration
Batch 7B  IDE Layout + Slot
Batch 8   Conversation / Composer / Tool / Settings
Batch 9   Test Consolidation / Final Cleanup
Batch 10  Legacy Deletion + 0.5.0
```

四条**贯穿全程**（不是某个批次）：

```text
测试治理 ───────────────→ 全程贯穿
Design System ──────────→ 全程约束
Architecture Gates ─────→ 全程约束
Coding Context ─────────→ 全程约束
```

### 每批的交付形态

每批必须同时列出五段：

```text
新增        —— 引入什么
改          —— 改什么
删除        —— 明确删除什么（Add → Migrate → Delete，不是 Add → Add → Add）
不可改变    —— 哪些东西看起来顺手但绝对不能碰
验收        —— 怎么判定这批成立
```

**每个 Batch 必须有"删除目标"**。只增不删的重构必然重新制造复杂度。

## 8. 各批要点

### Batch 0 — Architecture / Design / Testing Freeze

**只做**：文档、Design RFC 草案、边界、测试规则、门禁、Agent 执行规则。
**不做**：Runtime 重构、WebUI 大改、CSS 迁移、Run 实现、Client Model。

产出：本文件与四份 `NOVA-*.md`；`scripts/test-boundary.mjs`；`dep-direction.mjs` 增三条边界规则；`AGENTS.md` 索引段（见 §12）。

### Batch 1 — Nova Design System RFC + Token Foundation

建立 `design/tokens` / `design/theme` / `design/primitives` / `design/motion`；把 `styles/motion.css` 并入 `design/motion`；扩 `style-guard` 与 `motion-guard` 为五条规则 + 基线棘轮；删 Tailwind 死依赖。

**硬约束**：本批**不迁移任何业务 UI**。设计值可提案，**用户批准前不得迁移业务 UI、不得视为最终契约**。批末提交后**停下等审批**再进 Batch 2。

**不可改变**：业务 UI 的视觉呈现与结构、`--dsw-*` 的现有消费方、Runtime / 协议 / 插件行为。

### Batch 2 — Run + ExecutionScope

**2A（Runtime）**：`core/src/runtime/run.ts`；Run 生命周期 `created → running → cancelling → completed / failed / cancelled`；`ExecutionScope` 扩为 `sessionId / runId / parentRunId / principal / channel / workspace / provider / permissions`，**Run 创建时冻结**；`RunContext = { scope, signal }`——**signal 不进 scope**；停止 Run 期读进程级可变状态；子代理继承 principal / workspace / provider，runId 链式；`run/stats` 带 runId、schema 升版。

**2B（消费者）**：`web/src/{controller,server-frames,dashboard,transcript}.ts`、`cli`、`qqbot` 一律消费 Run / runId，**不自造 run 概念、不改 Web Frame 设计**。

**删除**：`runAgent` 内临时 runId；每 tool call 现场拼 scope；kernel 级可变 model 依赖；各消费者对 `AgentStatus` 的近似终态判断。

**不可改变**：Provider HTTP/SSE 行为；Tool 执行语义；Session 持久化格式（除非 schema migration 明确要求）；Web UI 布局；插件公开 API。

**验收**：`packages/web/test/midrun-switch.test.ts`——它保护的正是"中途切换不改变在跑的 Run"。

### Batch 3 — Protocol Contract

新增 `PROTOCOL_VERSION`、帧级单调 `eventId`、帧级 `runId`；握手校验 + 不匹配拒绝文案；App 版本与 Protocol 版本分离。
**删除**：用 package version 猜协议兼容的余地（`ready` 基线重放保留）。
**不可改变**：Runtime 行为、Agent Loop、Session 持久化、UI 视觉。

### Batch 4 — Provider + Plugin Boundary

**先证明再决定（`windowAtSeq`）**——开工第一步回答三个问题并记入 `NOVA-BOUNDARIES.md`：

```text
① windowAtSeq 依赖哪些类型？
② 这些类型是不是 Core domain contract？
③ 这个行为是不是 Runtime 的业务语义？
```

三者全 Yes 才上移 `core/src/session/`；否则留在 web 纯函数模块内。**不接受"因为它是纯函数所以进 Core"。**

其余：Provider 契约由 runtime 定义（`ai` 降为纯实现）；`plugins/package.json` 三个 optional 插件改 `peerDependencies` + `optional`；`web/package.json` 去 plugin-context；registry 注册项按 owner(fiber) 自动回收；disposer 异常不再静默吞。

**不可改变**：插件公开 API 形状（`apply` 协议）、三扩展包只依赖 core 的现状、Runtime 行为。

### Batch 5 — Session Ownership + Lifecycle

新增 `core/src/session/{repository,writer,projection,repair}.ts`；删除序列补 PTY 停止、jobs 前置、await run settle、zombie 防护；12 个 `session-*.ts` 收进 `session/`；KernelEvent 按 Session / Run / Message / Tool / Approval / Plugin / System 分区（**不删事件、不造 wrapper**）。

**不可改变**：**日志格式与单一写入者不变量**（`Session.appendEvent` 是唯一写入漏斗）、已持久化会话的可读性。

### Batch 6 — Client Model

新增 `ui/src/client/{connection,model,protocol,sessions,runs,messages,approvals}`；socket 与 reducer 移出 React；`App.tsx` 拆 `app/App.tsx` + `app/AppShell.tsx` + `app/routes/`。
**删除**：`App.tsx` 内 socket / 业务 state；29 个文件的 props drilling；越层值导入。
**不可改变**：Runtime 行为、Web 协议语义、视觉设计、Tool 执行。

### Batch 7A — WebUI Structural Migration

目录落到 `layout/`、`features/`、`app/`、`plugins/contributions`；`gates:update` 同步路径键与行数预算。
**删除**：旧 `chat/ composer/ rightbar/ settings/ shell/ sidebar/` 空壳与重复 wrapper。
**不可改变**：视觉设计、组件树语义、Runtime / 协议 / 插件。

**验收**：

```text
· 现有自动化测试全部通过
· 人工检查确认结构迁移未引入可见行为变化
· 不得将"测试全绿"表述为"证明行为未变"——测试只覆盖已被覆盖的行为
· 本批不得主动改变视觉设计；出现视觉差异必须调查并解释，
  不得以"迁移副作用"直接接受
```

### Batch 7B — IDE Layout + Slot

`Sidebar | Conversation | Inspector` + 底部 Composer；Conversation 为主舞台。
新增 Slot 契约，**首版白名单最多 7 个，不得多**（见 `NOVA-UI-ARCHITECTURE.md` §5）。
**硬规则**：**没有真实插件需求，不得创建 Slot**；不得把 Slot 做成新的 React 全局注入系统。
**删除**：旧 shell 布局壳、旧 rightbar 停靠逻辑、重复 layout wrapper。
**不可改变**：Runtime、协议、Client Model 契约、插件生命周期。

### Batch 8 — Conversation / Composer / Tool / Settings

Conversation 拆 Timeline / Message / Tool / Reasoning / Approval / RunSummary；Composer 拆 Editor / Context / Attachments / Commands / Model / Submit；Settings 收敛 Shell + Section。
**删除**：Conversation 的卡片套卡片层级；`composer/` 平铺无编排的旧结构；Settings 里 navigation 与 section 混装的旧组件。
**不可改变**：Runtime、协议、Client Model 契约、插件生命周期。

**验收**：

```text
· 基线必须下降，或新增例外必须有明确理由
· 不得为了降低数字机械 token 化
· Guard 的目标是减少无意义的设计决策，而不是减少字面量数量
  （禁止出现 --nova-space-editor-inline-special-1 这类为凑数而生的 token）
```

### Batch 9 — Test Consolidation / Final Cleanup

新增 `core/test-support/`；行为覆盖台账（行为名，不是文件名）；删除 implementation-detail 测试与 obsolete adapter 测试。
**说明**：清理不是开始——测试规则 Batch 0 已立，Batch 2–8 已按批审，本批只收口。

### Batch 10 — Legacy Deletion + 0.5.0

**删除**：`--dsw-*` 色板与 `styles/design-platform.css`、所有 Adapter、旧 ownership 残留、兼容 hack。
**改**：`AGENTS.md` 同步到新机制。
**收尾**：`changeset` 走 0.5.0 → `pnpm verify` + `pnpm smoke:web` → `git diff --stat` 逐条核对是否越界。

## 9. Agent 禁止行为

除非任务明确要求，不得：

```text
顺手重命名
顺手升级依赖
顺手换状态管理
顺手重写 UI
顺手改 CSS
顺手改无关测试
顺手改变 public API
顺手修改版本号
顺手删除架构 Gate
```

尤其禁止：**为了让测试通过而修改测试语义。**

## 10. 修改前必须回答的问题

```text
1. 当前 ownership 是谁？
2. 目标 ownership 是谁？
3. 当前依赖关系是什么？
4. 目标依赖关系是什么？
5. 为什么需要迁移？
6. Adapter 放在哪里？
7. 最终旧实现什么时候删除？
8. 哪些行为必须保持不变？
9. 哪些测试保护这些行为？
```

无法回答时：**不要直接大规模修改。**

## 11. Migration Strategy

```text
Old Implementation
        ↓
     Adapter
        ↓
Stable Contract
        ↑
New Implementation
```

而不是：

```text
delete old → rewrite everything → hope tests pass
```

每一个 Adapter 必须记录 `owner` / `purpose` / `migration target` / `deletion condition`。迁移完成后必须删除 Adapter——**Adapter 不允许永久存在**。没有明确删除条件的 Adapter 不算迁移完成。

## 12. Coding Agent Scope Protocol

每一个重构 Task 开始之前，必须先输出：

```text
Allowed paths:
Expected files:
Forbidden paths:

Current ownership:
Target ownership:

Current dependencies:
Target dependencies:

Migration strategy:

Tests affected:

Required checks:
```

执行过程中发现必须修改 Forbidden Path：**停止并报告原因**，不得偷偷扩大 Scope。

## 13. 待合并到 `AGENTS.md` 的段落

> `AGENTS.md` 是仓库唯一权威文档与入口。以下段落应作为索引段并入 `AGENTS.md`，使 Agent 只读需要的细则而不是全部文档。

```markdown
## 文档索引（细则不在本文件）

本文件是权威入口与行为守则；机制细则按域拆分，**按任务只读相关的那一份**：

| 文档 | 何时读 |
| --- | --- |
| `docs/NOVA-0.5.0-REFACTOR.md` | 任何重构任务：批次表、命令语义、git 纪律、测试表述纪律、Scope Protocol |
| `docs/NOVA-BOUNDARIES.md` | 改动跨包依赖、插件边界、测试边界时 |
| `docs/NOVA-UI-ARCHITECTURE.md` | 改动 WebUI 结构、Client Model、Slot 时 |
| `docs/NOVA-DESIGN-SYSTEM.md` | 改动视觉、token、动效、间距时 |
| `docs/NOVA-TESTING.md` | 新增或删除测试时 |

**重构期测试纪律例外**：§0.4「拒绝过度测试」仍然有效，但重构批次的验收以 `docs/NOVA-0.5.0-REFACTOR.md` §8 各批「验收」段为准；两者冲突时以后者为准。
```

## 14. Definition of Done

### Runtime

```text
Session ≠ Run
Run 有明确 ExecutionScope
Run 不依赖 UI current state
Provider 不污染 Runtime
```

### Plugin

```text
Plugin API 稳定
Plugin 生命周期可管理
Plugin 不直接访问其他 Plugin internals
Optional plugin 可以独立存在
```

### Surface

```text
Web / REPL / Exec / QQ 不互相拥有业务逻辑
```

### Web

```text
Protocol versioned
Client Model React-free
React 不拥有 Runtime state
```

### UI

```text
Design System
App Shell
Conversation
Composer
Settings
Plugin Slots
```

### Testing

```text
Behavior-oriented
Contract-oriented
少量高价值 E2E
删除 implementation-detail tests
```

### Architecture

```text
pnpm gates 通过
```

## 15. 最终原则

Nova 0.5.0 不是"把现在的代码重新整理一遍"，而是：

> **让 Nova 的每一种变化都有明确的 owner。**

```text
                 ┌─────────────┐
                 │     CLI     │
                 │   Assemble  │
                 └──────┬──────┘
                        │
                        ▼
┌──────────────────────────────────────────────┐
│                   RUNTIME                    │
│                                              │
│ Session → Run → ExecutionScope → Agent Loop │
│       │        │                             │
│       │        ├── Tools                     │
│       │        ├── Approval                  │
│       │        └── Provider                  │
│       │                                      │
│       └── Event / Persistence                │
│                                              │
│ Contracts / Services / Plugin Host           │
└─────────────┬──────────────┬─────────────────┘
              │              │
              ▼              ▼
          Extensions      Surfaces
          PTC             Web
          Context         REPL
          Subagent        Exec
          Tools           QQ
```

> **目标不是减少代码，而是减少"修改一个东西必须理解的东西"：用 Ownership 划边界，用 Contract 稳定边界，用 Context 控制 Agent 的阅读范围，用 Architecture Gate 强制边界，用 Behavior Test 保护边界。**
