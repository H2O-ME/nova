# NOVA WebUI 架构规范

> **文档状态**：Normative（**§1 与 §6.2 待 G0b 改写**）
> **本文件回答**：浏览器前端的目录 ownership、状态分层、布局结构、扩展点边界。
> 视觉决策见 `NOVA-DESIGN-SYSTEM.md`；依赖边界见 `NOVA-BOUNDARIES.md`；通用化方向见 `NOVA-GENERALIST.md`。

> ⚠️ **待改写标注（2026-10-09）**：§1「Nova 是 Agent Development Workspace」与 §6.2「Nova 是 Coding Agent」的定位，与 `NOVA-GENERALIST.md` §1 的通用型定位冲突，将在 **G0b** 改写。§2 的三栏（含常驻 Inspector）与 §5 的 Slot 白名单将在 **G5/G6** 重定。**在此之前，本文件的目录树、状态分层、React Adapter 规则与组件禁令仍然有效。**

---

## 1. Nova 的定位

> **[待 G0b 改写]** 本节把 Nova 定位为 "Agent Development Workspace"、界面中心是 "Conversation + Execution + Tools + Context"。`NOVA-GENERALIST.md` §1 已将其改为**通用型本地 agent 工作台**；下方原文保留至 G0b 落地。

```text
Nova 不是：AI 聊天应用
Nova 是：  Agent Development Workspace
```

所以界面的中心是：

```text
Conversation + Execution + Tools + Context
```

而不是：

```text
聊天气泡 + 漂亮卡片
```

这条定位决定了本文件其余全部内容。

## 2. Nova Workspace 结构原则

```text
┌──────────────────────────────────────────────────────┐
│                    Session Header                    │
├───────────────┬──────────────────────┬───────────────┤
│               │                      │               │
│    Sidebar    │     Conversation     │   Inspector   │
│               │                      │               │
│   Sessions    │   Message            │   Run         │
│   Projects    │   Message            │   Tool        │
│   Plugins     │   Tool               │   Context     │
│               │   Approval           │   Files       │
│               │                      │               │
├───────────────┴──────────────────────┴───────────────┤
│                      Composer                        │
└──────────────────────────────────────────────────────┘
```

**硬约束**：

- **Conversation 是主舞台，不是各种 Card 的容器。**
- 三栏是页面级列，不是浮动卡片；停靠列不画 elevation（现有 `style-guard` 已钉住这条）。
- Composer 是底部固定条，不参与 Conversation 的滚动流。
- Sidebar 的收起/展开是布局状态，不改变 Conversation 的 ownership。

## 3. 目标目录树

```text
packages/web/ui/src/

├── app/
│   ├── App.tsx
│   ├── AppShell.tsx
│   └── routes/
│
├── design/
│   ├── tokens/
│   ├── theme/
│   ├── primitives/
│   └── motion/
│
├── layout/
│   ├── Sidebar/
│   ├── MainPanel/
│   ├── RightPanel/
│   └── SplitView/
│
├── features/
│   ├── conversation/
│   ├── composer/
│   ├── sessions/
│   ├── approvals/
│   ├── tools/
│   ├── settings/
│   └── terminal/
│
├── client/
│   ├── connection/
│   ├── model/
│   ├── protocol/
│   ├── sessions/
│   ├── runs/
│   ├── messages/
│   └── approvals/
│
└── plugins/
    └── contributions/
```

**组织原则**：

> **不按"UI 看起来是什么"组织代码，按"谁拥有状态、谁负责布局、谁负责呈现"组织。**

| 目录 | 拥有什么 |
| --- | --- |
| `design/` | 视觉决策的唯一来源（token、主题解析、primitive、动效词汇） |
| `layout/` | 页面级列的划分与尺寸（不含业务语义） |
| `features/` | 一个业务能力的完整呈现（含它自己的本地呈现状态） |
| `client/` | 与 Runtime 的全部通信与业务状态（**不依赖 React**） |
| `plugins/` | 插件贡献点的注册与渲染 |

当前树（`chat/ composer/ rightbar/ settings/ shell/ sidebar/ context/ question/ tool/ trace/ flow/`）在 **Batch 7A** 迁入上述结构，**不改行为、不改视觉**。

## 4. 状态分层

### 4.1 数据流向（唯一允许的方向）

```text
Runtime
    ↓
Web Protocol
    ↓
Client Model
    ↓
Feature Model
    ↓
React Components
    ↓
Design System
```

**禁止**：

```text
React Component  ↕  WebSocket
React Component  ↕  Runtime
React Context    ↕  another component
```

### 4.2 硬规则

> **UI Component 不允许拥有跨组件业务状态。**

错误：

```text
Message → WebSocket → Session → Provider → setState
```

正确：

```text
WebSocket → Client Model → Conversation Model → React → Message
```

### 4.3 React Adapter 规则

Client Model **不依赖 React**。React 只能通过稳定的 **Client Model Adapter** 访问业务状态：

```text
Client Model
     │
     ├── connection
     ├── sessions
     ├── runs
     ├── messages
     └── approvals
          │
          ▼
    React Adapter
      ├── useSessions()
      ├── useRuns()
      ├── useMessages()
      └── useApprovals()
          │
          ▼
       React
```

