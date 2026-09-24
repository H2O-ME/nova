---
'@nova-agent/core': minor
'@nova-agent/web': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
---

**会话列表不再闪 + 每轮反馈状态落盘 + 图标尺寸修正 + 静态缓存策略（M11 批14）**

- **修复：侧栏会话列表卡在「加载中…」**。`ready` 此前会把会话列表一并清空，而**切换会话会广播 `ready`**——于是每次点击侧栏都先把列表清掉，只剩"打开 socket 时问过一次"的请求，一旦那一次没赶上重连，面板就永远停在加载态。现在 `ready` 只把列表标记为陈旧（`sessionsStale`），客户端在"陈旧且无请求在飞"时单飞补问，**旧行一直渲染**（与 deepseek-harness 同策略：启动/重连拉一次，其余靠推送增量）。
- **会话列表更快**：新增 `@nova-agent/core` 的 `SessionListing`（并行 `stat` + 按 mtime 记忆化 `peekSession`），`listRecentSessions` 走它。639 份日志实测：首问 45ms、再问 20ms（此前 48–64ms，且每次重问都重读全部日志头）。
- **每轮反馈状态现在是持久的**（用户缺口：`20:36 · 用时 4秒 · 首 token 2.3秒 · 89 tok/s`）。`RunStats` 以 log-only 事件 `run/stats` 追加进会话日志（`afterMessageId` 锚定它收尾的消息，落盘先于广播），因此续接、页面重载后的会话**不再丢掉每一轮的状态行与底部统计条**——此前 `RunMeter` 只在进程内，重载即失。回放时投影成 `meta` 块，整份日志的折叠值随 `ready.runTotals` 下发；轨迹视图新增一行「运行量测」。**时钟只有一个**：回合的元数据行拥有它，助手尾行只留复制/分支。
- **修复：内联 SVG 没有内在尺寸导致的两处真实观感 bug**。只有 `viewBox` 的 SVG 在 flex 行里对父级宽度贡献为零：工具行的「详情」药丸被压成 44px 高的一坨竖排文字，模式选择器的箭头塌成 0×0。改为**把设计盒写进元素**（`width`/`height` 属性，即 harness `IconXxx16` 的做法），CSS 只按调用点缩放（药丸 12px、触发器箭头 14px）。`ui/test/style-guard.test.ts` 新增守卫：每个内联 `<svg>` 都必须声明设计盒。
- **静态资源缓存策略**：`index.html` 一律 `no-cache`，`/assets/*`（Vite 内容哈希产物）`immutable`。此前两者都没有缓存头——浏览器可能用启发式缓存把旧文档留在手里，而旧文档指向的资产 URL 已被重建删掉，重载会给出旧界面或一片空白。
- **公共面新增**（均为向后兼容新增）：`core` 导出 `anchoredRunStats` / `parseEventLine` / `missingToolResults` / `SessionListing`；`web` 新增入站帧解析模块 `client-frame.ts`、`WireBlock` 的 `meta` 变体、`WireTraceRow` 的 `run` 变体、`ready.runTotals`、`server.ts` 的 `cachePolicy`。