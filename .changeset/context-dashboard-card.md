---
'@nova-agent/core': minor
'@nova-agent/web': minor
---

「上下文」面板补齐**跨会话活动卡（仪表盘）**——把 P2 三项延后项里唯一不需要动会话协议、只缺聚合路由的一项落地：

- **内核数据源**（`core/session-aggregate.ts`）：`aggregateSessions(root)` 是仪表盘的唯一数据源——一次走遍 `~/.nova/sessions` 下的日志（沿用 `listSessionFiles` 的 2000 文件上限），逐文件流式读取事件行，把 `run/stats` 折成按**日**（YYYY-MM-DD，本地时区）与按**工作区**（最新 `workspace` 标记胜，缺则记 `__none__`）的桶，外加会话数与 corpus 总量。坏文件贡献零（与 session list 同一条纪律），早期无 `run/stats` 的日志也只是一只空桶。
- **聚合路由**（`web/dashboard.ts` + `server.ts`）：`GET /api/dashboard` 在认证门之后、静态服务之前把 `aggregateSessions(root)` 的结果以 `{ ok, aggregate }` 返回。`StartWebServerOptions.sessionsRootDir` 可注入（测试指向临时目录），缺省回落宿主的 `sessionsRoot()`。
- **前端卡**（`web/ui/src/context/DashboardCard.tsx`）：挂载时**自取**（唯一一张自取的卡——corpus 读数与打开的会话无关，不该每次 `ready` 重算）；14 天活动 sparkline + 工作区 top-5 排行 + 底部 corpus tokens 合计。**加载中 / 失败 / 空语料时不渲染**——新装机器零日志不会冒一张「无数据」的空卡；纯渲染拆出 `DashboardCardView`，SSR 直测无需驱动 fetch。