**允许**：按领域提供多个 typed selector / hook。

**禁止**：

```text
React Context
    ↓
everything
```

> 一个"巨大 Context"只是把 props drilling 换了个名字。**React Context 不得成为业务状态容器**；它最多用于注入 Client Model 的**引用**，而不是承载状态本身。

### 4.4 React 的职责边界

**负责**：render、interaction、local presentation state、layout、animation、accessibility。

**不负责**：Runtime ownership、Session persistence、Agent loop、Protocol semantics、Plugin lifecycle。

**React Component 不应该直接拿 Runtime Context。**

## 5. Slot / Contribution 契约

### 5.1 首版白名单（**最多 7 个，不得多**）

```text
settings.sections
composer.left
composer.right
composer.bottom
message.actions
session.header.left
session.header.right
```

### 5.2 本版明确不做

```text
conversation.before / conversation.after
app.sidebar.*
toolbar.*
modal.*
footer.*
panel.*
```

不是这些永远不能有，而是：

> **没有真实插件需求，不得创建 Slot。**

### 5.3 硬规则

- **不得把 Slot 做成新的 React 全局注入系统**（Slot → Context → Provider → Registry → Dynamic Component 这条链正是要避免的复杂度）。
- Slot 是 **UI composition contract**，不是 React Context 的另一种名字。
- 插件注册 contribution；**UI 决定如何 render contribution**。
- 插件**不允许**直接修改 `App.tsx`、`ConversationRoot`、`SettingsRoot`。

### 5.4 当前扩展点现状

`ui/src/plugins/client-loader.ts` 是插件前端装载器（boot graph 消费端），与 contribution 注册点不是同一件事。contribution 注册点随 Batch 7B 建立。

## 6. 组件职责与禁令

### 6.1 Message 不得过度组件化

不要：

```text
Message
 ├── MessageHeader
 ├── MessageAvatar
 ├── MessageContent
 ├── MessageFooter
 ├── MessageActions
 ├── MessageMeta
 ├── MessageContainer
 └── MessageCard
```

然后每个组件再套一层 `div`。

Message 首先是**一个语义对象的视觉投影**：

```text
User Message

Agent Message
 ├── content
 ├── reasoning
 ├── tools
 └── actions
```

视觉层级靠 **typography / spacing / alignment / divider / surface**，而不是靠十几层圆角卡片。

### 6.2 Tool Call 是 Nova WebUI 的核心特色

> **[待 G0b 改写]** 本节原文把 Nova 定义为 "Coding Agent"。`NOVA-GENERALIST.md` §1 改为通用型定位后，Tool UI 仍是核心特色（工具执行是通用任务的可见载体），但不再是"因为 Nova 是编程 Agent"。下方原文保留至 G0b 落地。

Nova 是 Coding Agent，Tool UI 比普通聊天 UI 更重要。

```text
默认 compact：

▶ bash
  $ pnpm test
  Running...
  12.4s
```

展开后显示：`arguments` / `result` / `output` / `timing` / `status`。

**不得**默认把大量工具输出铺满 Conversation。

### 6.3 Composer 必须可拆

```text
Composer
├── Editor
├── Context
├── Attachments
├── Commands
├── Model
└── Submit
```

拆分的目的是**明确 ownership**，不是"文件更少"。一个同时处理 textarea / keyboard / slash command / mentions / attachments / model / provider / permission / stream state / draft / submission / animation 的巨型组件对 Coding Agent 是灾难。

### 6.4 Settings 使用 Shell + Section

```text
Settings
├── Shell      → navigation / layout / dirty guard
└── Section    → load / draft / save / error / dirty state
```

### 6.5 视觉层级

见 `NOVA-DESIGN-SYSTEM.md` §6：**组件边界是代码边界，不必然是视觉边界。**

## 7. 当前状态的已知债（供各批对照）

| # | 债 | 现状 | 批次 |
| --- | --- | --- | --- |
| 1 | 无 React-free 的 Client Model | socket 与 reducer 绑死在 React hook 上（`client.ts:70`） | 6 |
| 2 | `App.tsx` 集权 | 755 行 / 10 个 `useState` / 零 `createContext` / state 钻透 29 个文件 | 6 |
| 3 | 目录与目标结构不同 | 无 `app/ design/ layout/ features/ client/` | 7A |
| 4 | Composer 无 feature 边界 | `composer/` 25+ 文件平铺 | 8 |
| 5 | 越层值导入 | `state-events.ts:10` 值导入服务端 `../../src/totals` | 6 |
| 6 | 协议无关联键 | 无 `protocolVersion` / `eventId` / 帧级 `runId` | 3 |
| 7 | Tailwind 死依赖 | 装了 v4、挂了插件、0 使用 | 1 |

**已达标、重构时不要改坏的**：`ToolRow` 默认 collapsed；`flow.tsx` 单点 block→row 映射；reducer 纯函数且可测；`frame-actions.ts` 穷举映射（编译期强制每个 ServerFrame 变体都有 entry）；前端零组件直接持有 WebSocket。
