---
'@nova-agent/tui': minor
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

状态栏仪表 hover 换形 + 用量断点混色（M10 批次3 组件1/2）。组件1：进入 DEC ?1003 悬停追踪，鼠标悬停状态栏仪表段时 T2 最简档在**同宽**前提下把条形格让给 `已用/总量` 数字（宽度构造性相等、零布局位移；条形不够让位时不换形）——`Key` 新增 `mousemove`、`LineScreen` 模式对增开 `?1003h/l`、`contextGaugeForms` 增 `hovered` 参、新增 `gaugeHitWidth` 命中宽。组件2：百分比配色从「绿/黄(70%)/超窗红」改为 Grok 断点混色的 ANSI 快照档：中性 <50%、青 <70%、黄 <90%、红 ≥90%（`usageUrgency` 纯函数），高压警示在超窗前 10 个百分点就可见。
