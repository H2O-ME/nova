---
'@nova-agent/cli': patch
---

帧展平增量化（M10 R4，移植 Grok Build 布局缓存思路）：`Flattener` 以（块身份 + wrapped 数组引用）为脏信号做前缀对账，流式帧只重裹首个发散块之后的尾部——旧实现每 tick 全量重扫整段历史（每行一次 `trim()` 分配）。截尾/中段 splice/宽度变化均按原位失效，展平结果与全量 `flattenBlocks` 逐帧等价（脚本化变异序列回归测试守）。
