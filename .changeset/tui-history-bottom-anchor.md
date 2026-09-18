---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

**转录区贴底锚定**（Grok 版面在整帧终端里的翻译，M10 批9）：真机截图抓到一处病灶——短转录时视口的富余空白整段沉在内容与 composer 之间，最新一行离输入区半屏远，眼睛每轮都要跨过空洞找"接着看哪儿"。

Grok 的 scrollback 是个 pane，内容在 pane 里走文档流、空白落在 prompt 上方，但它看不出来：pane 上缘压着一行常驻 StatusBar，欢迎页又是占满整屏的 overlay，"短内容 + 中间空洞"那个组合几乎不出现。Nova 是 alt-screen 整帧、composer 钉死在屏幕下缘，同一套文档流就直接露馅。于是空白改落位置：

- 新增纯函数 `anchorHistory(lines, contentRows, mode)`（`tui-view/spacing.ts`）：贴底直播时富余空白**整段上浮**到内容上方，最新一行永远贴着 composer（只隔一行呼吸行）；开屏阶段仍只挪 1/3（Grok welcome 的 remaining/3——卡片浮在屏幕上部是欢迎页该有的姿态）；上滚后不挪，内容本就顶到视口上缘。
- `FrameAssembler` 改用它，`frameMap.topPad` 由"开屏专用"变成通用的合成空白行数——点击行号减它就是内容坐标（`keys.ts` 的命中数学不变）。

新增导出：`anchorHistory` / `HistoryAnchor`。**破坏面**：`sliceHistory` 的产物语义收窄为"内容 + 尾部补白"（补白落点交给 `anchorHistory`），短转录时帧顶部的空白行数从 0 变为富余行数——按绝对行号取帧内容的调用方需改读 `frameMap.topPad`。
