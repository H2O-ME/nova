---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
---

审批授权键、工具结果落盘与压缩投影的一批边界加固。

**审批授权（安全）**：`alwaysScopeWords` / `commandProgram` 收口到 core 单一实现，并**剥掉前导 `NAME=value` 赋值**再取程序名。此前 `rememberKey` 与 `scopeKey` 各算一套：批准 `NOVA=1 git status` 记忆键是 `exec:nova=1`，于是要么形同未授权，要么让 `NOVA=1 rm -rf ~` 命中同一个键而跳过审批。现在两处都取 `exec:git`。

**工具调度**：串行与并行路径统一走 `settleToolCall`（execute / after-hook / spill / meta 任一失败都落一条可记录的结果消息，而不是让 generator 中止留下无结果的 tool_call）；并行段在启动每个已批准调用前重新检查 abort，未启动的记 skipped。

**重写判决**：`rewrite` 的 args 增加 JSON-safe 校验（函数 / symbol / BigInt / 循环一律 fail-closed 拒绝），防止不可序列化值进入实际执行。

**会话持久化**：`AgentSession.commit()` 落盘失败时按**身份**回滚而不是「仅当仍在队尾」，durable 日志与下一次请求用的 live history 不再分裂；`deriveMessages()` 丢弃未闭合压缩的 summary，但**保留崩溃后写入的消息**（旧实现从 orphan 处截断，整段崩溃后对话在 resume 时消失）。

**插件事件**：`EventRegistry.listOf` 返回快照（派发中增删监听器不再跳过/重复）；`emit` 收敛 async rejection（不再变成 unhandledRejection）；`bail` 显式拒绝 thenable；`composeHooks.beforeToolCall` 把 hook 抛错收敛为 deny。

**jobs**：仅 `list` 可并发（`output` 是消费式游标、`stop` 是状态变更，不能与同段并发）。

直测：`packages/plugins/test/permission.test.ts` 新增「赋值前缀不是授权程序」用例；`packages/core/test/session.test.ts` 新增「未闭合压缩被丢弃但后续消息保留」用例。
