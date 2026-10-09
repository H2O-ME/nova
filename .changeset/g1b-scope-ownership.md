---
'@nova-agent/core': minor
---

G1b：`ExecutionScope` 的所有权归位到 `Run`。

`Run` 在创建时构造并冻结一份 `ExecutionScope`（`Run.scope`），`AgentOptions` 的三个扁平字段 `sessionId` / `runId` / `principal` 合并为 `scope?: ExecutionScope`，`agent/tools.ts` 删除每次 tool call 的现场投影改为直接读取。

`runAgent` 仍在调用者未固定 `runId` 时自铸一个（写进 scope），所以裸驱动循环的嵌入方与子代理嵌套循环的行为不变。

`ExecutionScope` **不扩张字段**：0.5.0 列出的八字段是目标契约，逐字段接入，每个字段落地时同批带生产者与消费者（证据见 `docs/NOVA-GENERALIST.md` §6 G1b 修订）。
