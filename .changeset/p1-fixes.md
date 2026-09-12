---
"@nova-agent/plugins": patch
---

修复 `edit_file` 的 `$` 模式静默损坏：`applyEdit`/`tolerantReplace` 的替换值改用函数 replacer（`() => newString`），`$&`/`$1`/`` $` ``/`$'`/`$$` 一律按字面插入，不再被 RegExp 展开。修复 bash 输出头部截断丢尾：`runOnce`/`startBackground` 改用 `BudgetedBuffer` 双段缓冲（头部 60% + 环形尾部 40%，对齐 core 溢出落盘契约），中间丢弃字节数写入结果；背景 job 的 `readOutput` 保持 drain 语义，截断时给出提示。