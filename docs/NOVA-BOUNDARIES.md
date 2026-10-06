# NOVA 边界规范

> **文档状态**：Normative
> **本文件回答**：一个包允许依赖谁、一个包拥有什么、跨包只能用什么形状通信。
> 机器执行处：`scripts/dep-direction.mjs`、`scripts/test-boundary.mjs`（均在 `pnpm gates` 内）。

---

## 1. 逻辑分层

```text
┌──────────────────────────────────────────────┐
│                  SURFACES                    │
│ Web / REPL / Exec / QQ                       │
├──────────────────────────────────────────────┤
│                 EXTENSIONS                   │
│ PTC / Subagent / Context / optional plugins │
├──────────────────────────────────────────────┤
│                   RUNTIME                    │
│ Session / Run / Agent / Tool / Approval     │
│ Event / Persistence / Plugin Contracts      │
├──────────────────────────────────────────────┤
│                  PROVIDER                    │
│ AI / OpenAI-compatible / model transport    │
└──────────────────────────────────────────────┘
```

> **逻辑层不等于 package。** 不要为了获得漂亮的目录树而继续无限拆 package。

## 2. 包级依赖白名单

**白名单是架构事实。改动它 = 改架构，必须在 diff 里显眼地被审阅。**

| 包 | 允许依赖 | 说明 |
| --- | --- | --- |
| `core` | `[]` | 绝对底层，零上游。Runtime 的稳定核心 |
| `ai` | `core` | Provider 客户端（HTTP / SSE / 流 / 工具调用 / 重试 / 用量提取） |
| `plugins` | `core`、`plugin-subagent`、`plugin-context`、`plugin-ptc` | **动态装载**：名字过门禁，源码不 `import`（字符串 spec + 运行时 `import()`） |
| `plugin-subagent` | `core` | optional extension |
| `plugin-context` | `core` | optional extension |
| `plugin-ptc` | `core` | optional extension |
| `web`（含 `web/ui`） | `core`、`plugins`、`plugin-context` | Web surface 后端 + 浏览器前端。**`plugin-context` 这一边将在 Batch 4 移除** |
| `qqbot` | `core`、`plugins` | 第三方 surface / 插件示范 |
| `cli` | `plugins`、`ai`、`core`、`qqbot`、`web` | 产品壳 / 装配层。`qqbot` 经**一处**动态 `import` |

**不存在反向依赖**。特别禁止：

```text
core → web
core → cli
core → react
core → plugin implementation
```

## 3. 四条边界规则

### 3.1 Internal Import Gate（跨包只能走公开入口）

跨包引用**只能**使用包的公开入口（`@nova-agent/<pkg>`），**不得**使用深路径：

```text
✓  import { x } from '@nova-agent/core'
✗  import { x } from '@nova-agent/core/src/internal/...'
✗  import { x } from '@nova-agent/core/dist/...
```

判据：import 说明符匹配 `@nova-agent/<pkg>/<任意后缀>` 即违规。包内部用相对路径（`./`、`../`）不受此规则约束。

**现状**：全仓**零深路径包导入**，本规则是零违规的纯棘轮——它的作用是防止第一条出现。

### 3.2 Plugin-to-Plugin Gate（插件之间不得直接依赖）

```text
✗  plugin-ptc      → plugin-subagent
✗  plugin-context  → plugin-ptc
✗  任意插件        → 另一个插件的 internal
```

跨插件通信**只能**通过：

```text
Contract / Service / Event / Contribution
```

**现状**：三个扩展包的白名单都只有 `core`，本规则已由 §2 覆盖；本文件把它显式化，避免未来"顺手加一条白名单"。

### 3.3 Surface-to-Runtime Gate（surface 不得 import Runtime 私有实现）

```text
✓  Surface → Public Runtime Contract（@nova-agent/core 的公开入口）
✗  Web     → core/src/internal/session/*
✗  QQ      → kernel 私有实现
```

**现状**：由 §3.1 的深路径规则机械执行。

### 3.4 Test Boundary Gate（测试同样受边界管理）

默认优先：

```text
package public API
+ test-support
+ contract harness
```

而不是：

```text
test → 另一个包的 src/internal/*
```

**允许**：测试用相对路径引用**本包自己**的 `src/`（单元测试的正常形态）。
**禁止**：测试用深路径引用**别的包**的内部实现。

**现状**：`packages/*/test` 的跨包引用全部走公开入口（`@nova-agent/core` 72 处、`@nova-agent/plugins` 18 处），零违规。

