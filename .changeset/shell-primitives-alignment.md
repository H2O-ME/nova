---
'@nova-agent/core': patch
'@nova-agent/cli': patch
'@nova-agent/web': patch
---

WebUI 外壳与基础控件对齐参考实现（deepseek-harness `ui-primitives` / `ui-layout` / `ui-approval`）：

- **菜单材质归主题所有**：新增 `shell/MenuSurface`（隔离层 + `--dsw-menu-surface-fill` + `--dsw-menu-backdrop-filter`），`Menu` 与 `MenuCard` 改走它，不再自绘不透明底；行律统一为 34px / R12 / 13px / 14px 图标（此前两表是 38px / R12 / 14px / 16px），与仓库既有三处菜单一致。
- **新增 `shell/Tooltip`**（悬停/聚焦独立触发、指针模态门、量测后翻面与边缘夹取、reduce-motion 关动画），接线于审批卡的工具名 chip——此前那是原生 `title`，键盘用户永远读不到；替换时补 `aria-describedby`，因为被替换掉的正是唯一的可读通道。
- **审批预览补 diff 底纹与左侧色条**：`--dsw-alias-code-diff-*` 底纹 + 3px inset 条，为此把卡片横向内边距从 `.body` 下移到 `.line`，色条才能贴到卡片边缘。
- **帧列宽只在离散折叠/展开时缓动**：移植 `data-animating` 计数器 + `transitionend` 释放（此前无条件 transition，窗口缩放时中列会追着窗口边缘抖动），并补两条 `prefers-reduced-motion`。
- 清理死代码：`--dsh-layer-*` 8 个层级 token 中 6 个从未被消费（且 `--dsh-layer-modal` = 60 用于全屏面板、与真正的对话框 1200 同名不同义），删除未用项并把剩下两个改名为 `--dsh-layer-panel` / `--dsh-layer-panel-fullscreen`；`--dsh-workspace-indent` 表达的是嵌套工作区，本产品没有该能力（永远解析到 0px 兜底），连同 `AnimatedRows` 里为它做的克隆补偿一并移除。
- 订正三处断言「本套 token 没有某 token」的过期注释——该 token 实际存在（`design-platform.css`），依此理由做的替代值（`--dsw-alias-bg-layer-2`、`z-index: 100`）随之回到参考实现的 `--dsw-specific-menu` / `1100` / `--dsw-radius-lg` / `backdrop-filter`；`HeroShell` 那处描述的 `.previewBadge` 在本仓根本不存在，改为如实说明未移植。

另修三处经实证复核的缺陷：

- **围栏语言名可致渲染崩溃**：`highlightLines` 用普通下标查语言表、`supportsHighlighting` 用 `Object.hasOwn`，两者对 `constructor` / `__proto__` 判断不一致——前者取到 `Object.prototype` 的继承成员并当作扫描器传入，抛 `TypeError`。该名字来自模型输出的围栏信息串，且本仓没有任何 error boundary，一次抛错会带走整条转录。现在两者共用一个 `Object.hasOwn` 查表函数，并加了回归测试。
- **答案尾行在「回合以工具调用收尾」时错误常显**：参考实现的 `endsWithResponse` 取的是回合**最后一条内容**是否为面向读者的回答，本仓只判断了「是否最新回合」，于是以工具调用收尾的新回合会把操作行常显出来（参考实现是悬停显示）。改为移植参考实现的 `findLast` 语义。
- **`useCalendarDay` 的边界算术无任何测试**（参考实现有，且含假定时器的跨界用例）：补齐覆盖，并把注释里指向 `format.ts` 的错误归属改正（算术就在本文件内）。

**同一类缺陷的其余实例**（一并修掉并各加回归测试）：值表写成对象字面量、键来自模型输出/线上数据时，`表[key] ?? 兜底` 并不能兜底——继承成员是真值，会短路掉 `??`。受影响处：`contextLabel`（上下文标签直接渲染进 JSX，`constructor` 会渲染出一个函数）、`pluginStateLabel`（同上）、`classifyFileType`（文件名 `constructor` / `x.constructor` 会把函数当作 `FileType` 交给图标组件，进而在 `css[kind]` 上二次走样）、`toolCallKind`（工具名来自模型，`switch (kind)` 全部落空）、`toolLabel` / `approvalLabel` / `permissionLabel`（终端行渲染出 `[Function Object]`）。全部改为 `Object.hasOwn` 查表。

经实证**判定无需改动**的两处：`web/src/server.ts` 的 `MIME`（`path.extname` 结果恒以 `.` 开头，永远不可能是裸的 `constructor`）；`DiffCard`/`FileTypeIcon` 的 CSS-module 查表（键现在是闭合联合，构造上不可能越界）。
