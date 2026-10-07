---
'@nova-agent/core': patch
---

子代理透传 `cacheDir`（架构审计 F01 的最后一条尾巴）：嵌套 run 此前不带父会话的 cacheDir，超限工具结果落进全局 tool-outputs 根目录而不是父会话的溢出目录——同一段对话的产物分散两处，按会话清理时嵌套那一半漏网。现在 `ToolExecuteContext` 携带 `cacheDir`（loop 从 AgentOptions 注入），subagent 经 `NestedRunSession` 转发给嵌套 runAgent，与 sessionId/jobs/emit 同一条继承规则。直测：嵌套 probe 看到的是父会话目录；变异（撤掉转发）立即变红。
