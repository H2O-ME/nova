# @nova-agent/tui-app

## 0.4.0

### Minor Changes

- 1b6376d: **TUI 全量重写：删除旧实现，新增 `@nova-agent/tui-app`**（M11 批4）。旧 `@nova-agent/tui-view` 全包（≈3,000 行纯视图层）、`cli/tui` 壳（≈4,500 行）与旧 `tui-mode.ts` **一行不留地删除**——渲染计算与产品逻辑长期纠缠、反复拖累开发。新包是 `nova` 的默认形态（非 TTY 与 `--repl` 仍回落 readline REPL）。
  
  - **三层分工**：纯函数层（`blocks` 事件归约 → `entries` 滚动条目 → `render` 显示行 → `panels` 卡片 → `frame` 整帧装配，`Palette` 注入、可假时钟直测）／按键层（`keys.ts` 一个 reducer：审批 → 模态面板 → 全局键 → 输入区，动作是描述不是执行）／壳层（`app.ts` 只留 alternate screen、raw 键盘、**一个时钟** `TICK_MS=33`、内核订阅与 tps/cache 计量——壳层不做版面算术）。
  - **M10 的逐值设计成果全部移植**：GrokNight RGB 四档调色板（truecolor / 16 色 / light / plain）、`layout.ts` 度量与**整屏一条左缘**、留白节奏与密度规则（工具行紧排、其余块一空行、提问自带 vpad）、**动词短语聚合行**、工具行**三态折叠**、reasoning 定高活窗口、导轨 `sin²` 行波、`<10s` 一位小数的活体行、贴底锚定（仅"转录里只剩欢迎卡"时居中）、输入卡 / 审批卡 / 队列 lane / 快捷键条 / 欢迎卡 / 列表面板。
  - **键位**：`Enter` 发送、`Shift+Enter` 换行、`/` 命令面板（Tab 补全 / ↑↓ 选择）、`Tab` 未开会话前循环 普通→PTC→混合、`↑↓` shell 式输入历史（草稿自动寄存）、`PageUp`/`PageDown`/滚轮滚动、工具行点击三态折叠（动词组行点击即展开成员）、`Ctrl+C` 中断 → 清草稿 → 两段退出、`Esc` 中断。
  - **保留的交互**：长粘贴折成 chip（缓冲区存全文，提交一字不差）、审批「总是允许」行 ←/→ 调授权词数（词前缀匹配）、「拒绝」行打字补理由并回流给模型、外部内容显示净化与焦点重读（沿用 `@nova-agent/tui`）。
  - **有意的取舍**：上下文仪表只有总量（无分区着色、无悬停换形）；↑↓ 是历史而非多行光标移动；启动**不等** models.dev（`contextWindow` 先取配置，目录异步到达后回填，冷缓存/断网不再先给十几秒空屏）。
  - **同批修掉的真 bug**：彩色终端下状态栏整字段被丢（调色板字符串用 `.length` 算宽 → 改走 `stringWidth`）；动词组行的 `▸` 是死 affordance（点击无反应 → `toggleEntry` 认 `group:` 前缀）。

### Patch Changes

- Updated dependencies [1b6376d]
- Updated dependencies [b6255b3]
- Updated dependencies [1e35cdb]
- Updated dependencies [1b6376d]
- Updated dependencies [1b6376d]
- Updated dependencies [42c1bfb]
- Updated dependencies [37ea5d6]
- Updated dependencies [1e35cdb]
- Updated dependencies [1e35cdb]
- Updated dependencies [ef55de7]
- Updated dependencies [1999ce0]
- Updated dependencies [1fc1728]
- Updated dependencies [3d9b23a]
- Updated dependencies [3f15834]
  - @nova-agent/plugins@0.4.0
  - @nova-agent/core@0.4.0
  - @nova-agent/tui@0.4.0
