---
'@nova-agent/cli': patch
'@nova-agent/qqbot': patch
'@nova-agent/web': patch
---

**QQ 机器人：保存凭据后通道真的跑起来，并能用 QQ 遥控本机。**

### 保存后不用重启（阶段 A：此前「存了也白存」）

此前 `nova --web` 在启动时按**当时**的配置文件建好通道，随后设置页里保存凭据只是写盘——通道既不会重读、也不会拨号，必须重启。探针证据：空配置启动 → `save_qqbot` → roster 里仍是 `disabled`，`start()` 从未被调用。现在保存成功后壳做两步：先 `kernel.setPluginEnabled('qqbot', true)`（`advanced` 默认关，不打开就是一份躺着的工具注册），再 `bridge.start()` 重读刚写下的凭据并拨号（`QqBotRuntime.afterSave()`，顺序不可颠倒）。

插件对象**保持稳定**：它已在 roster 候选清单里，重建等于换 roster 身份。所以凭据走取值函数迟绑定（`CredentialSource = string | (() => string)`），`AccessTokenManager` 按凭据指纹判定——换过凭据自动丢弃旧 token，在飞请求只对同一对凭据单飞。同时 `start()` 幂等：重复保存不会叠出第二条 WebSocket，连接失败复位以便重试。设置页用 `running` 真实运行态画三态：未配置 / 已配置但未启动 / 运行中。

### 遥控对端（阶段 B：此前只能单向发消息）

此前 QQ 对端只能收到 agent 的 `qqbot_send`，人指挥不了本机。现在对端文本先过一个**纯函数解析器**（`qqbot-remote-parse.ts`，无 IO 可直测）：认得 `/status` `/perm` `/model` `/ws` `/new` `/approve` `/deny` `/help`，**认不得的一律原样当提示词**（与前端 `/` 菜单同一纪律，消息永不消失）。

每条指令复用内核既有接缝：权限档 → `AgentSession.setApprovalMode()`（读回确认落定）；审批 → 转发到 QQ 等对端回 `/approve`（**3 分钟超时必定拒绝**，fail-closed，与断连收敛同一纪律）；模型 → `Kernel.models.select()`；工作区 → `Kernel.setWorkspace()`；会话 → `Kernel.newAgentSession()`。遥控指令走串行队列**之外**的旁路——一轮可能停在审批上等人回答，答复也要排队就会死锁。词表已写进设置页 QQ 机器人指引卡。

### BYOK 首跑：保存的供应商文件可被重载

首跑 `saveProviders` 写出的 `provider` 镜像块缺 `model`（schema 必填），导致下次启动加载失败。镜像块现在保留旧值、缺省时填入所选供应商模型清单的第一项；`set_provider` 重定向 endpoint 时携带同一来源的模型 id。空配置 → 保存 → 不重启可对话 → 重启可重载，均有探针覆盖。

### 回看压缩摘要不再画成用户气泡

压缩摘要是 core 造的 user 角色消息（给模型读的历史），转写时掉进用户分支，回看旧会话会看到一条自己没说过的话。现在 `transcript.ts` 用 core 的 `isCompactSummary` 识别，画成 `context` 形态（`tag` 即 `[已压缩的上一会话摘要]` 前缀）；`trace.ts` 按事件类型走，本无此洞。
