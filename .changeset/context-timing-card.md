---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
---

「上下文」面板补齐**请求时序卡**（`TimingCard`），并把每请求的 TTFT / 总用时落到内核事实而非测两次：

- **内核数据源**（`core/kernel/metrics.ts`）：`RunMeter` 在每次 LLM 请求上记 `startedAt` / `firstTokenAt` / `finishedAt`，作为 `RequestTiming[]` 落进 `RunStats.requestTimings`。`run/stats` 事件照旧持久化它，所以续接 / 重载的会话也不会丢这部分读数。
- **fold 合并时序**（`plugin-context/src/fold.ts`）：`ContextPoint` 加一个可选 `timing`，fold 读 `run/stats` 事件，用 `afterMessageId` 锚点把这次 run 的若干 `RequestTiming` 按**后缀匹配**贴到锚点之前的连续几个点上（一次 run 的请求对应同一轮里最早的若干点）。合并只在数据面加一栏，不改点 / 元素的现有规则。
- **前端卡**（`web/ui/src/context/TimingCard.tsx`）：每完成请求一行——TTFT（首 token 时长）与总用时两列、底部一条平均。无时序的点不画（旧日志 / 还在跑的请求），所以面板不会对老会话冒一张「无数据」的空卡。读数与轮 header / 统计 pill 同源——`RunMeter` 是唯一计时器。
