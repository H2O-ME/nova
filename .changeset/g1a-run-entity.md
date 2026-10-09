---
'@nova-agent/core': minor
---

引入 `Run` 实体（`core/src/runtime/run.ts`）：**Session ≠ Run** 从隐式变为显式。

此前"是否有 run 在跑"是 `AgentSession` 里的一个布尔（`runController !== undefined`），run 一结束就失忆；`AgentStatus`（`'idle' | 'running' | 'compacting'`）把 run 状态与会话级的 compaction 混在一个联合里。现在：

- 新增 `Run` 类与 `RunState`（`created → running → cancelling → completed / failed / cancelled`），`AgentSession.run` 暴露当前或最近一次 run（含终态），`AgentSession.running` 由 `run.active` 派生——**单一来源**，不再是两份状态的近似。
- `beginRun(sessionId)` 在会话侧 mint runId 并传给 `runAgent`；`agentOptions` 新增 `runId`。
- **删除** `AgentStatus` 类型与其 getter（全仓唯一消费者是 `cli/src/repl.ts` 的 `compacting` 判断）；新增 `AgentSession.compacting`（纯会话级，与 run 分离）。

**契约未变**：Provider HTTP/SSE 行为、Tool 执行语义、Session 持久化格式（本批**不动**日志 schema）、插件公开 API。`runAgent` 的自铸 runId 保留为 fallback——`subagent-scope.test.ts` 锁定"每个 run 有唯一 runId"且嵌套 run 的 runId 与父不同，删它需同时迁移 `tools/subagent.ts` 与相关测试，记为 G1c 待办。

`Run.id` 的值目前无下游消费者（协议帧带 runId 属 G1d）；它是实体身份，不再是孤儿字符串。
