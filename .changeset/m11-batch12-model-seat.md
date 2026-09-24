---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

**模型端：真正的模型选择（目录 / 切换 / 显示名）**。此前后端只有"配置里写了哪个模型"这一个事实——顶栏把它当 crumb 静态印出来，composer 里的模型芯片是惰性文字，用户实测判定「功能缺失」。

- **内核**（core / plugins）：`ChatProvider` 新增三个可选成员 `model` / `setModel(model)` / `listModels()`（`ai` 的 OpenAI 兼容客户端早已实现，此前无人调用）；`KernelEvent` 新增 `model` 变体（`model` + 可选 `name` / `contextWindow`）；核心新增 `core/kernel/model.ts`——`ModelOption` / `ModelGroup` / `ModelCatalogPort` / `ModelControl` 与 `canSwitchModels` 守卫；`Kernel.models?: ModelControl` 由 `plugins/runtime-models.ts` 提供：目录 = **端点公布的 id**（`GET /models`）+ **壳层的元数据**（显示名 / 窗口），切换**原地改写同一个客户端**（不重建 provider，会话句柄、子代理、缓存亲和绑定都仍指向它）后由会话发 `model` 事件。未提供目录（或客户端不可重定向）时 `Kernel.models` 缺席，座位保持惰性。
- **浏览器面**（web）：客户端帧 `list_models` / `set_model`，服务帧 `models`（拉取失败带可渲染原因，菜单留重试）、`state.modelName`、`ready.modelSwitching` / `ready.modelName`；服务侧状态抽成 `web/model-seat.ts`（标签 / 窗口 / 目录拉取 / 切换），控制器只把 `model` 事件变成给所有客户端的 `state` 回声——**座位跟着事件走，不跟点击的乐观值走**。前端座位（`ui/src/composer/ModelSeat.tsx`）触发器显示目录里的**显示名**，菜单按需拉取（冷启动不等端点），在役行打勾；换模型未带名字 / 窗口时**清空**而不是沿用上一个模型的（错的百分比比没有百分比更糟）。**顶栏的模型 crumb 删除**：harness 把模型放在 composer 的 `conversation.input.model`，一个模型只应有一个显示处。
- **壳层**（cli）：`model-catalog.ts` 提供 `ModelCatalogPort`（端点主机名 + models.dev 元数据，peek 优先、离线可用），`nova --web` 启动时一次 lookup 同时供仪表分母与座位显示名。
- 其它：`sessionLogPath()` 从 web 控制器移入 core（`session-index.ts`）——"resume 目标必须是 sessions 根下的 `.jsonl`"是会话存储的性质，不是某个界面的。
- 真机走查：座位点开 → 站点目录 30+ 行（含 models.dev 显示名）→ 切换 → 触发器随 `state` 回声改名 → 新模型真跑一轮得到回答。