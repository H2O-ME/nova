---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/tui-view': patch
---

core 新增「呈现意图词汇表」（`packages/core/src/presentation.ts`）：`ToolCallKind` / `FileLocation` / `FileDiff` 与 `card` 判别的 `ToolCallView` / `ToolResultView`，只描述一次工具调用**是什么**（无文案、无颜色、无列宽），让 TUI / WebUI / headless 从同一份结构渲染而不再按工具名 special-case。`ToolDefinition` 增加两个**可选**纯函数 `presentCall?(args)` / `presentResult?(args, content)`（§10 面 4）——不声明的工具照旧以 generic 卡渲染；两者都不进 provider 线上载荷，前缀缓存不受影响。内置工具已声明自己：bash → terminal（含 exitCode / droppedBytes）、write_file / edit_file → diff（FileDiff，presentCall 不读盘）、search_files → search（FileLocation + truncated）、read_file / list_dir → read、todo_write → plan。

同时把两项**领域语义**从渲染包迁入 core：失败判定 `isFailureContent`（`tui-view` 原样 re-export，行为不变），以及"哪些工具是只读的 / 参数是路径"的分类（`toolCallKind` + `isReadOnlyKind` / `isPathArgKind`）——`tui-view` 的两张硬编码工具名表改为由它派生，逐名等价、渲染输出不变。
