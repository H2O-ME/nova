---
'@nova-agent/core': patch
'@nova-agent/web': patch
---

G2 第一刀：会话拆卸收口到 `AgentSession.dispose()`。

`dispose()` 现在自己停掉本会话的后台 jobs（`JobRegistry.disposeSession`，按 owner 过滤），并放在 `seal()` 之前——作业的最后一个事件仍能落进日志，而不是被拒绝。

`web/src/controller.ts` 的三处 `handle.dispose()` 之后各自再调一次 `jobs.disposeSession` 的两步式被删除：同一段拆卸逻辑此前写了四份（web 三处 + cli 一处），漏掉一处就会留下无处上报的 shell。行为不变——web 的每条 `dispose()` 路径本来都紧跟这次取消。
