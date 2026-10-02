---
'@nova-agent/web': patch
---

WebUI 动效批次（用户报告「页面 ui 没有动画」「整个 webui 就很缺动画」「悬浮弹窗是黑的看不清文字」）：

- **修 tooltip 词汇混用**：上下文面板的悬停气泡此前用外壳 chrome 的**恒暗底**配主题跟随的字，亮色主题下黑底黑字不可读。按 dsh 的两套词汇归位——外壳提示恒暗，**面板内数据气泡跟随主题**（`bg-layer-2` 底 + `label-primary` 字 + `border-l1` 细边）；真机双主题读数确认可读。
- **上下文面板动效整套移植 dsh-context**：构成条 / 趋势柱入场横扫（逐列延迟，槽位封顶 20——长日志约一秒内落定）、悬停联动（本段提亮 / 邻段压暗）、图例 chip 化、气泡渐入；`staggerStyle` 是槽位计算的唯一实现。
- **全仓可点面补 hover 过渡**：28 张样式表的可点元素（菜单、设置行、按钮、图标位、轨迹行等）统一走 `--ds-transition-duration` / `--ds-ease-in-out` 的四属性过渡；`MenuSurface` 与 `QueueDock` 补 140ms 浮层入场。全部动效带 `prefers-reduced-motion` 静默档。
