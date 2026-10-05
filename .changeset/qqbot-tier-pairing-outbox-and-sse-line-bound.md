---
'@nova-agent/qqbot': patch
'@nova-agent/ai': patch
---

QQ 通道的四条正确性缺陷 + SSE 解析器一条内存边界，均出自 2026-10 全仓审计的 P1。

**QQ 权限上限没有约束真实执行（`peers.ts`）**：`maxTier` 此前只在 `/perm` 分支裁量，所以它管的是**那个动词**而不是**执行**——主进程 `config.approval` 为 `full` 时，每个已绑定的 QQ 对端拿到的是 `full` 会话，操作者在设置页设的上限在对方打 `/perm` 之前什么也没做。现在对端**自己**的会话在**创建那一刻**按上限收紧（`capOwnedTier`）。**刻意不动 relay**：手机 `/use` 接到桌面会话时若顺手调低它的档位，就是远程上限污染桌面；按调用者裁量需要「上限随调用者走」（每调用一个 principal），本通道还没有，故 relay 一档保持原样并写在这里。

**配对码每次激活都重新生成（`plugin.ts`）**：组装 `settings` 时漏了 `pairingCode`，于是 `policy.pairingCode` 恒为 undefined，`ensurePairingCode` 每次激活都 `mintPairingCode()` 并把新码 `setEntry` 写回配置——配置一变就 reroster，reroster 又跑 `apply`，又 mint……**只要凭据可用就是无限写盘 / 重挂 socket 的死循环**。现在把行里存的配对码读回，只在真的没有时才 mint 一次。

**设置页保存必失败（`settings.ts` / `plugin.ts`）**：页面无条件渲染 `maxTier` 字段，保存白名单却只收 `appId`/`clientSecret`，而真实页面提交的是**整份 draft**，于是每次保存都被 `unknown setting "maxTier"` 拒绝（`测试连接` 同样）。`maxTier` 纳入白名单，`mergeSettings` 改为返回**完整设置**：表单拥有的键取自提交、其余（`owners` / `pairingCode`）原样带过——旧实现只回两键，保存后页面会把已绑定设备报成「还没有绑定任何 QQ 号」。

**结论会被旁白额度吃掉（`peers.ts` / `outbox.ts`）**：一轮的结论经 `notify → outbox.narrate` 发出，而 narration 额度（3）刻意低于回复额度（5），于是旁白用尽后**正是对方要的那条结论被丢**；同时模型自己的 `qqbot_send` 走 `reply`（5），可以花掉为回复预留的额度。现在结论由 `run()` **返回**，交给通道的 reply 座位（花预留额度）；`proactive` 改吃 narration 额度，动不了预留。

**SSE 未结束行无上限（`ai/src/sse.ts`）**：事件上限只累计 `data:` 载荷，一个从不发换行的流（或一个超大注释）会让解析器的 `line` 无限增长且永远碰不到事件上限。新增 `MAX_SSE_LINE_CHARS`，在行累计处即判界。

直测：`qqbot/test/peer-commands.test.ts`（自有会话被收紧、relay 不被降档、结论走返回值）、`qqbot/test/plugin.test.ts`（读回已存配对码不重写、首次入网只 mint 一次、按页面真实字段保存成功、保存不把已绑定设备报成未绑定）、`qqbot/test/outbox-answers.test.ts`（主动发送吃不掉预留）、`ai/test/sse.test.ts`（未结束行超限即抛）。每条均已做变异验证（改回旧行为必红）。
