---
"@nova-agent/tui": minor
"@nova-agent/tui-view": minor
"@nova-agent/cli": minor
---

TUI 主题基建：新语义主题层（tui-view `resolvePalette`，dark=原配色原样平移、默认观感逐字节不变）+ 终端能力探测（tui `detectCaps`：NO_COLOR / TERM=dumb 恒定无色、COLORTERM=truecolor 升 24-bit）+ `LineScreen` 可选 synchronized output（`?2026`，探测启用，消除撕裂）。配置新增 `ui.theme`（dark/light/plain，strict schema 兼容新增）、新 `--theme` flag 与 `/theme` 命令（REPL/TUI 均可运行中即时切换）；light 主题为亮背景高对比方案（truecolor 优先、16 色回落）。
