---
'@nova-agent/web': minor
---

「上下文」面板**移除两张卡**：上下文浏览器（`BrowserCard`）与活动热力图（`HeatmapCard`）——操作者裁定，面板回到更短的列。

- **删的是卡片，不是数据面**：浏览器卡与 DNA 卡共用的窗口快照契约（`ContextWindowSnapshot` / `ContextReading.windowAt` / `windowAtSeq`）与只读路由 `GET /api/context-window` **保留**——DNA 卡仍按请求拉同一份快照。热力图是纯前端折叠（单会话口径），删除后不留任何孤儿：`HeatmapCard.tsx`、`events-heatmap-card.test.tsx` 的热力部分与 `ContextView.module.css` 的 `heat*` 段落一并移除。
- **事件卡保留**，并获得独立直测（`web/ui/test/events-card.test.tsx`）；`context-view.test.tsx` 的卡片清单与 `DnaCard` 的头注释按删除后的现状改写。`ContextView.module.css` 只删两张卡各自的段落（`browser*` / `heat*`），共享类（`card` / `cardHead` / `scaleToggle` 等）不动——样式护栏（每个类都有消费者）保持全绿。
- 记名偏离清单同步：`docs/dsh-parity-inventory.md` 与 `AGENTS.md` 的「已落地」表述改为「已落地后按操作者裁定删除」，不让账本继续宣称这两张卡在面板里。
