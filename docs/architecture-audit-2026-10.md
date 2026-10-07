# NovaAgent 架构审计与重构审批计划

状态：只读审计结束；修复已分批落地（见 §0 对账），余项归入 Nova 0.5.0 重构轨道。

## 0. 修复对账（2026-10-07）

- `5d8909d`：F05、F06、F08、F22，F04 的自有会话半边，F09/F10（WS 换用维护中的 ws 库），F13（route disposer），F19 的保存事务/元数据/草稿半边，F11 的 controller 拆卸与 PTY 取消锁半边。
- `2fc407a`：F18/F20 的前端请求代际与过期答案丢弃半边。
- `1cefc10`：F01 主体——runId/principal 进 scope、子代理继承父会话 scope 并剔除状态工具、审批门对空 scope fail-closed。
- Nova 0.5.0 Batch 4：F17 主体——三个扩展包改 optional、web 摘除 plugin-context 静态边；含 F15 的 disposer 异常不再静默吞半边。
- 2026-10-07：F01 最后一条尾巴——nested run 透传 `cacheDir`，超限工具结果落父会话溢出目录而非全局根。
- **仍未做**：F02 全量、F03、F04 relay 半边——三者与 Run/ExecutionScope 是同一件事，已归入 `NOVA-0.5.0-REFACTOR.md` 的 Batch 2A/2B/5 领地，不在此轨道单干；其余未列条目仍开放，按 §8 路线另行排期。
- §3–§6 的行号按审计当日（含未提交改动）取证，与后续 HEAD 会漂移，以各修复提交的 killing test 为准。

## 1. 范围与证据口径

审计对象是 D:/web/agent 当前工作区，包括大量既有未提交修改，而非 HEAD。原修改未覆盖、未回退。本次不修改生产代码或测试；仅新增此报告。

覆盖 core/plugins/ai/CLI 的主要生产链，QQ/三个扩展包、Web 后端/前端的关键链路、包依赖与测试门禁。文件清单扫描不是逐行审查完成的证据。本次未逐行穷尽约 499 个 TS/TSX 源文件，三个子代理依用户要求提前停止；不能保证“找出了所有问题”。下列分别标记运行时复现、静态确认、待验证风险。UI 视觉、QQ 真平台、真实 provider 网络行为、发布包缺席安装矩阵尚未实测。

已执行验证：

| 检查 | 结果 |
| --- | --- |
| dependency direction | 9 个包通过 |
| structure budget | 490 个受检源文件通过 |
| oxlint | 0 error / 96 warnings，扫描 727 文件 |
| Vitest | 205 个测试文件 / 2202 个测试通过，61.06 秒 |
| Node / pnpm | v25.6.1 / 10.33.0 |
| UI TS/TSX 规模 | 230 文件，32018 非空行（不含 CSS） |

命令：`node scripts/dep-direction.mjs`、`node scripts/structure-budget.mjs`、`pnpm exec oxlint packages`、`pnpm exec vitest run`。未运行 build/typecheck/verify，避免审计阶段重建现有产物；测试基于源码 alias，不能据此声称产物发布路径通过。

三项内存探针已实际执行，无源文件编辑：

- 父 scope interceptor 返回 v=2，`parent.scope({})` 却返回根服务 v=1。
- 同一 effect disposer 调用两次，副作用执行两次；随后 fiber.dispose 还执行另一个 effect。
- SSE 超过 8 MiB 的未结束行被消费后仍未触发大小异常；若输入结束才在 handleLine 检查到超限。
- 持久化 validator 接受未知 message role、goal=42、todos=[null]、keep=[-0.5]。

## 2. 总体判断

不是所有代码都应推倒重来。provider 无关循环、事件流、会话提交前落盘、审批每会话 broker、插件 effect、动态 module spec、活 roster 等已经形成可保留的基础。

主要问题不是“文件数量多”，而是以下所有权尚未统一：执行会话与 UI current 混用；进程级 provider/root 与会话级状态混用；异步资源没有统一 generation/销毁协议；前端请求没有明确关联成功与失败；插件声明、配置、设置页存在独立表与手写投影。若先机械拆文件而不修这些问题，复杂度只会分散到更多文件。

