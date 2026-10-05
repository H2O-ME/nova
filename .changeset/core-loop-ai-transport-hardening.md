---
'@nova-agent/core': patch
'@nova-agent/ai': patch
---

内核循环与 AI 客户端的一轮正确性加固：修 **10 处会导致错误回答 / 越权 / 持久化分裂** 的缺陷，全部配 killing test 并做过变异验证。

**AI 客户端（`@nova-agent/ai`）**

- **endpoint 在重试中途会漂移**：`stream()` 开头冻结 body（含 model），但 URL / apiKey / headers 每次重试都从可变 config 读——退避期间切供应商或模型，重试会把**旧 model 的 body 打到新 endpoint**。现在每次 stream 冻结 `RequestTarget`（baseURL / apiKey / model / sessionId），切换只影响下一次 stream。
- **headers 到达后 idle 预算被偷**：计时器在发起 fetch 前启动，headers 慢时 body 只剩残余预算（注释却声称 headers 后重臂）。现在收到 headers 后以完整 `timeoutMs` 重新 arm。
- **错误响应体无界**：非 2xx 后 timer 已 disarm 再调 `response.text()`，一个永不结束的错误体可以把客户端挂住。改为有界读取（64 KiB 上限 + 独立 deadline + 尊重 abort）。
- **坏 SSE 数据块被静默吞掉**：`JSON.parse` 失败直接 `continue`，损坏的中间块让残缺回答看起来完整。现在非空且非 JSON 的载荷报 `ProviderProtocolError`（可重试，重放比静默篡改诚实）；空 `data:` 字段仍跳过。
- **SSE 解析器加固**：按规范统一 LF / CRLF / **裸 CR** 行结束（含跨 chunk 拆开的 CRLF），并对单个事件设 8 MiB 上限。

**内核（`@nova-agent/core`）**

- **rewrite 可以绕过权限门（安全）**：审批门在链首按**原始参数**裁定，后面的 hook 返回 `rewrite` 后新参数被直接执行，从未被裁决。现在参数改写后会**重新走整条链**（改写直到定点：幂等改写器第二趟即收敛；永不收敛者 fail-closed 拒绝）。native 调用与 PTC 嵌套 dispatch 共用这条路径。
- **消息提交失败会让 live surface 与日志分裂**：`runAgent` 先 push 再让会话落盘，落盘失败时内存里有、日志里没有，于是下一次请求与一次 resume 对历史各说各话。现在提交失败会**回滚那次 push**（仅当它仍是队尾），并让该轮报 `run_failed`。
- **会话日志并发写会乱序、seal 挡不住已排队的写**：`appendEvent` 每次直接 `appendFile`，并发调用可能让文件顺序与内存顺序不一致；`seal()` 只在入队前检查，一次 `dispose()` 后仍可能有事件落盘（把被删的日志复活）。现在写入走单一 promise 链串行化，seal 在**临界区内重新检查**，并新增 `drain()` 供 `dispose` 等待在途写入。
- **compaction 与 run 可以并发**：手动压缩期间 `running === false`，此时到达的 prompt 会另起一轮，其请求被压缩的 `splice` 从数组里抹掉。现在 compaction 期间 prompt **排队**，`compact()` 结束后补跑；`startRun` 也会等压缩收尾。
- **并行工具进度会串行到别的行**：`lastToolCallId` 只有一个槽位，并行调用互相覆盖。现在 `onToolProgress(call, text)` 带上 call id，`tool_progress` 帧按真实 call id 归属。
- **监听器抛错会上报成递归**：`EventPump` 的报错回调向同一个 pump 发布 `listener_failed`，坏监听器再次抛错即递归。现在有重入守卫（一次原始失败只上报一次）。
- **修复规则按全局 id 配对**：provider 在后一轮复用同一 call id 时，前一轮的结果会把后一轮的调用标记为「已回答」，repair 漏补，下一次请求带未应答的 tool_call。现在按 assistant turn 顺序配对。
- **图片不进上下文预算**：`estimateMessageTokens` 只算文本与工具 schema，图片以 base64 进 wire 却按 0 token 计——估算「没超限」的请求仍可能撑爆窗口。现在每张图按保守常量计入（`IMAGE_TOKEN_ESTIMATE`）。

**有意不做的两项**（已核实，非缺陷）：`[DONE]` 仍是「传输结束即成功」的语义（本仓与全部测试夹具如此约定；空 `[DONE]` 的后果由 core 的空补全重试覆盖）；无法解析的 `Retry-After` 仍按自身退避重试（错误文本已点名解析失败，429 本身就该退避）。

测试：`packages/ai/test/{client,sse}.test.ts`、`packages/core/test/{agent,hooks,kernel,estimate,session-repair}.test.ts` 共新增/扩充 18 条断言；关键修复逐条做过变异验证（恢复旧逻辑即变红）。
