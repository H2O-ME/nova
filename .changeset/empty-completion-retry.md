---
"@nova-agent/core": patch
"@nova-agent/cli": patch
---

空补全重试，根除主循环静默停摆：content 为空、无工具调用、带 finish_reason 的补全（推理型 provider 把全部输出流进 reasoning_content 的病理）旧版会推进一条空 assistant 消息并以 complete 静默收场——用户看到思考停止后 agent 无声终止、无任何报错。现在 runAgent 视其为 provider 病理，自动重试同一请求 2 次（请求每轮构建一次、前缀稳定缓存友好；耗尽抛错并回队 job 通知），新增 `empty_completion` 事件（--json 事件流 additive），TUI/REPL 落「⟳ 空回复…自动重试 a/N」提示行。
