---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

长粘贴折成 composer chip（Grok 组件8 移植）：多行粘贴（或 ≥10k 字单行）显示为 `⧉ 粘贴 N行 X字` 徽章——**纯显示折叠**，缓冲区存全文、提交时模型看到一字不差的原文；← 整越回左缘、→ 整越过右缘、chip 边界退格/删除先展开再谈删字（绝不一键吞粘贴）；↑↓/词级移动在折叠面上换算光标；文本突变收敛进 `spliceInput`/`setInputAll` 唯一原语，chip 区间随编辑自动平移/溶解。图片 chip 因无多模态通路不做。
