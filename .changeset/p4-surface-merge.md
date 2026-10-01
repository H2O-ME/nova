---
'@nova-agent/cli': minor
'@nova-agent/core': minor
---

surface 合流（2026-10-01 第二批）：

- **一份契约**：内置四家（web / repl / exec / qqbot）改为实现 core 的 `AgentSurface`（claim 只读 `AgentSurfaceRequest`，start 收装配好的 `AgentSurfaceRuntime`）；cli 的并行形状 `SurfaceEntry` / `resolveSurface` / `surfaceRequest` 一并删除，认领判据搬进各 mode 文件的工厂（`execSurface` / `replSurface` / `qqbotSurface` / `webSurface`）。
- **一个注册表、一次解析**：全部 surface 按「子命令 → 配置的 surface → 默认」顺序注册进同一 `SurfaceRegistry`，壳只调一次 `registry.resolve`；赢家对内置与配置 surface 同样记录进 `current()`，`userQuestions` 由此成为真正的单一来源（repl / web 的手抄布尔删除）。
- **装配合一**：`bootKernel` 成为唯一装配入口（生产代码里 `createAgentKernel` 只被它调用）；内置四家以 `SurfaceBoot` 贡献表达差异（exec / qqbot 的 `never` 策略与 `perRequestCompact`、qqbot 的通道插件与会话桶、web 的模型目录与设置页写回器）。
- **死成员收口**：`onWorkspaceChanged` 由 `buildSurfaceRuntime` 接回在役 surface（`repl` 首个实现方）；`command-runner` 的 `CommandPorts` 并入 `AgentSurfaceUi`（端口改为 `{ kernel, client, config, approvalOverride, fetchModels, ui }`，`CommandResult` 即 `AgentSurfaceCommandResult`）。
- `AgentSurfaceKernel.host.toolEntries` 每项新增 `plugin` 字段（surface 渲染「谁提供了这个工具」所需）。
