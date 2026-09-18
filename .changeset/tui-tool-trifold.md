---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

工具输出三态折叠：多行工具结果完成行头部带 ▸，点击在 Collapsed（基础行）→ Truncated（预览 12 行 + 剩余计数）→ Expanded（全文至 400 行上限）间轮转；折叠数据仅存会话内存，resume 后不可用（与 reasoning 展开同一契约）。
