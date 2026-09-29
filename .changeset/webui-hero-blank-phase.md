---
'@nova-agent/web': patch
---

**修复：新会话开屏不再出现「新会话 + 对话/轨迹」空壳，回到 harness 的居中 hero 态**。

批11 移植的 hero（居中品牌 lockup + 居中 composer）在真机上从未出现：相位判定把「上下文注入」块当成了转录内容，任何新会话一绑定就带着两条注入块，`blank` 恒为 false，于是永远落到 active 态（标题+tab 渲染、composer 沉底）。

harness 的相位读的是 `awaitingFirstTurn`（首轮尚未开始），不是行数——注入的上下文是**轮前 chrome**，不挡 hero。本次对齐：

- `conversation/phase.ts` 新增纯函数 `awaitingFirstTurn(blocks)`：只有 `context` 块不计入首轮内容；App 的相位判定改读它。
- 首条消息发出后 hero→active 的过渡不变（composer 沉底、标题/tab/注入块按 harness 位置出现）。
- 直测：`conversation-phase.test.ts` 钉住「仅注入块=blank、任意首轮内容=非 blank」。
