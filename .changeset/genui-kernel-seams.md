---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
---

为 dsh-genui 风格的第三方插件开六条内核缝（侦察报告的六项已全部落地）：

- **工具结果 `meta`（核心类型）**：`ToolResultMessage` 增可选 `meta?: Record<string, unknown>`；`ToolDefinition` 增可选 `resultMeta?(args, content)`，`completeToolCall` 在 `afterToolResult` 钩子与截断**之后**调用它并把返回值附到结果消息上。**绝不进模型可见面**——只随结果帧下发到 surface（genui 的 spec、结构化校验态、typed payload 都走这条）。直测钉两条；两个内置工具今天都不声明，行为零变。

- **per-plugin 系统提示 section**：`buildSystemPrompt(sections)` 把插件 section 追加在 persona 之后、各自 `## <name>` 小标题；同名后写覆盖正文但**保留首次出现的位置**；空正文/空列表退化为裸 persona。section 在**装配时**一次性解析，不是每请求重算——否则前缀字节能被一次钩子改写、命中缓存契约当场作废。`CreateKernelOptions.systemPromptSections` 是新的可选注入点。直测四条；实现拆到 `prompt-sections.ts`。

- **fence 渲染注册表（前端）**：`chat/markdown/fence-renderers.ts` 一个 `Map<lang, FenceRenderer>`——markdown parser 已经把 info string 小写化，注册表对小写键查找，未注册的语言回落到 `<pre><code>`（注册零个 = 逐字节复现之前的页面）。这是插件 UI 能力的接口：把插件组件拉进 markdown 叶子会倒置包依赖方向，registry 让叶层插件无关、插件从自己的模块注册自己。直测四条。

- **turn-stopping 钩子（`turn/before-end` 事件）**：`agent/loop.ts` 在「无 toolCalls、即将 `done`」前先跑 `ctx.serial(beforeTurnEnd, …)`；插件返回 `{ action: 'steer', message }` 即追加一条 user/assistant 消息继续回合（受 `turn < maxTurns` 配额保护，配额耗尽仍按 `done` 收尾）。返回 `void` 即弃权，旧路径逐字不变。`AgentSession.prompt()` 之外有了「**回合将停**」的注入位（goal 的跨轮续做、genui 的「再问一句」都走这条），不依赖 surface 配合。直测两条。

- **插件资产路由（`routes` 服务键 + Web `RouteRegistry`）**：`capabilities.ts` 增 `routes: ServiceKey<RouteRegistry>` + `PluginRoute`/`PluginRouteHandler`/`RouteRegistry` 接口；`plugins/services.ts` 的 `routeRegistryProvider(registry)` 把宿主建好的实例 provide 进容器；`web/route-registry.ts` 的 `WebRouteRegistry` 实现 register/routes/handlerFor（前缀精确与嵌套都匹配、**反向注册序**派发——同前缀后注册的胜，与容器 replace-by-key 同语义）。`web-mode.ts` 在 boot 时实例化并经 `routeRegistryProvider` 进 `extraPlugins`、同时随 `launchWeb({ routes })` 透传给 server。`server.ts` 的 `handleHttp` 在认证门**之后**、图片/静态**之前**问 `registry.handlerFor(relPath)`——**插件路由仍然是私有读**（与品牌资产例外不同），命中即交由 handler、未命中回落静态。headless（exec / qqbot）不 provide 这个键，插件 UI 能力按「读不到就降级」收场。直测五条（注册表单元）+ 一条 HTTP 端到端。

- **浏览器侧插件装载器（boot graph + script injection）**：`PluginRosterEntry.clientBundle?` 与 `WireRosterEntry.clientBundle?`（`{ path?, rev? }`）作为 boot graph——`roster-wire.ts` 把它从 kernel 透传到 wire；`web/ui/plugins/client-loader.ts` 是浏览器侧装载器：`buildBundleUrl`（编码名字、默认 `client.js`、`rev` 转 `?rev=` 缓存击穿）+ `loadClientPlugin`（每个 `<name>` 一条 `<script>` 注入，记入 `window.__NovaPlugins__[name]`、按页记忆化、失败一次即终态不再重试）+ `loadBootGraph`（并行装载所有声明了 `clientBundle` 的启用插件，单个失败不阻塞其他）+ `registerClientPlugin`（host 内置插件短路）。**纯逻辑与 DOM 分层**：DOM 触碰只落在 `injectScript` 一处，其余全是纯函数/UI 测试车道（node 环境、无 jsdom）直测——装载器有 15 条直测覆盖 URL 构建、记忆化、失败终态、boot graph 走查；DOM 注入器经 `setScriptInjector` 可换，让测试用 resolver helper 驱动结算。**完整闭环**：插件 server 半经 `routes` 注册 `/plugins/<name>/*` 资产前缀 + 声明 `clientBundle.rev`，浏览器挂载时走 `loadBootGraph(roster)` 即发现并装载该插件的 client bundle，bundle 写到全局即被注册——五条缝（fence/meta/prompt-section/turn-stopper/asset-route）至此全部就位。

