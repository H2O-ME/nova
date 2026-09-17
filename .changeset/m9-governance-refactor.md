---
'@nova-agent/core': minor
'@nova-agent/cli': patch
---

治理换血与消重拆壳（M9.0–M9.4，行为保持不变重构）。

- **公共面新增**：core 导出 `errMessage`（错误转消息字符串单源）与 `truncateUtf8Head` / `truncateUtf8Tail`（UTF-8 整字符边界字节裁剪，收编 agent 落盘 / jobs 读取 / AGENTS.md 裁剪三份同构循环）。
- **结构棘轮**：`pnpm gates`（依赖方向机检 + 逐文件行数硬上限，只降不升）、`pnpm check` 快环 / `pnpm verify` 全环分层、oxlint complexity/max-depth/长函数规则上线；决策笔记体系删除。
- **消重**：四 runner 的用户消息提交/重试与空补全文案/回合失败归类/审批预览与 toast/hooks 重绑单源；repl 与 TUI 的 13 个斜杠命令下沉 command-core；`tui-mode.ts` 1546 → 1092 行（命令呈现、开屏选择器、会话切换、弹窗优先级、压缩等待态、整帧装配、事件呈现归约七块出壳为可直测模块）；`repl.ts` 709 → 650 行（瞬态进度行出壳 `ReplProgress`、/session /model /plugins 报告行下沉）；M7.0 时代的 5 个 tui-view 转发门面（ui/statusbar/composer/popup/reasoning.ts）删除，呈现计算一律直连 `@nova-agent/tui-view`。
- **声明的行为例外（漂移修复）**：repl 审批预览宽度统一走 `toolArgSummary`；exec/qqbot 调色板装配走 `resolvePalette`，开始尊重 `ui.theme` 与 `NO_COLOR`（此前恒暗色）；repl bash 输出尾行缓冲并入 TUI 同源的 `TOOL_TAIL_KEEP_CHARS`（显示行仍裁到单行，观感不变）。
- **缺陷修复**：TUI 首装与 exec 路径的 `hooksRef` 从未赋值——嵌套 subagent 因此绕开父审批门（exec 的 never 策略形同虚设）；重绑单源后审批门对嵌套调用恢复生效。
