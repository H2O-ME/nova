---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
---

**内核：工作区切换的上下文重播种下沉到内核，把「换项目后仍注入旧文档」从每个 surface 的职责变成一个机制。**

**问题。** 上下文片段（env cwd、AGENTS.md 链、技能索引）在**会话创建时追加一次**，而日志 append-only。空白会话换工作区后，它的首条提示词仍然发送**旧**工作区的 `cwd=` 与 AGENTS.md——用户报的「我切了项目，它还是注入错的项目文档」就是这个。三条移动路径（Web 的 `set_workspace` 帧、REPL 的模型侧 `switch_workspace` 工具、任何未来路径）都各自需要这一半，而此前**一条都没做**：REPL 那条只改根、不重播种。

**修法。** 逻辑移到 `plugins/src/runtime-workspace.ts`（`setWorkspace(env, dir)`），三个 surface 共用：

1. `reroster()` 重建 host，重载新根的 AGENTS.md 链与技能索引；
2. 追加 `workspace` 标记（会话按日志里**最新**标记归档，纯 log-only，不进模型面）；
3. **仅当会话是空白时**替换它，让首条提示词用新工作区构建片段。`isBlankSession`（没有任何用户角色消息）是判据——用户还没说话，所以没有东西会丢；已有真实轮次的会话保留其片段，那才是那些轮次实际运行位置的真实记录，改写它正是 append-only 所禁止的。

两种情形**故意不替换**：①目标目录与当前根相同（resume 会恢复会话自己的工作区，是常见路径，每次白造一个日志会让侧栏每次多一行）；②**被 resume 的空白会话**——它的日志是读者选择打开的耐久产物，替换等于悄悄丢弃该选择，并让读者的 `ready` 指向一个他从没要过的日志。

**顺带修掉三个真 bug：**

- **resume 被丢弃**：上面的情形②在实现中曾经缺失，`setWorkspace` 会把刚 resume 的空白日志换成新的。新增 `wasRooted` 判定（比较**本次移动前**的标记）钉住。
- **订阅失效**：内核现在会自己替换会话，而 `WebController` 订阅的是 boot 时绑定的那个——换工作区后**实时事件全部丢失，转录冻结而内核继续工作**。`followSession()` 改为幂等（对比 `kernel.agent` 身份再决定是否重订阅），在每帧之后与 `switchSession` 里调用。回归测试断言换工作区后仍收到 `turn_start` / `message`。
- **`runtime-facade.ts` 职责过载**：按行数预算拆出 `runtime-workspace.ts`，并按同一原则把出站帧的呈现意图解析拆到 `web/src/wire-frame.ts`。

**（文件名净化规则随上传功能一并删除）** `web/src/upload-name.ts` 曾移植 dsh `attachment-local/src/file-store.ts` 的 `fileLeafName`（保留设备名 stem、按 255 **字节**而非字符截断、剔除控制字符与 Windows 保留字符、剥掉尾随点与空格）。上传路由与上传目录已整体移除（附件改为指向文件原位的 `@path` 引用，见 `model-end-rework.md`），**磁盘上不再有本进程写入的用户文件，因此不再需要为它们消毒文件名**。
