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
| `web`（含 `web/ui`） | `core`、`plugins` | Web surface 后端 + 浏览器前端。**Batch 4 已摘掉 `plugin-context` 这条边**（见 §6） |
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

扫描的是**源码文本**而非 AST，因为要抓的包括字符串里的包名——`plugin-tree.ts` 的 `SHIPPED_PACKAGES` 是一张字符串表、运行时 `import()` 装载，**动态边也是边**。代价是注释里的包名也会被算进来，而那不是依赖；因此门禁先剔除注释（字符串保留）。这条修正来自 Batch 4 的实测：摘边时唯一的"违规"就是文件头那句解释历史的注释，而它会把作者推向"把白名单加回去"——正是门禁要阻止的那一步。

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
| 插件注册项回收 | 靠插件自觉挂 `ctx.effect` | registry 按 owner(fiber) 兜底回收 | 4 ✅ 已成立（§7） |
| 回收失败可见性 | `runReverse` 的 `catch {}` 静默吞 | 经 logger 报出，循环继续 | 4 ✅ |
| Web 帧协议 | 无版本、无 eventId、无 runId | `protocolVersion` + `eventId` + `runId` | 3 |
| 浏览器端业务状态 | React hook 内 | `ui/src/client/`（React-free） | 6 |
| 视觉决策 | 98 张 module.css 各自发明 | `design/tokens` 单一来源 | 1 / 7 / 8 |
| 插件 UI 扩展点 | 无 | 7 个白名单 Slot | 7B |

## 5. 每包 ownership 细则

### `core` — Nova Runtime 的稳定核心

**负责**：Session、Run、ExecutionScope、Agent Loop、Event Model、Persistence Contracts、Tool Contracts、Approval Contracts、Provider Contracts、Permission Contracts、Plugin Contracts、Lifecycle、Cancellation。

**不负责**：React、Web UI、HTTP Server、WebSocket Server、CLI、QQ、具体 Provider 实现、具体 optional plugin implementation。

**必须保持 provider-agnostic。**

> 注意"Provider **Contracts**"这一项：Core 拥有的是**能力的形状**，不是能力的实现。两者分开——
> 见 §6 的原则框（契约进 Core ≠ 实现进 Core）。

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

## 6. Batch 4 的待证事项（`windowAtSeq`）—— 已答（2026-10-07）

`packages/web/src/context-window.ts` 曾静态 `import { windowAtSeq } from '@nova-agent/plugin-context'`。

```text
① windowAtSeq 依赖哪些类型？
   SessionEvent / ContextWindowSnapshot / ContextSurface / ContextElement /
   ContextPoint / ContextTimeline / ContextBreakdown / ContextFold /
   AgentMessage / AssistantMessage / ToolResultMessage / FileOpRecord
   —— 全部来自 @nova-agent/core 公开入口，无一是 plugin-context 私有类型。
② 这些类型是不是 Core domain contract？
   是。它们都定义在 core/src/context-insights.ts，且能力键 ContextInsights
   （core/src/plugin/capabilities.ts）本身就以 ContextFold 为形状。
③ 这个行为是不是 Runtime 的业务语义？
   不是。「窗口里有什么」是**可选扩展**的语义：core 只声明能力键，谁提供、
   怎么折、折多细是扩展的事。live 路径也正是经能力键取值，而不是调用 core 函数。
```

**判定：不上移 core 的实现。** ① ② Yes、③ No，未达"三者全 Yes"——但判据回答的是**实现放哪**，不是**契约放哪**。见下。

> ### 原则：契约进 Core ≠ 实现进 Core
>
> 这次最容易读错的一步。判据的结论是"`windowAtSeq` 的实现不搬进 `core/session/`"，**不是**
> "core 不该知道 `windowAt` 这件事"。
>
> ```text
> Core                       能力契约（双方共用的 vocabulary）
>  └── ContextInsights         ├── fold()
>                              └── windowAt()
> Optional Extension         能力的业务实现
>  └── plugin-context          ├── fold()
>                              └── windowAt()
> ```
>
> **能力键的形状永远属于 Core**：live 路径与任何只读消费者必须用同一份 vocabulary，否则就会
> 各自发明一份——这正是本仓"第二份实现"缺陷族的入口。而"窗口里有什么"的语义（怎么折、折多细、
> 什么算进入）属于扩展，因为它不是 Runtime 的业务语义。
>
> 所以"加进 core 契约"与"不上移 core"**不矛盾**：前者是接口，后者是实现。后续批次遇到
> "这个 provider 的哪一部分进 Core"时，先问这句，再套三问判据。

调研真正暴露的问题是——**不是位置，是通道**：live 路径经能力键 `contextInsights` 取 fold，只读路由却静态 import 生产者。两条通道让**一个可选扩展变成 web 表面的安装期硬需求**：扩展缺席时整个 surface 加载失败，而不是降级。

**改法**：core 的 `ContextInsights` 契约补上 `windowAt`（实现早已在 `contextInsightsOf()` 里，只是类型描述得比服务少）；路由改收注入的 `ContextWindowReader = Pick<ContextInsights, 'windowAt'>`，由 `launchWeb` 经 `kernel.host.context.get(contextInsightsKey)` 按请求解析。实现仍留在扩展里，"什么在窗口里"仍只有一份定义。

**封板**：Batch 4 到此为止。不再因为"已经碰到了 `ContextInsights`"就顺手把它整理得更 Core 一点。

**真机验证**（`nova --web` + 探针，非浏览器自动化）：

| 情形 | `GET /api/context-window` 应答 |
| --- | --- |
| `plugin-context` 在 | `404 {"error":"session not found"}` —— 缝已注入，走到了读日志 |
| `plugin-context` 缺席 | `503 {"error":"context insights unavailable"}` —— surface 照常启动并应答 |

第二条是本次要买的东西：可选扩展缺席时 surface 降级，而不是不启动。

## 7. 插件注册项回收（Batch 4 复核结论）

规范的目标是"registry 按 owner(fiber) 兜底回收"。**复核后：已成立，无需新增机制。**

- `registerTool` / `registerCommand`（`core/src/plugin/registration.ts`）都走 `ctx.effect(...)`；
- `ctx.provide` / `ctx.on` / surface 注册同样走 `ctx.effect`；
- `ctx.effect` 在 fiber 上落 `fiber.addEffect`，`Fiber.teardown()` 逆序回收；
- `toolbox.ts` 的 `register` 返回注销闭包，而 `ctx.effect` 收下的正是它。

**真正不成立的是另一半：回收失败不可见。** `Fiber` 与 `Context` 各有一份逐字节相同的 `runReverse`，`catch {}` 把 disposer 抛出的异常吞掉——一个只回收了一半的插件在系统里不留任何痕迹。已合并为 `core/src/plugin/effects.ts` **一处实现**，异常经 logger 以 `warn` 报出，循环继续（`Fiber` 报出插件名 + 注册标签，root 作用域报出标签）。

## 8. 内部 import 规则（包内）

包内不设强制的目录契约，但有一条不变量：

> **一个模块的公开面就是它被其他模块引用的形状。** 跨目录引用时优先走该目录的 `index.ts` 或具名模块，不要伸手进别人的实现细节目录。

Batch 5 起，`core/src/session/` 的 `repository` / `writer` / `projection` / `repair` 四个角色是对外可引用的**角色接口**，其余文件是内部实现。
