---
'@nova-agent/qqbot': minor
'@nova-agent/plugins': patch
---

QQ 机器人：斜杠命令修复（@ 前缀 + 内核命令目录），连接生命周期加固。

**斜杠命令在群里完全不生效（真实缺陷）**。群消息的 `content` 由平台带着机器人自己的 mention 一起下发（`<@!bot_openid> /help`），于是这一行的第一个字符是 `<` —— 仓库里每个解析器都按首字符判断，命令因此被当成散文发给模型；单聊没有这个前缀，所以只在群里坏。现在 `parseInbound` 在**解码平台的那一处**剥掉**行首**的机器人 mention（句子中间的 mention 属于操作者自己写的话，不动）。

**`/compact`、`/goal`、`/mode` 以及任何第三方命令此前不可用**：遥控面是一张写在本包里的白名单，白名单之外一律回落成提示词。现在 `/…` 先在**内核的活目录**（`commands` 服务，`plugins/kernel-commands.ts` 的 `runCommandText`——与浏览器命令 runner 同一实现）里查；查得到就以命令执行并把输出发回，查不到才当提示词。目录按调用活读，所以插件行开关会同时改变聊天窗口与菜单里的可用命令，本包不再持有第二份名单。

**队列旁路收窄**（`remoteBypassesQueue`）。此前**所有**认得的命令都跳过每对端的串行队列；现在只有读与「解阻塞」的几条（`/approve` `/deny` `/status` `/help`）走旁路——旁路存在的唯一理由是那条死锁（一轮停在审批上，而答复排队就会排在自己等的那一轮后面）。`/perm` 改档、`/new` 开新会话、内核目录命令一律排队：一次 `/perm full` 不该去改**正在跑的那一轮**的裁量档。

**连接生命周期**（新文件 `gateway.ts` / `deadline.ts`）：

- `QqGateway` 每一步异步都由**连接世代**守护。一次拨号有两段 await（取网关地址、开 socket），另有一段取 token，`close()` 可以落在任何一段里——旧实现会让**被放弃的那次拨号**照样把 socket 装上去，于是一行插件关掉之后连接还活着；旧 socket 迟到的 `close`/HELLO 也能改到**当前**连接的状态。现在 `close()` 递增世代，迟到的 socket 被交还（关掉）而不是被收养。
- 同一条连接只 `close` 一次。`op9` 之后平台紧接着断 socket 会触发**两次** close，旧实现因此起两条重连链、各拨一次。
- `void resumeOrIdentify(...)` 补上 catch：token 失败或 `send` 抛错此前会成为**未处理 rejection**（Node 默认把进程带走），并留下一个「连着但没心跳」的哑通道。
- `chunkText` 校验 limit（0 或负数此前会 `i += 0` 死循环）；`parseFrame` 在解析阶段就要求是对象（`JSON.parse('null')` 成功，此前会从 socket 监听器里抛 TypeError）；`parseInbound` 同样拒绝非对象负载。
- 发送侧：2xx 但响应没有消息 id 不再算成功；先看状态码再读 body，于是**非 JSON 的 401** 也会作废 token（此前 `res.json()` 先抛，token 一直是坏的）。
- socket 打开、token、网关查询、发消息、BOT 身份都带墙钟上限（`withDeadline`，并把 signal 交给 fetch；被放弃的那一支挂上 catch）。
- `stop()` 变成**终态**：入站队列停止排空、被动窗口作废（那是代表本通道发送的凭据）、在飞的旁路答复不再发出。`running` 现在只说 `READY`/`RESUMED` 已到——socket 打开不等于能收事件。
