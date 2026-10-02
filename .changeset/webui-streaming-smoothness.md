---
'@nova-agent/web': patch
---

流式渲染与滚动跟随（用户报告「模型输出实时流式卡卡的，内容/思考/动画都卡」「发送新消息不自动滚动，参考 dsh」）：

- **delta 按帧合并，不再按块渲染**：此前每个 provider chunk 一条 WS 帧、一次全表面重渲——流式卡顿的根因。现在 socket 入口的 `StreamCoalescer` 缓冲 delta，每个绘制帧至多释放一次（`requestAnimationFrame`；后台标签页完全不渲染，回来一次性落定）；合并只发生在**相邻同 kind**（text_delta 另要求同 messageId）的 delta 之间，任何非流帧到达前先 flush，reducer 看到的顺序与内核发布逐字一致。模块带 10 条单测（边界/顺序/幂等/重新武装）。
- **行级 memo 补齐**：ReasoningRow / TurnHeader / UserMessageRow / MessageIconActions / TurnUsagePill / ContextInjectionRow / JobRow / CommandRow / SubagentRow / ChatHintRow 补 `memo`（ToolRow/AssistantMessage/MarkdownText 原本已有），TurnHeader 的回调改为传 `turnKey` 的稳定引用（内联闭包会让 memo 永远失效）；`App` 的 `flowRows` 与 `runningStatus` 提成 `useMemo`。一次 delta 现在只重渲它自己那一行，不再重建整个转录的元素树。
- **发送新消息强制回底（dsh own-input 规则）**：自动滚动判据此前要求「尾行是新 user 行」，而 `flowRows` 在 user 行后面必然追加 turn header——判据永不成立，滚动从未发生。改为追踪**最后一条 user 行的 key** 变化（`scroll-follow.ts` 的 `lastUserKey`）：到达即回底，且**压倒读者的阅读位**（对照 dsh `use-chat-scroll.ts` 的 `ownInput` → `followTail`）；翻页 prepend 不改 key，不会误触。纯函数断言 4 条。
