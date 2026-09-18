---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

TUI 得到一层**设计语言底座**（Grok 度量逐值移植，M10 批6）——观感差距不在配色，在原先每个组件各自算宽度、各自 pad、各自写降级档，一处算错整块错位。新增 `tui-view/layout.ts`：屏幕分区（`bottomStack` = 转录 → 呼吸行 → 弹窗 → 队列 → 输入卡片 → 状态栏 → 快捷键条，**转录区是唯一收缩者**，其余定长）、水平列 `accent(1)｜左 2｜内容｜右 2`（`CHROME_WIDTH=5`，accent 列不画也占位，所有块左缘恒对齐）、圆角卡片原语 `cardTop/cardRow/cardBottom`（顶框右缘嵌 caption、底框右缘嵌 info）、分段行 `segRow`（超宽按原序**整条从尾部丢**，不折行不加省略号）、两种不通用分隔符（状态簇 `" │ "` 3 列 / 快捷键簇 `"  │  "` 5 列）。

**输入区从一行 `❯` 升级为卡片**（`composerCard`/`composerCardWidth`/`composerInfo`，Grok prompt 度量：左右内衬 2、单行草稿恒 3 行、正文宽连边框一起扣、行列数与字数走卡片底框 info）。**新增屏幕最后一行快捷键条**（`hint-bar.ts`：`hintItems`/`hintBar`）——键位随"谁占用键盘"换一套（命令面板 / 模型会话选择 / 审批 / 开屏选择器 / 运行中 / 静息），Tab 只在真能切模式时印出；占位符从此只说"在这里输入"（`composerPlaceholder()` → 常量 `COMPOSER_PLACEHOLDER = '描述任务…'`）。**整屏一套边框语言**：`Palette` 新增结构色槽 `border`（dark=bright-black、light=中灰、plain=恒等），开屏卡 / 输入卡 / `/model` `/session` 面板的框线一律走它，不再裸写制表符；输入行的 `❯` 前缀同样改由调色板绘制（`composerLead(p)`，原先硬编码 cyan+bold 转义码——light 主题下它是不知所措的亮青、plain 流下它仍吐 ANSI），`COMPOSER_PREFIX_WIDTH` 随之成为字面量；开屏卡片换成同一套圆角细线，垂直位置照 Grok 的 **上留余量 1/3**（原为对半切）。

API：新增导出见上；`bottomStack` 增 `hints` 参、`cursorPosition` 增 `leadRows`、`tokens` 增 `HINT_ROWS`；**破坏面**——`Palette` 增必填成员（自备调色板对象字面量的调用方需补 `border`）、移除 `composerPlaceholder` 与 `COMPOSER_PREFIX`（后者由 `composerLead(p)` 取代）。
