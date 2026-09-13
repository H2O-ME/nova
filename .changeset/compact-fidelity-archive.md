---
"@nova-agent/cli": patch
---

压缩保真与全文存档：摘要提示词去掉 300 字上限改 codex 七节结构（任务/进展/决策与原因/现状/问题/下一步/引用），摘要输入工具结果截断 2000→4000 字符，保留预算 20k→32k 字符并纳入纯文本 assistant 回复（`selectRecentMessages`）；压缩前完整 transcript 未截断存档至 `~/.nova/cache/tool-outputs/<sessionId>/pre-compact-*.txt`（trusted read root 免审批），摘要尾部附 `<archive>` 指针供模型按需 read_file 回查，增量压缩链式引用更早存档。TUI 压缩期间摘要输出经 `onDelta` 喂入 tps 速度表，仪表不再冻结。
