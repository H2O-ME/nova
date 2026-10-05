---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
'@nova-agent/web': patch
'@nova-agent/cli': patch
'@nova-agent/qqbot': patch
---

审批、提问与权限档改为**每会话一份**，修掉「一个会话的档位决定另一个会话的调用」。

**问题**：`PermissionService` / `ApprovalBroker` / `QuestionBroker` 曾经是**每个内核一份**，而一个内核同时跑着好几段对话（QQ 每个对端一段、浏览器每个打开过的句柄一段，切走的那一段还在跑）。于是三件本来属于「一段对话」的事实变成了全局：

- **权限档**：`read-only / auto-edit / full` 共享，QQ 对端一句 `/perm full` 把桌面也一起放行了；
- **「总是允许」的授权记忆**：在一个会话里批准 `git status`，等于在所有会话里都批准了；
- **审批卡片的发布槽**：`ApprovalBroker.attach` 只存一个发布者，谁最后建会话谁就把别人**已在等待**的审批卡抢走——A 卡在一个只有 B 的界面看得见、也只有 B 能回答的审批上；
- **审批审计的落点**：审计通过 `current()` 在写入时解析，于是在 A 里做的审批被记进了「当时恰好是当前」的那份日志。

**修法**：`ToolCallScope`（`{ sessionId? }`）从发起调用的那一次运行**显式**穿过工具钩子链（`AgentOptions.sessionId` → `preflightToolCall` → `beforeToolCall(call, scope)` → `tool/before` 事件载荷），审批门（新文件 `plugins/permission-gate.ts`）据此取**那一段对话自己的**引擎。`SessionService` 增加 `get(id)` / `list()`，`AgentSession` 暴露 `permission` / `questions` / `answersQuestions` / `disposed`。

三处刻意的 fail-closed：scope 指向本内核**没有**的会话（陈旧句柄、比会话活得久的一轮）→ 拒绝，而不是拿内核引擎去替别人裁量；会话没有决策引擎 → 拒绝，而不是放行；`ask_user_question` 只在**那一段对话**能问到人时才发出问题（`AgentSessionDeps.canAskUser`，读时求值），否则照旧回 `NO_PROVIDER`——否则一张卡片会被发到没人看的流上，把那一轮永久停住。

**唯一保持进程级的事实**是 `approvalPolicy`（`'ask' | 'never'`）：它说的是「这个进程里有没有人能回答」，所以 `ApprovalPolicyCell` 由内核引擎与每个会话引擎**共享同一个对象**，headless 形态（`exec` / `qqbot`）钉的那一次 `never` 照样约束它之后建的所有会话。

**直测**（`plugins/test/session-permission-scope.test.ts`，真内核）：按 scope 分别裁量（与 `current()` 无关）、陈旧会话被拒、授权记忆不跨会话、审计落进发问的那份日志、`never` 约束所有会话、`Kernel.permission` 跟随当前会话的档位。四次变异（门忽略 scope / 无 close-once / 队列继续排空 / identify 不 catch）逐一证明测试会红。
