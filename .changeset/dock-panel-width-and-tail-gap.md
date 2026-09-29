---
"@nova-agent/web": patch
---

计划面板与尾行的两处观感缺陷（操作者在浏览器里点名）：

- **计划面板比输入卡宽一整圈**：`TodoPanel.module.css` 的卡宽写成 `width: 100%`，横跨整个视口；dsh 的同一份是被算出来的（`100% − 2×side-clearance − 4×dock-inset`，再按 `card-max-width − 4×dock-inset` 封顶并居中）。已按 dsh 逐行对齐，`GoalPanel` 同步（它挂在同一个 dock 上）。真机实测：面板 680px、输入卡 712px，两侧各 16px。
- **完成的计划行被划掉**，整块像一张删除清单。dsh 只用状态点表达进度，行墨色对所有状态一致——`text-decoration: line-through` 是本仓自创，已删。

另外一处**有意偏离**（操作者要求，已在 `docs/dsh-parity-inventory.md` 记名）：转录尾行与答案的间距由 dsh 的 20px 收紧到 12px（复用「闭合过程组 → 答案」那一档 8px 列节奏）。用户气泡的动作行不在该规则内。