## 4. Ownership 表（当前 → 目标）

| 域 | 当前 ownership | 目标 ownership | 批次 |
| --- | --- | --- | --- |
| 一次 Agent 执行 | 无实体；`runAgent` 内临时 runId | `Run` 实体 + 生命周期（`core/src/runtime/`） | 2A |
| 执行环境 | 每 tool call 现场拼 3 字段 | `ExecutionScope` 在 Run 创建时冻结 | 2A |
| 终止通道 | 与 scope 混在一起讨论 | `RunContext = { scope, signal }`，signal 独立 | 2A |
| Session 读 / 写 / 投影 | 同一 `Session` 类 | `session/{repository,writer,projection,repair}` | 5 |
| Session 删除顺序 | 分散在 web / cli | Runtime 内统一序列 | 5 |
| Provider 契约 | 由 `ai` 的实现形状隐含 | Runtime 定义契约，`ai` 是实现 | 4 |
| 插件注册项回收 | 靠插件自觉挂 `ctx.effect` | registry 按 owner(fiber) 兜底回收 | 4 |
| Web 帧协议 | 无版本、无 eventId、无 runId | `protocolVersion` + `eventId` + `runId` | 3 |
| 浏览器端业务状态 | React hook 内 | `ui/src/client/`（React-free） | 6 |
| 视觉决策 | 98 张 module.css 各自发明 | `design/tokens` 单一来源 | 1 / 7 / 8 |
| 插件 UI 扩展点 | 无 | 7 个白名单 Slot | 7B |

## 5. 每包 ownership 细则

### `core` — Nova Runtime 的稳定核心

**负责**：Session、Run、ExecutionScope、Agent Loop、Event Model、Persistence Contracts、Tool Contracts、Approval Contracts、Provider Contracts、Permission Contracts、Plugin Contracts、Lifecycle、Cancellation。

**不负责**：React、Web UI、HTTP Server、WebSocket Server、CLI、QQ、具体 Provider 实现、具体 optional plugin implementation。

**必须保持 provider-agnostic。**

### `plugins` — Plugin Composition Layer

**负责**：Plugin Host、内置能力、插件装载、Kernel 组合、Kernel factory。

**不得变成第二个 God Core。** 尤其 `createAgentKernel()` 不能无限膨胀成为整个 Nova 的业务中心。

### `ai` — Provider Client

**负责**：HTTP、SSE、Streaming、Tool Calls、Retry、Reconnect / recovery、Usage extraction。

**不负责**：Session、Plugin、Web、CLI、Approval UI、React。

### `web` — Surface Backend

**负责**：HTTP、静态资源、WebSocket、Protocol、启动机制、PTY bridge、Web 专属路由。

**Web Server 不是 Runtime。** 禁止在 Web Server 中复制：Session Manager、Agent Loop、Tool Executor、Provider Manager、Plugin Runtime。

### `qqbot` — 第三方 Surface / 插件示范

**负责**：QQ 通道的全部行为，全部在 `packages/qqbot` 包内。宿主不认识任何插件名。

### `cli` — Product Shell / Boot Layer

**负责**：argv、config discovery、surface discovery、kernel boot、surface start、shutdown。

**不负责**：Web business logic、Agent business logic、Session business logic、Tool implementation、Plugin implementation。

理想：

```text
argv → config → surface registry → kernel boot → surface.start()
```

## 6. Batch 4 的待证事项（`windowAtSeq`）

> 记录于此以便 Batch 4 开工时直接回答，不重复调研。

`packages/web/src/context-window.ts` 静态 `import windowAtSeq from '@nova-agent/plugin-context'`（`dep-direction.mjs` 白名单注释明确认可该边）。要判断它是否应上移 core，必须先回答：

```text
① windowAtSeq 依赖哪些类型？
② 这些类型是不是 Core domain contract？
③ 这个行为是不是 Runtime 的业务语义？
```

**三者全 Yes 才上移 `core/src/session/`；否则留在 web 的纯函数模块内。不接受"因为它是纯函数所以进 Core"。**

> 反面教训：Core 什么都懂，正是本次重构要避免的。

## 7. 内部 import 规则（包内）

包内不设强制的目录契约，但有一条不变量：

> **一个模块的公开面就是它被其他模块引用的形状。** 跨目录引用时优先走该目录的 `index.ts` 或具名模块，不要伸手进别人的实现细节目录。

Batch 5 起，`core/src/session/` 的 `repository` / `writer` / `projection` / `repair` 四个角色是对外可引用的**角色接口**，其余文件是内部实现。
