---
'@nova-agent/web': minor
'@nova-agent/core': minor
'@nova-agent/plugins': patch
---

右栏对齐 dsh 第二轮（照 `ui-dockkit` / `ui-jobs` / `ui-deliverables` / `ui-sidebar-terminal` 逐值移植，全部真机复测）：

- **工具详情列整体删除**（操作者拍板：行内展开是唯一读法）——右栏居住者只剩 `RightbarPanel`，`ToolPanel` / `chrome-view` 的 `detail` 派生 / `ToolRow` 的 `InspectPill` 全链删除。
- **strip 逐值收紧**：34px → 28px 芯片行（芯片 `min 80 / max 170 / 13px`，关闭钮 20px 圆钮仅活动/悬停可见），总高 38px。
- **文件页 → 纯树页 + 只读文件标签页**：`FileTabView`（语法高亮 + 行号 + 换行开关 + 复制 + 重新读取，`.md` 走聊天同一条元素树渲染器）；重复点同一文件是幂等 reveal。**编辑能力整体删除**——textarea / Ctrl+S / dirty 连同 `write_entry` 帧与 `entry_saved` 一起删（树操作保留）。
- **终端对齐参照**：开始页终端卡的 shell 下拉（打开菜单才发 `discover_shells`——win32 探测补 MSI 标准安装位，修掉「pwsh 不在列」）、页脚状态条（连接中/运行中/已退出(码)/失败/不可用 + 重开/重试，去掉 `<select>`）、xterm 逐值（`minimumContrastRatio 4.5` / `cursorBlink` / `fontSize 13` / 调色板随主题）。
- **任务页对齐 `ui-jobs`**：StateDot + kind + `detail ?? 状态词` + 时长（两级单位），结算行按 `finishedAt` 倒序（`JobSnapshot.finishedAt` 新增并透传 wire）、live 行两段式停止（arm 3s 自动解除）、chevron 元数据面板。**被杀的任务不再写 `exit code: null`**——生产者置空即不写 detail，行回落本地化的「已取消」。
- **变更页 diff 对齐 `ReviewTab`/`FileDiff`**：38px 工具行（文件选择菜单 + `+N −N` + 统一/并排切换 + 换行切换 + 打开文件标签页）、22px 行高、统一视图 grid `3.5em 3.5em 1.2em 1fr`、gutter 填充 + `inset 3px` 色标、并排 `splitRows` 纯函数（删除段配对随后新增段、短边留空）、偏好落 localStorage、行帽 `MAX_RENDERED_LINES = 5000`。

记名偏离见 `docs/dsh-parity-inventory.md` 第 20 轮（diff 并排单滚动容器、选择器菜单不带每文件计数、文件 tab 只读等）。