“零上游”不等于 core 内聚：当前 core 还包含 git/clone、目录浏览、图片存储、subagent 工具实现等产品能力。是否迁移应依据消费者/所有权，而非为了让扩展包只依赖 core 把实现持续搬到底座。

## 3. 高优先级问题

### F01 执行 scope 未贯穿子代理与其他钩子（P1，静态确认）

证据：[subagent.ts:133](../packages/core/src/tools/subagent.ts#L133)、[permission-gate.ts:53](../packages/plugins/src/permission-gate.ts#L53)、[plugin-services.ts:48](../packages/plugins/src/plugin-services.ts#L48)。

子代理 nested runAgent 没传 sessionId/jobs/emit/cacheDir；复用父 hook 时审批 scope 为空，permission gate 回落 kernel engine。父会话只读而 kernel full 时存在越权路径；kernel 较弱时也会造成错误拒绝/发到没人接收的 broker。子代理进度通过 current 发布，A 后台运行、B 被选中后进度归属 B。

修复：显式 RunContext/ExecutionScope，继承权限主体与 job owner；对子代理的 todo/goal 等状态工具制定“子会话独立状态或明确剔除”策略，不能因缺 emit 静默假成功。

### F02 goal/压缩/命令仍按 current 路由（P1，静态确认）

证据：[runtime-builtins.ts:106](../packages/plugins/src/runtime-builtins.ts#L106)、[goal.ts:261](../packages/plugins/src/builtin/goal.ts#L261)、[runtime-roster.ts:87](../packages/plugins/src/runtime-roster.ts#L87)、[peers.ts:127](../packages/qqbot/src/peers.ts#L127)、[kernel-commands.ts:123](../packages/plugins/src/kernel-commands.ts#L123)。

goal hook 用 current goal；write 回调没有返回 announceGoal promise，hook 的 await 不保证写入结束。headless compact target 用 current，而待压缩 messages 可能来自另一会话甚至 nested run。QQ 命令在 agentFor 前执行，/compact、/goal 可操作上一 peer/桌面。

修复：请求/命令上下文携带 sessionId；将轮内 compact 放回每会话 CompactionRunner，而非共享 hook 闭包选择 current。goal 计数需明确“LLM 请求轮”还是“跨 run 续跑轮”，不能一处注释跨 run、另一处每 request 递增。

### F03 工作区与缓存亲和仍是进程级可变状态（P1，静态风险，需并发复现）

证据：[runtime-session.ts:44](../packages/plugins/src/runtime-session.ts#L44)、[runtime-workspace.ts:39](../packages/plugins/src/runtime-workspace.ts#L39)、[services.ts:179](../packages/plugins/src/services.ts#L179)。

所有会话读同一个 env rootDir；切换工作区会改变其他会话后续 run 的 root、docs、skills。provider affinity 在 activate 时改全局 client sessionId，虽 stream 内冻结 endpoint，但后台 A 的下一请求可能携带 B 的 affinity。需要区别当前已有请求安全与下一次请求安全。

修复：会话持有 WorkspaceSnapshot/RunSnapshot；ChatRequest 携带 sessionId/模型目标/能力，而不通过 activate 修改 provider 的请求身份。provider 全局切换可以保留为产品选择，但必须明确只影响下一请求并通知所有相关消费者。

### F04 QQ maxTier 并未约束真实执行（P1，静态确认）

证据：[peers.ts:310](../packages/qqbot/src/peers.ts#L310)、[runtime-session.ts:91](../packages/plugins/src/runtime-session.ts#L91)。

cap 仅检查 /perm，QQ 新会话权限来自主 config.approval。主档 full、QQ cap read-only 时真实工具仍可 full。/use 接桌面高权限会话也未加入 caller cap。

修复：权限按 session policy 与 caller/channel cap 取交集。relay 不应直接调低桌面会话档位，否则远程 cap 污染桌面；应将 cap 附着发起请求的 principal，子调用继承。

### F05 QQ pairingCode 未从 config 读入（P1，静态确认；无限重载需集成复现）

证据：[plugin.ts:188](../packages/qqbot/src/plugin.ts#L188)、[plugin.ts:261](../packages/qqbot/src/plugin.ts#L261)。

settings 没复制 config.pairingCode，policy 却从 settings 读；activation 生成新码、setEntry 引发 reroster，下一 activation 又认为无 code。可能持续旋码/写盘/重挂 socket。

修复：配置 normalize 一处定义；持久化初始化幂等、完成后再启动通道，避免 activation 自写配置导致自重载循环。

### F06 QQ 设置页面与保存字段不一致（P1，静态确认）

证据：[settings.ts:50](../packages/qqbot/src/settings.ts#L50)、[settings.ts:121](../packages/qqbot/src/settings.ts#L121)、[plugin.ts:572](../packages/qqbot/src/plugin.ts#L572)。

页面含 maxTier，但 setting key 白名单只允许两个凭据字段；通用页面提交字段后 save/test 会报 unknown maxTier。现有测试只分别断字段存在与手写保存 payload，不测试真实页面到保存闭环。

修复：同一 schema 产生字段/校验/patch；测试用真实 descriptor 构造提交，验证 cap 保存与实际执行。

### F07 QQ 保存会泄露 env secret 引用（P1，静态确认）

证据：[plugin.ts:499](../packages/qqbot/src/plugin.ts#L499)、[plugin-services.ts:129](../packages/plugins/src/plugin-services.ts#L129)。

mergeSettings 将 activation 展开后的 secret 带进保存 patch，未使用 readEntry 保留原始引用。保存 AppID 等不相关字段也可能把 env 引用改成明文。

修复：仅提交被编辑字段；省略保持，null 删除，原样读取与运行配置分离，日志/响应禁止密钥。

### F08 QQ final 仍走 narration，主动发送能吃掉预留（P1，静态确认）

证据：[peers.ts:136](../packages/qqbot/src/peers.ts#L136)、[plugin.ts:241](../packages/qqbot/src/plugin.ts#L241)、[outbox.ts:144](../packages/qqbot/src/outbox.ts#L144)。

final 使用 notify，而 notify 调 narrate；累计旁白额度用完后结论被拒。proactive 复用 reply，可消费全部总额度。回复窗口按调用时最新 msg_id 查，尚需测试后续 /answer 到达后本轮结论究竟属于哪个窗口。

修复：outbox 明确 accepted/progress/question/final/tool-send 类别；final await 真发送结果，非 final 不可花预留；消息窗口成为 turn-owned token，不靠 peer 最新槽猜测。

### F09 WebSocket 未校验 Origin，握手不完整（P1，静态确认；浏览器攻击未实测）

证据：[server.ts:223](../packages/web/src/server.ts#L223)。

仅 cookie 检查，无 Origin/Host/Version/规范 key 校验。host-only cookie 跨端口，同站本地另一端口页面可尝试建立 WS；SameSite Strict 不能代替 origin 检查。不是“任意互联网页面都能绕过 cookie”的结论。

修复：绑定的 scheme/host/port Origin allowlist；开发代理 origin 显式可配置。验证 method、Upgrade、Connection、Version=13、16-byte key；拒绝非法请求。

### F10 WS 首帧、协议与背压不完整（P1/P2，静态确认）

证据：[server.ts:223](../packages/web/src/server.ts#L223)、[ws.ts:115](../packages/web/src/ws.ts#L115)、[ws.ts:165](../packages/web/src/ws.ts#L165)。

_head 被丢弃；fragment 中接受新 text 覆盖旧消息；未知控制码被忽略；非法 UTF-8 替换；close payload 未充分校验；send 忽略 socket.write 返回值，慢客户端/PTY 高流量积累内存。

修复：推荐采用维护的 ws 实现，保留应用认证、大小/发送队列/慢客户端策略。若坚持零依赖，则需单独完整 RFC parser 与协议 fuzz，不能仅补几个 if。

### F11 资源销毁与迟到 spawn 缺少 owner/generation（P1，静态确认）

证据：[controller.ts:175](../packages/web/src/controller.ts#L175)、[term-session.ts:249](../packages/web/src/term-session.ts#L249)、[term-session.ts:285](../packages/web/src/term-session.ts#L285)、[runtime-facade.ts:97](../packages/plugins/src/runtime-facade.ts#L97)。

controller.dispose 仅关闭 clients/jobs，没有关闭 terms；kernel.dispose 仅 host.dispose，不统一关闭所有 session/run/jobs。term dispose/retainOnly 不处理正在 spawn 的 promise，切换/kill 后迟到 PTY 可复活。

修复：host owns kernel；surface owns surface resources。dispose 完整幂等可 await；spawn generation invalidation；所有 output 带 session owner，停用后不可发布。

### F12 删除非 current 运行会话会复活日志（P1，静态确认）

证据：[session-frames.ts:109](../packages/web/src/session-frames.ts#L109)、[controller.ts:277](../packages/web/src/controller.ts#L277)。

仅 deletingOpen 才 dispose；切走 A 仍运行、current B，删除 A 直接 unlink，A writer 下一 appendFile 重建日志。

修复：SessionRepository.delete(file) 查所有活 writer，tombstone/seal/abort/drain/jobs/PTY 后 unlink。测试真正继续释放 A provider/tool，断文件不会复活且 B 不受影响。

## 4. 插件与容器问题

### F13 route registry 无 disposer（P2，静态确认）

证据：[route-registry.ts:21](../packages/web/src/route-registry.ts#L21)、[capabilities.ts:523](../packages/core/src/plugin/capabilities.ts#L523)。

register 返回 void、append-only，旧 handler 在插件 off/reload 后残留。修复为 owner-aware register 返回 disposer，插件通过 ctx.effect 安装。测试先加载/访问，再卸载/404；重复 reload 数量稳定。

### F14 空子 scope 丢 inherited interceptor（P2，运行时复现）

证据：[context.ts:240](../packages/core/src/plugin/context.ts#L240)。

interceptor 使用原型继承，但 Object.keys 仅看自有键；空子 scope 被设为 undefined。修复：保留继承链与明确最近 scope 语义。

### F15 disposer 不是 single-shot，fiber 异步代际仍有风险（P2，部分运行时复现）

证据：[fiber.ts:91](../packages/core/src/plugin/fiber.ts#L91)、[fiber.ts:196](../packages/core/src/plugin/fiber.ts#L196)、[fiber.ts:221](../packages/core/src/plugin/fiber.ts#L221)、[fiber.ts:268](../packages/core/src/plugin/fiber.ts#L268)。

返回 disposer 重复调用重复执行已复现。另静态风险：dispose 未统一排在 tail 上；异步 Config validate 完成后 runBody 未检查 attempt/disposed；fail 在 await teardown 前捕获 current，后续 settle 可能使用过期状态。文档“refresh/replace/remove/dispose 全部一条队列”与实现需复核。

修复：activation scope per-attempt，取消信号、single-shot disposer、teardown join；每个 async 完成点检查 generation。必须用 deferred promises 复现，而非多加 sleep。

### F16 安装 probe 与依赖注入行为不一致（P2，静态确认）

证据：[plugin-probe.ts:27](../packages/cli/src/plugin-probe.ts#L27)、[fiber.ts:122](../packages/core/src/plugin/fiber.ts#L122)。

probe 只建 toolbox 却 apply 任意插件；真实插件 inject sessions/llm/pluginConfig，must 会失败而不是等待。注释说缺服务 pending 可通过，但 fiber 实际执行 body 并失败。timeout race 的 finally 又 await host.dispose，在 loader 串行等待未结束 apply 时可能仍挂起。

修复：安装时只验证 manifest/API/schema/包产物；运行诊断在真实宿主能力存在时验证。需要活性 probe 则使用独立进程+期限，明确缺能力不是插件坏。

### F17 声称可选缺席，但发布依赖仍硬连（P2，静态确认）

证据：[plugins package](../packages/plugins/package.json#L19)、[web package](../packages/web/package.json#L20)、[cli package](../packages/cli/package.json#L23)。

扩展只依赖 core 的方向成立，但 plugins 静态 package dependency 仍带三个实现包；web 静态 import/依赖 context；cli 静态 dependency 带 QQ。动态 import 不自动等于安装可选/可独立升级。用户示范 QQ 仍因产品专用 surface/服务与 manifest 关联有所特殊待遇。

修复：区分 product bundle/shipped inventory 与 runtime mandatory dependencies；独立 plugin API version/core compatibility；可选包缺席打包、安装和启动矩阵。web 使用 context capability/read-only utility，不静态依赖可缺席插件实现。

可信进程内插件拥有宿主权限是明确模型，不将其当成隔离沙箱漏洞；独立进程安全插件另立项目，不默认加入本次重构。

## 5. UI 与状态问题

### F18 错误不结束所有请求/开关（P1/P2，静态确认）

证据：[state.ts:1030](../packages/web/ui/src/state.ts#L1030)、[use-flip-feedback.ts:51](../packages/web/ui/src/settings/use-flip-feedback.ts#L51)、[use-manage-refusal.ts:71](../packages/web/ui/src/settings/use-manage-refusal.ts#L71)。

generic error 仅清少数 pending；files/catalog/probe/picker/directory/plugin request 可永久 loading。flip hook 只有成功 snapshot 才清 switching，拒绝时仅 refusal waiting 清除，busy 仍在。并发不同请求共用一个 manageError 不能可靠归因。

修复：所有 request 带 id/kind/generation，成功/错误同一 settle；busy 属于 reducer request state，组件不维护另一套。真实 interaction test 验证拒绝后可再次操作。

### F19 Provider 保存有并发覆盖、元数据丢失与失败丢草稿（P1/P2，静态确认）

证据：[ProviderSection.tsx:121](../packages/web/ui/src/settings/ProviderSection.tsx#L121)、[ProviderSection.tsx:237](../packages/web/ui/src/settings/ProviderSection.tsx#L237)、[ProviderSection.tsx:253](../packages/web/ui/src/settings/ProviderSection.tsx#L253)。

model 对象投影成 id 字符串后再重建，手写能力元数据可能丢失，需与后端 writer 逐字段确认。保存 A 响应未回又保存 B，旧 stored 全列表覆盖 A；文件级串行队列不能解决旧快照写回。send 后立即清 draft，失败时编辑丢失。

修复：provider 单行 patch，模型元数据单独 owner；server revision/CAS；确认成功才清草稿，失败保留并就地提示。测试 roundtrip 手写 metadata 与 A/B 并发。

### F20 plugin page/request 与 client bundle 代际不充分（P2，静态确认）

证据：[state.ts:852](../packages/web/ui/src/state.ts#L852)、[client-loader.ts](../packages/web/ui/src/client-loader.ts)。

plugin answer 只按 plugin 覆盖，缺请求 id/operation 校验；旧页面迟答覆盖新页面。bundle pending 在 injector 之后登记；按 name 缓存忽略 rev。

修复：请求 reducer 拒绝过期响应；bundle cache name+rev，pending 先发布，失败/更新/卸载清理。

### F21 shared pagination 与 reducer 非确定性（P2，静态确认，待集成复现）

证据：[controller.ts:185](../packages/web/src/controller.ts#L185)、[controller.ts:372](../packages/web/src/controller.ts#L372)、[session-pages.ts](../packages/web/src/session-pages.ts)、[state-events.ts](../packages/web/ui/src/state-events.ts)。

ready 重新 cut 进程级 pages，另一个客户端 attach 可改变已连客户端历史游标；需用双 client 加新消息复现。reducer 用 Date.now，重放同事件序列结果不同。

修复：历史分页使用无状态 cursor（session id+event seq+projection generation）；时间来自协议/action producer，领域 reducers 保持纯函数。

## 6. AI、持久化、质量与测试

### F22 SSE 无界未结束行（P1/P2，运行时复现）

证据：[sse.ts:65](../packages/ai/src/sse.ts#L65)。

event cap 在换行后累计，line += ch 仍可无限长；comment/unknown field 也能增长。修复 line/event bytes 双界限、增量检查，测试流尚未结束就触发异常并取消 reader。不将当前明确接受 [DONE] 的协议选择作为回归修复。

### F23 durable validator 不验证完整事件（P2，运行时复现）

证据：[session-event-schema.ts:17](../packages/core/src/session-event-schema.ts#L17)。

接受 unknown role、非法 goal/todos/compaction keep；未完整检查工具调用/usage/stats/approval。修复 durable boundary 完整 schema，未来版本/未知事件处理明确，不能把未知 mandatory 数据静默当损坏丢掉。v1/v2 迁移与尾部修复必须保持可读与可审计。

### F24 架构门禁不足且文档有漂移（P2/P3，静态确认）

证据：[dep-direction.mjs:81](../scripts/dep-direction.mjs#L81)、[structure-budget.mjs](../scripts/structure-budget.mjs)、[nova-dev skill](../.agents/skills/nova-dev/SKILL.md)。

依赖 gate 正则扫描全文件包名，注释是假阳性；相对跨包、未列新包、非 scope import、浏览器 Node API、内部循环和 exports/manifest 不校验。UI 按 web 白名单可 import plugins 实现，不符合 browser-only 面。skill 仍声称 UI 没有预算/依赖检查，现有脚本已覆盖，文档冲突。

修复：TS AST/module resolution gate；host/client 分面；package manifest/exports/peer兼容校验；行数预算只做粗护栏，不能反复 raise 代替职责拆分。机制事实一处，历史修复记录移出超长权威文档。

### F25 不是“测试多所以过度测试”，而是断言与风险不匹配（P2）

现有测试有价值，不建议按数量删减。已见空绿例：QQ descriptor 包含 maxTier，但 save 用手写两字段 payload；Web background isolation 测试只检查初始空集合/registry；resume deleted 测试允许 ready 作为成功条件；UI SSR 无 DOM 不执行 effect/点击状态，因此开关拒绝后 busy 不被发现。

修复：每项缺陷配最小 killing test，并真的暂时恢复旧行为验证红；关键 UI 加少量 DOM interaction 与 Playwright 真实闭环；协议/纯函数保留快速单测；去掉不启动目标行为/只验证 fixture 的测试。不得为追求 100% 覆盖率加入低价值重复断言。

## 7. 目标架构

保留现有包布局作为第一阶段基础，不直接改成几十个小包。先形成以下职责：

1. `core/runtime`：run/session 状态机、ExecutionScope、模型与工具纯协议，所有执行动作显式 session/principal。
2. `core/plugin`：通用容器、依赖 readiness、activation generation、effects/disposers；不认识 QQ/Web/PTC 名称。
3. `core/session`：日志 codec/schema、单 writer、投影、repository/lease/tombstone。
4. `plugins`：默认 providers/tools、composition root。壳调用 createAgentKernel 一次的现状保留，但“一个装配调用点”不等于“只有一个会话或隐式 current”。
5. `ai`：request-scoped provider identity、SSE/retry/transport；模型网络协议验证在这里。
6. `extensions`：各自 manifest/schema/权限/工具/RPC/客户端 bundle；只依赖公共 API，发布缺席矩阵可验证。
7. `surfaces`：web/QQ/REPL/exec 对等；surface owns transport/resources，session owns execution；CLI owns process lifetime/config/discovery。
8. `web/client`：版本化应用帧、领域 reducers、request ledger、纯 view models；组件不再维护第二份请求真相。

建议 ExecutionScope 包含 `sessionId/runId/principal/channelCap/abortSignal`；RunSnapshot 包含 workspace/provider/model/tools/hooks 的本轮身份。具体最小字段由实际调用者决定，不为了未来功能提前堆接口。

Commands 接收 `CommandContext { sessionId, rootDir, principal, log }`。LLM/before、tool/before、turn/before-end、progress/audit 都有 scope。选择 current 与执行 activate 分离；surface selection 不修改执行事实。

## 8. 实施路线与验收

### A. 修安全与所有权，不先机械拆文件

- 统一 ExecutionScope：主循环、nested agent、tool/PTC dispatcher、goal、compact、commands/jobs。
- 以 session policy ∩ caller cap 裁权限，修 QQ relay/new session。
- 修 QQ pairing/settings/secret/outbox，启动准备 await bindings load；检查早消息不能覆盖持久 binding。
- 修 WS origin/handshake/_head/parser/backpressure。
- 统一 kernel/session/term dispose 与所有会话删除；generation 阻止迟到资源复活。

验收：真 kernel A/B 并发、切换、子代理、QQ relay、非 current 删除；攻击性 handshake/slow client；测试旧行为变异必红。先做可信本地 fake transport，不改真实用户配置。

### B. 请求协议与 UI 可靠性

- 统一 request id/generation 与 success/error settlement，拆领域 request slices。
- Provider patch+revision，失败保留草稿；model metadata roundtrip。
- plugin page/bundle 代际；分页无状态 cursor；timestamp 由 action producer 提供。
- 拆 state/App/ProviderSection/frame router，避免重构时顺带改样式。

验收：DOM 点击/错误/再次尝试、两张 provider 卡并发保存、旧 RPC 迟答、双浏览器重连分页、桌面与移动 Playwright。视觉问题另以实机量测证据，不据 CSS 猜测。

### C. 容器与持久化

- single-shot async disposer、teardown join、per-attempt generation；处理 missing inject readiness。
- scopes/interceptors 完整继承与 owner-aware registry。
- durable 完整 schema、未来版本拒绝策略、日志修复/投影一致性；writer ownership/tombstone。
- 安装 probe 改声明验证与独立限时活性诊断。

验收：deferred async schema/apply、provider replacement/dispose race、double disposer、scope nesting、恶意 JSONL、append after delete。新增问题通过 focused test，最后全量 verify。

### D. 真正独立插件发布

- product bundle 清单与 runtime dependencies 分离；可选包不成为 mandatory implementation edge。
- 移除 Web 到可缺席 context 实现的静态边，公共纯分析 utility 或按服务请求分析。
- 插件 API compatibility/core peer dependency/client bundle version/schema/权限声明。
- route 返回 disposer；第三方模板、独立包 build/test、干净 artifact consumer。

验收：不安装 QQ/三个扩展仍能 core/web/exec 启动；单独 npm 安装第三方插件成功；不兼容明确失败且不影响其他行；off/reload 后能力与 route/bundle 真消失。

### E. 门禁、测试与文档治理

- 按风险整理测试，修空绿，不按数量砍测试；contract/unit、kernel integration、browser、artifact lanes 分开。
- AST 依赖/host-client/manifest/export/循环门禁；复杂度 warn 分类收敛。
- 架构事实压缩 AGENTS，历史移至缺陷账本；同步 skill、changeset、升级指南。

验收：`pnpm verify`，lint 0 error，新增 warnings 不增加；source-plane 与 artifact-plane 分开；Windows/Linux 运行范围明确。

## 9. 审批事项与迁移约束

建议批准 A→B→C→D→E，不批准无目标的全仓重写。需用户确认：

1. 允许 core hooks/commands/ChatRequest 的破坏性 API 调整，同步所有消费者。
2. QQ cap 按 caller 约束 relay，默认不降低桌面会话自身权限。
3. 建议采用维护的 WS 实现；若必须零第三方 WS，另给协议完整性和性能验收预算。
4. 允许 provider 全量替换帧改为 patch+revision；旧前端通过协议版本明确拒绝或迁移。
5. 可选插件改变发布依赖形态；保留产品默认发行体验，但独立开发不得要求编辑宿主源码。
6. 默认不引入不可信插件安全 sandbox，不扩大本次范围为新安全运行时。

持久化日志是用户数据：破坏性代码权限不等于可删除数据。所有协议迁移先建立真实 v1/v2 fixture、保留旧格式读取/明确升级策略，写回前备份；不得 silently drop mandatory events。真实 ~/.nova/config.json 不修改。已有 dirty 修改不回退；重叠变更先复读并合并。

## 10. 结束状态

审计与计划已提交；修复落地状态以 §0 对账为准。计划工具在当前会话返回“仅计划模式可用”，不能据此声称系统已切换模式。本报告作为完整审批稿；收到明确批准后才按阶段动手。未实测的攻击/并发候选首先补复现测试，复现失败则降级/移除发现，而不为迎合报告强行重构。
