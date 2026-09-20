---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
---

**内核收拢 + 可插拔 Surface（M11）**：拆掉"每个 runner 各自记簿记、各自猜阶段"的重复，把内核做成**唯一协议面 + 多家 surface**。

- **`AgentSession` 句柄与 `KernelEvent` 协议**（core 新增公共导出）：surface 只拿到句柄——`prompt` / `abort` / `compact` / `resolveApproval` / `subscribe` / `pendingApprovals` / `usageSnapshot` / `dispose`——不再自己跑 `runAgent` 生成器、不再自己落盘。"model-visible means logged" 由内核 `consume()` 直接保证：凡进了模型可见面的事件必已进日志，surface 无从遗漏。
- **旁路通道收编为事件**：`phase`（thinking/writing/tool/waiting/compacting）、`approval_request`、`tool_progress`、`subagent_update`、`job_update`、`notice`、`compaction/*` 全部并进 `KernelEvent`——原先 TUI 自推 phase、审批走 host 里一个隐形 await、job 靠轮询、压缩进度只存在于 SessionEvent 的四处旁路，现在是一条流。
- **审批事件化（fail-closed 不变）**：`PermissionService` 的 ask 注入点保留为底层，内核提供适配器把 ask 转成"发 `approval_request` + 等 `resolveApproval`"；surface 断连或 abort 时挂起审批收敛为 deny。headless 消费者（exec/qqbot）继续走确定性拒绝。
- **能力下沉**：`compact` / `auto-compact` / 上下文片段 / 工作区路径 / 会话索引从 cli 下沉 core（新公共导出）。`plugins/runtime.ts` 的 `createAgentKernel` 成为**装配单源**——host、审批桥、`PermissionService`、`JobRegistry`、上下文片段一处装配，provider 注入；core 保持 provider 与宿主无关。
- **cli 变瘦**：argv → 装配哪个 surface + 配置发现 + provider 工厂 + 模型元数据。斜杠命令语义收为 `command-runner.ts` **一个 runner 两壳共用**（对内核做什么、参数怎么解析、报什么文案单源），顺带修掉 `nova --repl` 的 `/skill <name>` 死路（原先进「未知命令」）。exec/repl/qqbot 全部改为内核事件流的消费者——功能与 JSON 事件流 schema 不变。
- `core` 另导出 `AgentSurface`（纯类型）：官方 surface 与第三方 surface 同地位，只依赖 core/plugins 公共 API，由 cli 按 argv 装配。