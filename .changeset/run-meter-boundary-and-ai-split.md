---
'@nova-agent/core': patch
'@nova-agent/ai': patch
---

`RunMeter` 的请求边界改为**显式开合**，并把 `ai` 客户端按职责拆成四个模块。

**修的是两个读数失真**（都在统计条 / 轨迹表 / 请求时序卡上可见）：

- **`llmMs` 曾把「请求装配」算成模型时间**：窗口原先在 `turn_start` 打开，而 `runAgent` 在那之后才跑 `assembleRequest`——hook 链、图片投影、以及一次**原位自动压缩**（它自己就是一次 provider 请求）全都落进了 `llmMs`。现在窗口由会话的 `countingProvider` 在请求真正交给 provider 的那一刻打开。
- **不上报 `usage` 的请求曾永远不闭合**：窗口原先只在 `usage` 事件上关闭，所以一个不报 usage 的 provider、或被 abort 截断的请求会让 `llmMs` 少一笔、`requestTimings` 比 `requests` 短（时序卡因此少一行）。现在包住 provider 流的生成器在 `finally` 里闭合窗口，**EOF、报错、abort 三种收场都算**。

语义随之写明：同一 `stream()` 内的 `reset` 重试是**一个**窗口（退避计入调用方确实等过的延迟），空补全重试是**新的一次** `stream()`——所以 `requests` 是「交给 provider 的次数」（含重试），与 `requestTimings.length` 恒等。

**`packages/ai` 的拆分**（内部结构，公共 API 不变）：`client.ts` 只剩状态机（寻址、重试循环、SSE 驱动），字节的**含义**搬到 `wire.ts`（IR ↔ 厂商 JSON）、失败的**含义**搬到 `retry.ts`（错误分类 + 退避策略）、读流与计时器管件搬到 `transport.ts`。`HttpError` / `ProviderProtocolError` / `parseRetryAfterMs` / `RETRY_BACKOFF_MAX_MS` 从包根照旧导出。

直测：`core/test/metrics.test.ts` 钉住「装配时间不计入 `llmMs`」「无 usage 也闭合窗口」两条；`core/test/kernel.test.ts` 钉住真实会话路径上「provider 全程不上报 usage，`requestTimings` 仍为 1 且带 `finishedAt`」（去掉接线即红）。
