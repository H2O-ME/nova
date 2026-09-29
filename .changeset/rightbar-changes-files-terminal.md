---
"@nova-agent/web": minor
---

WebUI 右侧栏：新增「变更 / 文件 / 终端」三个面板，并为终端补上它的帧协议。

- **终端帧（新增，向后兼容）**：客户端 `run_terminal {command}` / `read_terminal {id}` / `list_terminal`，服务端 `terminal {id, command, status, text, detail?, error?}`。命令以**会话自己的后台 job** 执行（复用 `plugins` 的 `startBashJob`——与模型 bash 工具同一套 shell 解析、进程树 kill 与字节环形缓冲），输出按**游标增量**读取，停止复用已有的 `stop_job`。**不是持久 PTY**：没有 stdin、没有窗口尺寸、没有信号通道；面板的空状态把这条边界写在界面上。为避免与模型的 `jobs output` 抢同一个输出游标，只有面板自己启动的 job 可被 `read_terminal` 读取（`terminal-frames.ts` 的 ledger）。
- **`packages/plugins`**：新增窄化具名导出 `startBashJob`（+ 类型 `BashJobRequest`），并把 bash 工具的 `run_in_background` 分支改为调用它——两处命令共用唯一一套 spawn 实现。
- **右侧栏面板（前端）**：新增 `packages/web/ui/src/rightbar/`——固定三个页签的 tab 条（页签胶囊 + 面板控件在条尾，dsh `ui-sidebar-right` 的层级）、变更页（从会话工具调用的 diff 视图折叠出改动文件与行级 diff，明说它不是 `git status`）、文件页（工作区目录树按层展开 + 会话日志列表）、终端页（命令输入 + 增量输出 + 停止）。
- **左侧栏折叠可发现性**：`AppFrame` 新增 `data-sidebar-auto-collapsed` 与 sidebar 槽的 `auto` 参数；窄视口自动收起时，轨道上的展开控件改说原因（「窗口较窄，侧边栏已自动收起」）并带强调色，不再与「读者自己收起」长得一模一样。
