---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/plugin-context': minor
---

「上下文」面板补齐**请求 DNA 卡**（`DnaCard`）——回答 dsh-context 的 DNA 读法：一次请求的构成占比。协议前置是按 `ContextPoint.seq` 拉回该次请求窗口的元素快照。

- **窗口快照契约**（`core/src/context-insights.ts`）：新增 `ContextWindowSnapshot`（`seq` / `elements` / `cats` / `total` / 可选 `point`）—— 一次请求在它发出那一刻窗口里有什么，与点 / 元素的现有规则同源。
- **fold 给出唯一实现**（`plugin-context/src/fold.ts`）：`ContextReading` 加 `windowAt(seq)`，规则与 `compositionBefore(seq)` 逐字相同（`element.seq >= seq` 截断、被压缩移走的元素按 `gone <= seq` 跳过）；导出 `windowAtSeq(events, seq, surface?)`，并由 `index.ts` 再导出。**窗口的「留下了什么」只允许一份实现**，所以面板读的折叠与转录读的日志不可能分歧。
- **只读路由**（`web/src/context-window.ts`）：`GET /api/context-window?session=<id>&seq=<n>` 在认证门后跑一次 fold 并回快照。会话 id 经 `sessionLogPath` 校验（与删除 / resume 同一条边界），`seq` 解析为非负整数；缺失 / 越界 / 找不到会话各自回 400 / 404 而不是悬挂连接。`@nova-agent/plugin-context` 进入 `web` 的依赖白名单（`scripts/dep-direction.mjs`），源码不再各写一份折叠。
- **DNA 卡**（`web/ui/src/context/DnaCard.tsx`）：一次请求一条堆叠条（六类在 `DNA_ORDER` 里的占比），点开拉同一份快照、按类别画绝对值与百分比。条本身只读 `point.cats`，不需要宿主，所以即使没接 `sessionFile` 也照画。

（本条早先还含**上下文浏览器卡**（`BrowserCard`）——该卡随后按操作者裁定删除，见 `context-cards-remove-browser-heatmap.md`；上面的快照契约与只读路由由 DNA 卡继续消费，故保留。）
