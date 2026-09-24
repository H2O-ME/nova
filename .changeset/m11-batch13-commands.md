---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
---

**命令目录：`/` 菜单真的能跑命令了**。批13 前的状态是：内核的 `commands` 服务键与 `CommandRegistry` 早已就位，但**没有任何一方往里注册**——于是每个界面都得自造一套目录，而 composer 的 `/` 菜单只是个空壳（它甚至有完整样式，就是没有数据源）。用户实测判定「压缩上下文按钮」缺失。

- **内核**（core / plugins）：`KernelEvent` 新增 `command` 变体（`name` + `phase: run|done` + 可选 `text`），`AgentSession` 新增 `announceCommand`；`plugins/kernel-commands.ts` 提供**命令目录的唯一生产者**——`kernelCommandsPlugin` 经 `ctx.registerCommand`（第三方插件用的同一条公共 API）注册 `/compact`，`commandRunner` 同时给出**活目录**与**唯一 runner**：目录每次读容器（后注册的命令立即出现在每个界面的菜单里），runner 开一条 `run` 行、收集命令自己的 `log` 输出、以 `done` 行收尾——命令抛错**在它自己的行里报原因**，未知名字同样留一行 `未知命令：/x`，调用方（任何 surface）永远拿到一条可渲染的结果而不是异常。`Kernel` 公共面新增 `commands` 与 `runCommand(name, args)`。
- **浏览器面**（web）：客户端帧 `command {name, args}`（名字按注册表词法校验——`^[a-z][a-z0-9_-]{0,63}$`，参数长度与控制字符有界），`ready.commands` 下发目录；控制器把帧转成 `kernel.runCommand`，报告走事件流（`command` 事件 → 转录行），**没有第二套应答帧**。
- **前端**（web/ui）：`composer/command-menu.ts` 是一组纯函数——打字到 `/` 开菜单、查询过滤（名字优先、描述兜底）、选中回写草稿（`/name ` 尾空格正是让菜单随之关闭的那一步）、以及最要紧的**一份草稿意味着什么**：注册表认得 `/name` 就发命令帧，认不得就原样发提示词（界面绝不吞掉注册表没收编的文本）；`InputBar` 只做按键路由（↑↓ 走行、Enter/Tab 落定、Esc 关菜单）与把 `ComposerMenu`（此前的无数据壳）渲染进卡的浮层锚座；转录新增 `command` 行（同一命令两次运行是两行，按发生顺序；`done` 收敛到最近一行的名字，重复 `done` 不会叠空行）。顺带补上 harness 头部的 **corner 座**：`conversation/PanelExpandButton`（`ui-sidebar-right` 的 ExpandButton 移植）——详情板收起且有可展开的调用时出现的 28px 圆钮，点开详情板后自己消失。
- 真机走查（本机 `nova --web`）：输入 `/` → 菜单列出 `/compact 压缩上下文：总结历史，日志保留完整记录`；打 `/comp` 过滤出同一行；Enter 落到草稿 `/compact `；再 Enter 发送 → 转录出现 `/compact 执行中` + 「上下文压缩中（手动）…」+ 状态药丸「压缩会话」→ 收敛为 `/compact 已完成` + 「手动压缩完成 — 保留最近 2 条消息」，会话日志里留下 `compaction/start → summary → end` 三事件（压缩摘要真的被下一轮读到了）。
- 顺带：死代码清除——`format.ts` 的会话统计单行文本（`sessionStatsText`）在换肤后已无消费者（统计面板自己出行），连同它的测试一起删除；`pnpm smoke:web` 的 bundle 标记同步到当前界面文案，并新增两条本批检查（`ready.info` 携带内核命令目录、未知命令名也在事件流上留一行）→ **27/27 PASS**。