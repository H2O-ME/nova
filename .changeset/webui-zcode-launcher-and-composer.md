---
'@nova-agent/web': patch
---

web-ui：继续按 ZCode 桌面端逐页对齐（2026-11-15 批）

- 右栏「新标签页」按参照 open-tab launcher 重写：顶部对齐、`max-w-3xl` 列、18px 页头、48px 图标块的整行条目、行尾「打开」胶囊；终端行保留 shell 菜单 chevron。
- 外观独立成 nav 分区（参照 `appearance` 页）：主题与界面字号从「常规」移出。
- 上下文环移入 composer 右侧动作区首位、去掉百分比文本，并在分子或窗口未知时整体不渲染（不再出现「0%」）。
- 轮次头 14px、右向 chevron（展开 rotate-90）、settled 文案「已工作 X」；时长格式改为参照的最多两单位、单位间空格、四舍五入。
- composer 输入行 14/20、最小高 40px；权限 chip 28px、两端 8px 内距；工作区 chip 改 full 圆角 pill（14/400）；chips hover 底改 `bg-input/50`。
- 会话页标题 600、动作区 gap 2px；草稿态头部去掉底边线（参照 draft 为 transparent）。
- 变更页文件行 32px、文件名 14px；设置页底部身份行 16px 内距、头像补 1px 内嵌描边。
