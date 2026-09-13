---
"@nova-agent/core": patch
---

子代理报告只认最终 assistant 消息：修复"报告只剩开场白"——旧采集取运行中最后一条非空文本，推理型 provider 在收尾轮把输出全部放进 reasoning_content、content 为空时，中途旁白会被当成已完成报告回流父会话并标记 completed；现在空最终消息如实返回 "ended without a report"（附可行动原因：reasoning_content 提示/轮数上限/中止），job 状态落 failed 触发父代理重派。
