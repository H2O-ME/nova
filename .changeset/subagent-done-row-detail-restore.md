---
"@nova-agent/cli": patch
---

子代理完成行恢复点击展开：M7.10 的接管式活行去重引入回归——`tool_call_result` 先把待定条目从 toolBlocks 清空、再判"活行是否即工具行本体"恒不成立，接管行被移除后由完成行重推，`detail`（嵌套执行日志）随之丢失，子代理完成行点开无物。投影器化（M7.12）时 `SubagentLives.settle()` 改为在条目尚存时判定接管并保持块原位，完成行重新随详情收起可展开（内存态，resume 后不可展开——与 reasoning 详情同一契约）。
