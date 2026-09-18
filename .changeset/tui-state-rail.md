---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

工具状态导轨（Grok accent_bar 移植）：▌ 导轨色即状态——运行中尾行亮青/暗脉冲（300ms 半周期，按 elapsed 推导）、折叠正文与失败错误行绿/红常驻，不再用 └ 折角与文字标状态；buildToolFoldRows 新增 state 参数，新导出 railLine/RAIL/RAIL_PULSE_MS。
