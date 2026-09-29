---
'@nova-agent/core': minor
'@nova-agent/web': minor
---

**计划面板：模型的 `todo_write` 从「只在日志里」变成 composer dock 上一块能看的卡。**

`todo_write` 的快照一直是 log-only 事件，模型自己重读得到、读者看不到——「模型现在打算做什么」这件事在界面上完全不可观测。按 dsh 的 `TodoPanel`（挂在 `conversation.input.dock`、`order: 0`）补上。

- **内核**（core）：`KernelEvent` 新增 `todo` 变体（`todos: readonly TodoItem[]`，**全表替换**而非增量）。生产者在 `session.ts` 的 `emit` 桥里——`todo/write` 落盘之后**同一条路径**发布，因为面板不能去轮询日志。这与 `run_stats` 的「落盘先于广播」是同一条纪律：日志是记录，事件是活的。`AgentSession.latestTodos()` 从事件流末条 `todo/write` 取当前表，供续接回放。
- **协议词汇**（core）：`TurnPhase` / `NoticeCode` / `CompactionProgress` 移入 `kernel/protocol-vocabulary.ts`——它们是取值词汇表，与「有哪些事件」是两件事；`protocol.ts` 原样再导出，调用点零改动。
- **浏览器面**（web）：`ready.todos`（可选，仅在日志里真有快照时出现）让重开/续接的会话恢复面板；在线更新走 `todo` 事件。
- **前端**（web/ui）：`conversation/TodoPanel`——默认折叠，`todos` 为 `null` **或空表**都不渲染（没有计划时不该占一行）；头部一行「任务」+「N 已完成 · N 进行中 · N 待处理」（**零值段省略**，三个 0 的读数是噪音）+ 展开箭头，`aria-expanded` / `aria-label` 齐备；列表每行按 `status` 换状态点（completed→done / in_progress→ongoing / 其余 idle）与文字色，完成的行加删除线。计数分隔符用 en-space（`\u2002·\u2002`）——与 dsh 逐字一致，普通空格在数字间会读成一串。
- 挂载位在 `DockStack` 里、队列行与输入卡之间：计划是「这一轮要做什么」的上下文，长在输入区上方而不是转录里（转录是已经发生的事，计划是还没发生的）。

**顺带**：`frame-router.ts` 不再自己拼出站帧——`wire-frame.ts` 是工具视图 enrich（`callViewOf` / `resultViewOf`）的唯一落点；控制器对会话的订阅改为幂等的 `followSession()`，换工作区导致内核换会话后不再静默丢事件。
