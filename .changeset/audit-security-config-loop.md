---
'@nova-agent/web': patch
'@nova-agent/cli': patch
'@nova-agent/ai': patch
'@nova-agent/core': patch
'@nova-agent/qqbot': patch
---

安全与配置闭环审计批（B/C/U 三簇，2026-10-05 批准实施）。安全 P1 与生命周期：

- **B01 路径规范化绕过（P1，真机复现）**：`/icons/..%2findex.html` 曾返回 200——decode 发生在判 `/icons/` 前缀之后，WHATWG URL 又把裸 `\` 折叠为 `/`。现在 `canonicalPath` 在判前缀**之前** decode 一次、拒绝 `\` 与控制字符、遇 `..` 直接判 undefined。
- **WS 换 `ws` 库**（经批准偏离「零第三方依赖」）：碎片状态机丢弃、upgrade `head` 字节未消费、UTF-8/close 校验、发送背压无上限——四条都是协议法则，归库；帧上限 1 MiB、发送缓冲 8 MiB 仍归本仓。
- **断连 fail-closed 收敛**：最后一名观者 detach 时对全部活句柄的挂起审批 deny、提问 cancel；运行中的 run 不中断（重连经 `ready` 重放）。
- controller 完整拆卸（dispose 链 + `listen.close` 先 await）、PTY 单飞取消锁、删非当前会话先拆句柄、route 注册表返回 disposer。

配置闭环（C 簇）：

- **首跑保存即生效**：web 壳改用 `switchableProvider`——占位 provider 的第一次 `setEndpoint` 从刚保存的文件重建真客户端，不再「存下了、重启才生效」。
- **`{env:NAME}` 单点展开**：`resolveStoredKey` 是磁盘 RAW 引用到请求密钥的唯一一步；env 未设置点名拒绝、零 fetch。切供应商/复测端点不再把 `{env:MY_KEY}` 当作密钥发出去。
- **provider 切换是一笔事务**：先拒绝性检查（无密钥 / env 未设——在写盘**之前**，否则文件会指向一个发不出请求、甚至下次加载即炸的端点），再持久化指针，再对在役客户端 `setEndpoint`（带该行自己的 temperature/maxTokens）。「已在役」比较的是**进程**应用的 id，不是文件里的 `activeProvider`；`save_providers` 落盘后自动应用未在役的指针。
- RAW 配置写入统一 schema 校验（写盘前拒）、镜像块整块重建（不再把上一端点的采样参数和密钥带给新端点）、模型目录活读 active provider、`tools` 顶层段删除（并入 bash 行 config，旧文件按未知键点名拒绝）、`--` 后一律位置参数、`plugins.entries` 拒绝重复 id。

前端（设置页与流）：

- 取模弹窗「全选」分母改为**可勾的**行（全锁定时不再出现点不动的「清空」）；供应商卡草稿保留**完整模型条目**（此前保存一次卡就抹掉每模型的覆盖字段）；保存改到宿主 `providers` 帧**到达后**才清草稿（写盘被拒时草稿还在）；删除当前供应商后指针显式重指到第一行。
- 流式合并缓冲设上限（500 帧）：隐藏标签页的 rAF 永不触发，原实现会在整个 run 期间无界增长。
- reducer 不再直接读时钟（`reduceEvent` 可注入 `now`），测试与回放可钉住时间。

QQ 通道与 SSE（另一车道同批）：

- F05 配对码未读回导致无限 mint + 重挂；F06 设置页保存白名单漏 `maxTier`（保存必失败）；F04 `maxTier` 约束对端自有会话（relay 刻意不动）；F08 结论改走回复预留、proactive 吃旁白额度；F22 SSE 单行上限。

每条修复配 killing test 并做过变异验证；`pnpm verify` 全绿（207 文件 / 2224 测试）。
