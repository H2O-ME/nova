---
'@nova-agent/core': minor
'@nova-agent/web': minor
---

**架构收口：死代码清除、重复实现归并、两处真 bug 修复（M11 批8）**。不改任何用户可见的既有行为（除下面点名的两处修正），全部是"同一件事只有一个实现"的机械收口：

- **会话列表带上工作区**：会话目录是全局的（所有项目的日志都落在同一批日期桶里），此前侧栏只能按日期分组、两个项目的会话混在一起分不出。现在 `sessions` 帧每项新增可选 `workspace`（日志头的 workspace 标记，旧日志回落 `<environment>` 片段的 `cwd=`；都没有则缺省），侧栏按工作区分组（组标签取路径末段，`title` 给全路径），行右侧的印章改为「今天给时刻、更早给日期」（新纯函数 `stampLabel`）。新增 `ui/src/session-groups.ts`（纯函数，直测 5 条）。
- **`@nova-agent/core` 结构拆分**：`session-index.ts`（目录 API）里的日志头扫描拆到 `session-peek.ts`（id/创建时间/标题/工作区的 64KB 上限读）——两者变更理由不同，行数棘轮因此不需要放宽（`session-index` 上限反而下调）。
- **死代码清除**（零消费者的导出，已确认全仓无引用）：`cli/src/config.ts` 里与 `core/paths.ts` 逐字重复的 `novaHome`/`userConfigPath`/`sessionsRoot`/`sessionDateBucket`/`localDateKey`/`newSessionDir`/`NOVA_DIR`（现从 core 转出，不留第二份定义）；web/ui 的 `humanTokens`（与 `format.ts` 的 `formatTokens` 重复，违反「format.ts 是唯一格式化处」）。
- **行为修正（用户可见）**：卡片行截断此前按「省略号占 1 列」预留预算，而本宽度表把 `…` 记作 2 列（East-Asian-ambiguous 一律计宽），长英文标题会把卡片行顶出一列——超出的一列会换行、让整帧错位；现统一走 `truncateStyled`（省略号自身也计入预算，结果恒 ≤ 预算）。
