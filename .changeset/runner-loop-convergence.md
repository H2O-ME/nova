---
"@nova-agent/cli": patch
---

四 runner（TUI/REPL/exec/qqbot）的事件消费簿记收敛为单源 `runner-loop.ts`：会话日志追加（message/tool_call_result/turn_aborted）、usage/锚点簿记（含 prompt_tokens=0 护栏）、中断归类（`isUserInterrupt`，ffdc595 契约）与完成/出错 toast（`createTurnNotifier`）此前各 runner 一份（持久化 switch ×4、锚点归零 ×6、toast ×3），每次修复需同步改四处。附带修复：qqbot 模式的最终 assistant 回复此前漏写会话日志（违反 "model-visible means logged"，resume 后不可见），现在随簿记统一落盘。
