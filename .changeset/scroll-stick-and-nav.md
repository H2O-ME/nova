---
"@nova-agent/tui-view": patch
"@nova-agent/cli": patch
---

TUI 滚动锚定与位置指示：用户上滚后（PageUp/滚轮）新输出不再把视口往直播拽——流式追加的行数等量补偿 scroll offset，视口钉在用户当时看的绝对位置，回到底部后恢复跟随；上滚时呼吸行显示「⋯ 上方还有 N 行 · Home 跳顶 / End 回到底部」（不占内容行、不进状态栏，守 tui-design 红线）；光标已在行首/行尾时再按 Home/End 升级为历史区跳顶/回底。
