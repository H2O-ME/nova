---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

**跑动时输入卡上方一条活体行**（M10 批15，Grok `views/turn_status.rs` 的移植，层 4 的第一块）：

一行 `⠹ 回答中… 12.4s`——转轮 + 阶段词（思考中 / 回答中 / 执行工具 / 进行中）+ **本轮累计耗时**，落在转录同一标记列，空闲整块消失（Grok 的 `should_show()` 同义）。Nova 此前只在 composer 前缀转个轮、每条工具行各报自己的秒数，一轮跑到第三十秒时"它还活着吗、已经多久了"在屏幕上没有答案。

- 时长格式照 Grok `format_duration`（`pager-render/src/util.rs:90-105`）：`<10s` 一位小数、`<60s` 整秒、更久 `m+s`；`formatElapsed` 与 `turnStatus` 都是纯函数，假时钟可测。
- **右半刻意不放**：Grok 那半是 `17s ⇣9.45k`（累计 context token），Nova 的已用/总量与 tps 归状态栏——一行一件事，不重复报数。
- 它占转录两行（行 + 呼吸行），跑动时视口随之收缩，与 Grok 同；`TuiStore.turnStartedAt` 是耗时基准，轮结束（`endTurn`）与轮外异常一起清空，不留第二份真相。

**破坏面**：`tui-view` 新增导出 `turnStatus` / `formatElapsed` / `TurnStatusView`；`TuiStore` 新增公共字段 `turnStartedAt`；跑动时底部栈多两行（帧行数契约变化）。
