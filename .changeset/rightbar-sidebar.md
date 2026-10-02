---
'@nova-agent/core': minor
'@nova-agent/web': minor
'@nova-agent/plugins': minor
---

把 better-sidebar 的真实侧边栏能力直接融入主程序：右栏从「变更 / 文件 / 终端」三页扩成「变更 / 文件 / 编辑器 / 任务 / 终端」五页。

- **内核侧**：core 新增 `file-io.ts`（绝对路径规范化、原子写、跨平台路径安全：realpath 规范化后做越界检查、同目录 tmp+rename、符号链接跟穿拦截）与 `git.ts`（仓库探测 / porcelain -z 解析含 R/C 重命名 / 分支探测 / stage / unstage / commit / log）。`plugins/src/builtin/fs.ts` 的路径与读盘原语改为从 core 引入（消除两份实现）。
- **wire 协议**：客户端帧新增 13 条（`read_entry` / `write_entry` / `rename_entry` / `remove_entry` / `new_entry` / `open_entry` / `git_status` / `git_diff` / `git_stage` / `git_unstage` / `git_commit` / `git_log` / `list_jobs`）。新增 wire 上限：`MAX_EDITOR_BYTES = 192 KiB`（这是线上预算，不是磁盘上限——大文件用本地编辑器编辑，不在帧里半截传输）、`MAX_GIT_PATHS = 200`、`MAX_COMMIT_MESSAGE_CHARS = 2000`、`MAX_GIT_LOG = 100`。
- **服务端**：`entry-frames.ts` 与 `git-frames.ts` 各自收一类帧；任何写动作都用一条新的 `git_status`（或 `entry_changed`）作答——答复即状态。删除/重命名把打开在编辑器里的同路径文档一起关掉，目录被改后工作区树按「该层需要重读」标记并自动补问（`treeAsk`）。`list_jobs` 直接读内核 `host.jobs.list(sessionId)`，行里只带状态/进度，不带输出——输出是模型的 `jobs` 工具的消费游标，第二个消费者会和它竞争。
- **前端**：编辑器页签是多文档 strip + textarea（无重编辑器依赖）；Ctrl/Cmd+S 保存；markdown 文件带「预览」开关（复用转录的元素树渲染器，零 `innerHTML`）；二进制 / 超限 / 读取失败三种情况各自一句话，不和「文件是空的」混为一谈。任务页签挂上即问 `list_jobs`、读 `state.jobs`、停止按钮发 `stop_job`。变更页除原有的「本会话的改动」（来自转录）外，新增 git 透镜：分支头、已暂存/未暂存/未跟踪三组、点击取 diff、暂存/取消暂存、提交框、最近提交列表。文件页除原有的工作区树与会话日志外，新增「新建文件 / 新建文件夹 / 重命名 / 删除 / 在文件管理器中显示」；新建/重命名走内联输入（Enter 提交、Escape 取消），删除走 `window.confirm`。

（本条的五页签随后被**整体重写**取代：编辑器页并入文件页，右栏回到四页签（变更 / 文件 / 任务 / 终端）；内核侧、wire 协议与 git 透镜各项不变——见 `rightbar-rewrite.md`。）
