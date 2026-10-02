---
'@nova-agent/web': minor
---

「上下文」面板按 dsh-context 参照继续补齐（前端纯函数 + SSR 直测，无内核改动）：

- **事件卡**（`EventsCard`，新）：把 fold 已经在 `ContextTimeline.events` 里收着的事件读数落成一张卡——按时间倒序一行一条（参照浏览器的骨架：glyph + label + detail + signed Δ + 相对时间），每条 `kind` 自带字形与中文词（压缩 `✂` / 工作区 `⇆` / 目标 `◎`）。新增 `kind` 是 fold 一处的改动，不是 UI 重构。删除决策倒过来：上一份变更集把事件卡裁定删了，理由是面板只答两问；现在把「为什么变了」当第三问接回——读数一直在 fold 与帧里，重新画一张是面板姿态的修正，不是数据面的扩张。卡片契约由独立直测钉住（`web/ui/test/events-card.test.tsx`：空态、倒序、逐 kind 字形与中文词、`freed > 0` 才出 Δ）。
- **趋势明细 Δ 与缓存命中**（`TrendDetail` 扩展）：悬停或钉住非最新的请求时，每个类别行追加一个带符号的 Δ 药丸（增绿减红）；明细底部一行给出该请求的**缓存命中率**（`cached / prompt`，与聊天用量 pill 同一项算式），括号里附绝对数。一张明细同时答「这次比上次多了什么」与「这次命中了多少」，而读数始终来自同一个 `TrendBar`。

（本条早先还含**热力图**一项——该卡随后按操作者裁定删除，见 `context-cards-remove-browser-heatmap.md`。）
