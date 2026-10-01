---
'@nova-agent/plugins': minor
'@nova-agent/web': minor
---

插件页展示「扩展缺失」的原因：加载失败的扩展行在 roster 里以 `state: 'failed'` 呈现（不再是 `disabled`——失败组的计数 / 置顶 / 「失败」标签都据此生效），`error` 随线帧到达浏览器（`WireRosterEntry.error`），展开该行即可看到「加载失败：<原因>」。此前缺包只进宿主 stdout，设置页上是一行「开关开着、什么都没加载」且没有任何解释。
