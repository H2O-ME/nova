---
'@nova-agent/web': patch
---

WebUI 视觉对齐第二轮（用户点名「对照 dsh 桌面端仍有廉价感」）：按逐 sheet 机械化对照 vendored dsh master，修真偏离：

- **目标条改回参照件**：目标此前是自造的两层卡（其样式表头注释还写着「dsh 没有目标面板」——前提已过期，dsh 有 `ui-goal/GoalBar`）。现按 GoalBar 移植为 **36px 单行条**（目标字形 + 阶段词 + 截断目标文本 + 悬停动作：暂停/恢复/编辑/清除），材质同队列面板（menu 填充 + 40px 模糊的 `::before` 层）；动作走与输入框**同一条 `/goal` 命令帧**（编辑为条内联表单）。
- **队列面板材质**：`--dsw-specific-tip`（不透明灰）改为菜单材质（`--dsw-specific-menu` + `backdrop-filter`），与参照的浮动表面一致。
- **圆角与 token 归位**：`ioCard` 12px→`--dsw-radius-lg`；工具卡/详情板的内滚条 6px→`--dsw-radius-sm`；详情板 `.pre` 12px→`--dsw-radius-lg`；轨迹行 8px→`--dsw-radius-md`、动作钮→`--dsw-radius-sm`；任务行停止钮 10px→`--dsw-radius-sm`；面板展开钮与详情板图标钮 `28px`→`999px + corner-shape: round`（28px 在超椭圆全局规则下会画成方块圆角，不是正圆）。
- **hero 版本徽章**：`24px`→`999px + corner-shape: round`，字色 `state-business-primary`→`label-primary-bluish`（参照值）。
- **上下文环弹窗宽度**补 `min(264px, calc(100vw - 24px))` 钳制（参照一致）。
