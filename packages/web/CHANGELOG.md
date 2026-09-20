# @nova-agent/web

## 0.4.0

### Minor Changes

- 1b6376d: **新增 `@nova-agent/web`：WebUI surface（`nova --web`）**。一个 Node 进程 = HTTP 静态托管（前端产物）+ **单条 WebSocket 内核事件流**，与 repl/exec/qqbot 同地位——没有第二套状态，内核事件进、帧出。
  
  - **认证只有一道**：启动打印一次性 `?t=<token>` 的 localhost URL，校验后落 HMAC 签名 `HttpOnly` `SameSite=Strict` cookie 并 302 到干净地址；HTTP 与 `/ws` 两道门共用它，静态托管拒绝路径穿越。
  - **零第三方依赖**：RFC6455 服务端自写（握手/掩码解码/分片/心跳/大小上限），包的 dependencies 只有 core 与 plugins。
  - **持久日志是真相，`ready` 覆盖转录**：浏览器不累积"自己以为的历史"，挂上 socket 就收到 `ready` 基线（rootDir / sessionFile / 模型 / 审批档 / 模式 / `history: WireBlock[]` / 挂起审批 / 用量基线 / 上下文窗口分母），重连即重建；回放块由 `deriveMessages()` 投影重建，工具调用与结果按 id 配对。
  - **审批走事件**：`approval_request` 帧带完整请求（kind / 工具 / 参数 / 效果预览），前端以 `resolve_approval` 回答；断连时挂起审批随 abort 收敛为 deny。
  - **词汇表的第一个真消费者**：控制器在 `tool_call_start` / `tool_call_result` 出站前用 core 的 `callViewOf` / `resultViewOf` 从活工具表解析视图并附在帧上（回放时对历史工具块做同一件事），浏览器侧零按名特判、零失败启发式。
  - **前端（`ui/` 子包，React 18 + Vite + Tailwind）**：状态归一处纯 reducer（`KernelEvent` 入、UI 块出），工具卡是 DOM-free 的纯渲染模型（`switch (view.card)` 六卡 × running/stale/ok/fail 四态），React 只做投影；markdown 走**元素树渲染**，全程无 `innerHTML`——XSS 靠构造不可能，而非转义正确。
  - **WebUI 完整化**：会话列表/切换/恢复、新建会话、compact 触发、上下文仪表（usage 分子 / models.dev 分母、断点配色）、审批档与执行模式切换（`state` 帧回声，避免"控件指着 A、状态栏写着 B"）。
  - 开发流：`NOVA_WEB_PORT` 固定端口，前端在 `packages/web/ui` 跑 `pnpm dev`，http/ws 全代理到后端。

### Patch Changes

- Updated dependencies [1b6376d]
- Updated dependencies [b6255b3]
- Updated dependencies [1e35cdb]
- Updated dependencies [1b6376d]
- Updated dependencies [42c1bfb]
- Updated dependencies [37ea5d6]
- Updated dependencies [1e35cdb]
- Updated dependencies [1e35cdb]
  - @nova-agent/plugins@0.4.0
  - @nova-agent/core@0.4.0
