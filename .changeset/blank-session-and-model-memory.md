---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

三处「状态没有被记住」的修复，以及为了让它们可测而做的职责拆分。

**模型选择跨进程记住。** 座位（`ModelSeat`）是内存态、跟着内核 `model` 事件走，所以换完模型重开就回到 boot 默认值。落盘交给壳层（`cli/config-write.ts` 的 `saveModelChoice`），经 `ControllerOptions.persistModel` 注入——web 不能 import cli，而只有壳层知道配置文件长什么样。写入**改写原始文本**而不是把解析后的对象写回去：`loadConfig` 会跑 `expandDeep`，`{env:MY_KEY}` 会被展开成密钥，序列化回去等于用明文替换引用（新测试钉住这一点）。落盘同目录 tmp + rename；写失败按错误帧报给读者，**不回滚已经发生的切换**——那一次运行确实已经在新模型上。

浏览器侧存不了这件事：`NOVA_WEB_PORT` 未设时端口临时分配，而端口是 origin 的一部分，每次启动都是新 origin，localStorage 恰好会在需要它的时候是空的。

这条链路有**两处**断点，不是一处：controller 不落盘（上面说的），以及 `launchWeb` 逐字段手抄 controller 选项时**静默丢掉了新加的可选字段**——可选属性不在类型里，编译不报错，而 controller 的单测直接调 `WebController.create`、根本不经过这道缝，于是「模型记忆」在所有单测里都成立、只有真实启动失效。`launchWeb` 现在只解构出四个托管项（静态目录、端口、主机、就绪回调），其余整份透传给 controller，并由 `web/test/launch-web.test.ts` 走**真入口**钉住。

**会话跟着工作区搬。** 侧栏按日志里**最新**的 `workspace` 标记归档；该标记此前只在会话创建时落一次，于是换工作区后仍在运行的那个会话继续挂在旧目录下。`setWorkspace` 现在在记录的工作区确实变了时补一条标记（`moveSessionWorkspace`，log-only，不进模型可见面）。

这条修复曾被三处独立缺陷挡住，三处都在这里一并修掉：①头部扫描取的是**第一个**标记（完整投影取最新一个），而标记追加在提示词之后是常态，于是中途搬过的会话被列在**已经离开**的目录下；②头部扫描在首条提示词处 `break`，根本读不到后面的标记；③列表的缓存键只有 `mtime`，而 **NTFS 时间戳落在约 15ms 的网格上**——「换工作区后立刻重列」这条最常见的路径里前后 `mtime` 可能完全相同，旧 head 被永久命中。现在是「两边都取最新标记、扫完整个头部、键为 `mtime:size`」，三条各有回归测试（size 那条用整毫秒固定 mtime 才能隔离出 size 的作用——亚毫秒精度 `utimes` 写不回去）。

**空白会话不再堆积。** 会话在第一条提示词之前就已存在，所以「新会话」会立刻留下一个空日志，而列表是纯粹遍历目录、没有任何空判据——每按一次就多一行读作「新会话」却什么都没命名的壳。判据是 core 的 `isBlankSession`（用户角色消息是否**全部**是 runner 播种的片段）：已在空白会话上再点「新会话」只回一份新基线、不再新建日志；列表里只有当前打开的那个空白会话成行。头部扫描（`session-peek.ts` 的 `blank`）是同一判据的有界读法，且**缓冲区读满即判非空**——截断的头部里「没看到提示词」不等于「没有提示词」，失败要偏向显示。服务端为此多读若干头部再裁页。

顺带把两块超限文件按职责拆开：`controller.ts` 的帧路由里，触碰文件系统的五个帧归 `fs-frames.ts`，侧栏行策略归 `session-rows.ts`；core 的会话目录扫分成 `session-files.ts`（目录遍历）、`session-peek.ts`（头扫描）、`session-listing.ts`（记忆化）、`session-workspace.ts`（标记）与 `session-index.ts`（目录 API）。
