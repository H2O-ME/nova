---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
---

执行 scope 贯穿（审计 F01 最小修复 + F02 的门禁半边，2026-10-05 授权实施）。四条 killing test，变异验证四条全过（回退修复→红）。

- **`ExecutionScope`（core/types.ts）**：`{ sessionId?, runId?, principal? }` 是「一次执行属于谁、属于哪个 run」的最小事实；`ToolCallScope` 改为它的子集（钩子监听器从此能读到 runId/principal）。`signal` 刻意**不**进 scope：取消已经走 `AgentOptions.signal`，两份信号只会造出「谁赢」这第二个问题。`runAgent` 每次调用铸一个 `runId`（同一 run 的调用共享、嵌套 run 各自不同），`preflightToolCall` 把 sessionId/runId/principal 一起装进 scope 交给每轮钩子。
- **子代理继承父 scope（F01 主洞）**：嵌套 `runAgent` 曾用全新 options——没有 sessionId，其工具调用带着**空 scope**，审批门回落内核引擎：父会话只读而内核 full 时是越权路径，反之则把审批问错人。现在 `runOnce` 从 `ToolExecuteContext` 继承父会话的 `sessionId`（审批按父会话引擎裁量、审计落父会话日志）、`jobs`（后台任务归属发起会话）与 `emit`（日志事件不再无声蒸发）；前台与后台两条路径都穿。变异验证：撤掉继承，嵌套调用 scope 回空、测试红。
- **状态工具按声明剔除**：`ToolDefinition.ownsSessionState` 是新协议面——拥有「每会话一份」状态的工具（`todo_write` / `create_goal` / `update_goal`）自我声明；子代理的 `nestedToolset`（新文件 `core/src/tools/nested-run.ts`，与子代理工具分责）按 flag 剐除它们而非按名字硬编码。否则子代理里的状态写入要么污染父会话的面板（emit 被继承），要么静默假成功（emit 缺席）——审计点名的两个坏结局都不给。
- **审批门对空 scope fail-closed（F02 半边）**：有会话注册表的内核里，一个不带 scope 的调用一律拒绝（`this call carries no session scope`）——会话运行、PTC 子派发、嵌套子代理这些合法路径如今全都带 scope，空 scope 只意味着有人绕过了贯穿；内核引擎不属于任何对话，拿它裁量正是 F01 关掉的那条越权路。裸内核（嵌入方、无注册表）保留内核引擎回落，门不因缺注册表而卸载（fail OPEN 的旧坑不变）。

边界（明写不是缺陷）：F02 的 goal/压缩/命令按 current 路由与 F03 的工作区快照是更大的重构，本批只覆盖「scope 类型 + 贯穿 + 门禁 fail-closed + 子代理继承」这条最小闭环；`principal` 先由类型与测试承载，QQ caller-cap 的接线留到 F04 拍板。
