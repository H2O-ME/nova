---
"@nova-agent/tui-view": patch
"@nova-agent/cli": patch
---

REPL 补齐 `/mode`：命令目录（COMMAND_SPECS）一直声明该命令，readline 实现却没有对应 case，输入 `/mode` 落「未知命令」。现在 repl 输出与 TUI 同语义的三态说明（普通 / PTC / 混合，❯ 标当前模式，取自 config 的 `tools.code.mode`）；`CODE_MODE_HINT` 从 TUI 壳层闭包常量提升为 tui-view 导出（TUI `/mode` 行为不变）。
