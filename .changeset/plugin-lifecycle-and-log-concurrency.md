---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
'@nova-agent/web': patch
'@nova-agent/cli': patch
---

插件生命周期、配置写入与日志读取的并发正确性加固。

**Fiber 激活串行化**（`core/plugin/fiber.ts`）：每次激活带单调 attempt id 并串行执行。此前 provider churn 在 `active` 态连发两次 `refresh()` 会**同时拆两次、装两次**（`teardown()` 不改 state，两次调用都走同一分支），最后谁先完成谁说了算；`dispose()` 之后仍在飞的异步 `apply` 又会把 fiber 从 `disposed` 拉回 `active`（复活）。现在旧 attempt 的结果不提交，`dispose` 会作废在飞的激活，同步体仍保持「`ctx.plugin()` 返回即已注册」的原契约。

**运行期重载失败回写 roster**：`Fiber.onSettled` 由 loader 安装，provider 换代导致的加载失败会写进该行的 `error`，面板不再把「只在重载时才坏」的插件显示成健康。

**reroster 串行化**（`plugins/runtime-roster.ts`）：读 entries → 扫工作区 → 建树 → `host.sync` 现在整体排队，两次 roster 交错不再可能让**旧配置快照**最后 sync 而把活树回滚；`state.rows` 改为 sync **之后**发布（此前 `describePlugins` 会在这段窗口里把每一行报成 disabled/failed）。

**配置写入串行化**（`cli/config-doc.ts`）：`tmp + rename` 只保证单次写原子，保护不了读改写。现在每个配置文件一条 promise 队列，整个 read → patch → write 在队列内执行——面板的「开关」与「插件设置保存」同时提交时不再互相覆盖。

**日志读取纯读**（`core/session-log.ts`）：补尾换行由 `repairTail` 显式开启，普通读取（`Session.replay`、WebUI 上下文窗口）不再改写另一个 writer 正在追加的文件。

**日志 shape 校验**（新增 `core/session-event-schema.ts`）：`JSON.parse` 只保证语法。header 缺 `v`/`id`/`createdAt` 此前会走 v1 升级路径并把损坏写回；形状不对的事件行此前经 `as SessionEvent` 进入 `deriveMessages`，把 `undefined` 推进模型面。现在两者都在读边界被拒，走既有的「跳过并警告」通道。

**压缩提交收口**（`AgentSession.commitCompaction`）：splice + anchor 重置 + `compaction` 事件变成同一个 session 拥有的原语，headless 每请求门与轮边界门共用。此前 headless 自己 splice，anchor 仍指向已不存在的面，下一个请求按压缩前的用量计量。「模型面 ⟺ 日志投影」的不变量也从只存在于测试助手（`surfaceDivergence`）变成提交点的真实检查。

**同一 session 文件单一 writer**（`web/controller.ts`）：resume 已打开的文件只重发 `ready`；切回一个仍被旧句柄持有的文件时先释放该句柄，避免两个 append 链写同一份日志。

**Web 侧 resume 语义**：`switchSession` 命中当前文件时不再新开句柄。

直测：`core/test/plugin.test.ts`「异步 apply 期间 dispose 不得复活」（旧实现必红）、`core/test/session.test.ts`「普通读取不写文件 / 形状不对的行被跳过」、`cli/test/config-write.test.ts`「两个并发 patch 都保留」。
