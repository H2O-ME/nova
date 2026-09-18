---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

**动效收进一个时钟**（Grok 30fps 移植，M10 批8）：原先转轮自己开 90ms 定时器、打字机揭示另开 30ms 定时器、导轨脉冲再按"各行自己的 elapsed"算相位——三套节拍互相打拍，两条同时开始的活动行会永远反相闪，看着像坏了。现在：

- `TICK_MS = 33` 是 TUI 唯一的动效时钟，`TuiStore.tick` 是唯一计数器（壳层一个定时器递增）。
- **转轮帧变成派生量**：`spinnerFrame = tick / SPINNER_TICKS_PER_FRAME(4)` ≈ 132ms/帧（Grok 同值），不再有独立计数器可写。
- **导轨脉冲改成行波** `railPhase(tick, row)`（Grok `sin²(tick*0.15 + row/32·2π)`；ANSI-16 混不出渐变，只取波形上下半）：多行生存面（bash 尾行、折叠正文）于是"亮段自上而下流过"，整块在呼吸，而不是整块同步闪。
- 打字机揭示定时器与主时钟同周期（30 → 33ms），消掉两个近频时钟之间的可见抖拍。

新增导出：`TICK_MS` / `SPINNER_TICKS_PER_FRAME` / `RAIL_WAVE_TICKS` / `railPhase`。**破坏面**：`TuiStore.spinnerFrame` 由可写字段变为派生 getter（外部写入不再合法，改投 `tick`）；`SPINNER_TICK_MS` 保留但只服务行式 runner（REPL / exec 进度行），不再是 TUI 的刷新间隔。
