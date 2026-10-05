---
'@nova-agent/web': patch
---

WebUI 前端可靠性批（U03/U04/U06/U07/U08/U10/U11 七项，2026-10-05 授权实施）。每项一条 killing test，变异验证（回退修复→红）九条全过。

- **U06 connected ≠ ready**：socket 打开不再点亮界面——`ws.onopen` 里的 `connection {connected:true}` 派发删除，Action 类型收窄为字面量 `connected: false`（想造「开着就算可用」是编译错误），`connected` 只由 `ready` 归约点亮。开着但未附着的 socket 什么也答不了，不该解锁任何一个控件。
- **U04 发送失败草稿还原**：`submit()` 乐观清空草稿后，reducer 记账「echo 等待」——`sent`（prompt/command）置 `awaitingEcho`，内核回声（`user_message` / 命令 `run` 行；排队 prompt 也先提交后排队所以同样即时回声）落定为已送达，`error` 帧先于回声到达即 `sendRejected` 计数并清等待；composer 收到计数变化把被拒草稿还原并提示「发送被拒绝，草稿已还原」。计数器而非布尔：同一文本被拒两次也是两次可观测事件。
- **U03 发送判定单源**：主按钮 seat 与 `submit()` 现在读同一份 `sendGate` 裁决——seat 曾被喂硬编码 `uploading: false`，图片上传中按钮看着能发、点了却什么都不发生。空稿/上传中/就绪各一条裁决，图片算内容（纯图 prompt 合法）。
- **U07 插件请求 id 与过期答案**：correlation id 从每挂载计数器改为**页面级单调源**（`settings/plugin-request-id.ts`），reducer 的 `plugin_answer` 丢弃比已存最新 id 更旧的迟到答案——重开页面后，上一挂载的慢回复不再覆盖新页。原注释声称「reducer 按 plugin AND id 匹配」从未为真（声明与实现相反），一并改写。
- **U08 页面描述符校验**：插件自带的 `page` 描述符跨 JSON 与插件边界，渲染器却直接 `fields.map`/`options.map`——畸形载荷会把设置面板整个炸掉。新 `parsePageDescriptor` 在渲染前重校验：该 fail-closed 的（渲染器要索引的集合）点名拒绝，只打印的容忍（未知键、越界 tone 画中性点）；不合法载荷渲染成带原因的失败卡片而非异常。
- **U10 未保存修改守卫**：插件设置页的dirty 状态（草稿 ≠ 描述符播种值，含新增/删除键）上报设置面板，切节/关面板先弹确认——留在本页（autofocus 落在安全侧）/放弃修改并离开。离开确认弹窗 portal-free body 导出，静态车道直测。
- **U11 GoalEditRow 补 IME 守卫**：目标行编辑是最后一个裸 `Enter` 提交——输入法组字中的 Enter 会误存目标。复用 `composer-keys.ts` 的 `composing()` 谓词（isComposing / keyCode 229 / 宽限窗），与 InputBar、审批/提问面板同一套。

其余两项以证据了结：**U02 行 key 稳定性未复现**（逐个铸造点核查：会话行 `item.file`、分组 `group:<path>`、流式行 block.id、回合头 `turn:<id>`、任务 `job:<id>`、子代理 `sub:<label>`——全部稳定派生，无索引/序号 key）；**U05 重连已实现**（`client.ts` 的 `nextRetry` 指数退避 500ms→5s + 手动重试合并，`client-retry.test.tsx` 已钉）。
