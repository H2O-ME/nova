# @nova-agent/plugins

## 0.4.0
### Major Changes

- b21a782: **插件协议统一：删除 legacy `{ name, activate(ctx) }` 门面，唯一协议是 core 的 `{ name, inject?, Config?, apply(ctx) }`。**
  
  历史上有两套公共插件 API 并存：core 容器的 `Plugin`（`{ name, inject, Config, apply }`）与 Nova 自有的 `{ name, activate(ctx) }` / `PluginContext`（`registerTool` / `registerCommand` / `registerHook`）。后者在 `plugins/host.ts` 适配到容器上，形成「同一种能力、两套写法」。本次把它连根删除：
  
  - **`packages/plugins/src/types.ts` 删除**，`host.ts` 的 legacy 适配层删除；`{ name, activate(ctx) }` 形态在任何类型、运行时分派、roster 校验里都不再被接受——只导出 **core 协议**的插件（函数 / 类 / `{ apply }` 对象）。
  - **注册 idiom 收敛到一处**：`plugins/toolbox.ts` 的 `registerTool(ctx, def, permission)` / `registerCommand(ctx, def)`（每个注册都是容器 effect，卸载时逆序拆除）。所有内置插件（fs / search / bash / jobs / todo / workspace / subagent / ask-user / skills / goal / ptc）、qqbot 第三方示范、`plugins.extra` 的加载校验与测试夹具全部改走这条路。
  - **`plugins.extra` 的模块契约相应收紧**：`extra` 导出的默认导出必须是一个 core `Plugin`，「带 `activate` 的旧形状」会被 `loadExtraPlugins` 明确拒绝（报错点名协议已换代），不再提供任何转换垫片——写自写插件的人改一行即可。
  - **钩子改走容器事件缝**：goal / ptc 的 `beforeLLMCall` 从旧 `PluginContext` 钩子改为 `ctx.on(beforeLlmCall, (req, next) => …)`，与容器内其他监听器同一条 waterfall 派发。
  
  ### 顺带修掉一个真实运行时 bug
  
  `core/plugin/events.ts` 的 `waterfall`：`next` 的类型与文档都说「spread 改写」`next(...rewritten)`，运行实现却一直是数组式 `next([...rewritten])`——于是按文档写的 `next({...req})` 会把**一个裸对象当整包参数**传下去、改写被静默丢掉，跑过链尾回收的是未改写版本。现实现改为 spread 语义，且在**链尾**（没人接管、也没人再 delegate）时返回**链上最后一个值**——「改写后放行」的委托在链尾也成立。`core/test/plugin.test.ts` 新增常驻回归用例钉住该语义（改回旧行为必红）。

### Minor Changes

- b21a782: 新增 `ask_user_question`：模型可以在运行中向人提问并等待回答（对齐 deepseek-harness `ui-user-questions` 的形状与中文文案）。
  
  **内核**：新增 `question_request` / `question_resolved` 两个 `KernelEvent`（**生产者即内核自身**，`session.ts` 的 broker 桥接处发布，避免「声明齐全、消费者齐全、唯独没有生产者」那一类死代码）；新增相位 `waiting_question`（`TurnPhase` 增加一个成员——`flow.tsx` 的 `PHASE_LABEL` 是穷尽 `Record`，因此这是编译期强制的决定，而非可选）；`AgentSession` 新增 `resolveQuestion` / `cancelQuestion` / `pendingQuestions`。新增 `core/src/user-question.ts`：`QuestionBroker`（fail-closed 的 `failAll`）、不可信答案的形状解析 `parseQuestionAnswer` 与语义校验 `validateQuestionAnswer`、以及有界的 `UserQuestionError`。
  
  **插件**：`ask_user_question` 工具（描述与 `questions[]` schema 逐字取自 `dsh-tool-ask-user`，线上 `multi_select` 保持 snake_case）。回答者（asker）在**装配点**接线，与 `onSubagentProgress` 同一纪律，surface 无需自己接。工具**始终注册**（不是 opt-in：从工具表里消失的工具对模型什么也没教），`permission: 'read'`（提问本身没有副作用）。`NO_PROVIDER` 是**真实可达**状态：默认 `false`，所以 `nova exec` 与 qqbot 会拿到这条有类型的拒绝，而不是挂住。
  
  **Web**：`resolve_question` / `cancel_question` 两个客户端帧与 `ready.pendingQuestions`——后者是承重的：运行**停在提问里**，重连的客户端只能从基线上知道它，否则永远看不到那张卡。前端在 composer 座渲染提问卡（分页、选项、跳过、最后一问提交），文案取自 dsh 的**中文**词典。
  
  **CLI**：REPL 也回答提问（`userQuestions: true` 加上答案路由）——否则它会对外宣称有一个可以回答问题的人，然后一直等下去。
  
  **修掉的两个真缺陷**：
  
  - **中止竞态（会让浏览器挂住）**：`session.abort()` 先中止了 run controller 再清扫挂起的提问，于是停住的工具自己的 abort 监听先退休了等待者，清扫什么也没找到——`question_resolved` **从未发布**，界面上留下一张永远出不去的卡。改为所有结束路径都汇聚到等待者表（恰好一次上报获胜），并在中止 controller **之前**清扫。
  - **未声明的设计 token**（既有缺陷）：`--dsw-alias-text-1/2/3` 被 `TodoPanel.module.css` 使用却**任何地方都没有声明**——一条静默不生效的规则，而且不报错。两个文件都改用真实的 `--dsw-alias-label-primary/secondary/tertiary`，并新增护栏测试「组件消费的每个 `--dsw-*` 都必须在 token 层声明」（只查 `--dsw-*`：`--dsh-*` 一族由 JS 在运行期发布，合法地没有静态声明）。
  
  顺带把 `human-frames.ts` 里唯一一句英文的面向用户错误改为中文，与同文件另两条及 `frame-router.ts` 的既有文案一致。
  
  **提问卡自身又修掉三个缺陷**（都在同一个未发行的批次里，故并入本条）：
  
  - **「跳过」是一条死路（真 bug，会让人卡住）**：参照实现的完成判据是 `answered || skipped`，移植时漏掉了 `skipped` 这一位，于是 `Skip` 只把分页游标往后挪、**不记录任何状态**。两条后果都可观测：①单题批次的 `Skip` 是**彻底的空操作**（游标本来就到头了）；②多题批次里跳过的题永远 `isAnswered === false`，而提交键的门是「全批次都已作答」，**因此提交键永久禁用**——用户既答不了那题（它已被放弃），也提交不了。收口为 `isComplete` / `allComplete` / `firstIncomplete` / `skipQuestion`，并补上「提交被拒时直接跳到卡住的那一题」，让反馈指向一题而不是一种状态。
  - **提问详情用 `<pre>` 渲染**：参照实现走 markdown 渲染器，两者的差别是真实可见的——计划正文里的标题与列表在 `<pre>` 下**按源码字面显示**（`##`、`-` 原样露出）。改走 `MarkdownText`（`variant="compact"`），并同步修正 `.detail`：等宽字体与 `white-space: pre-wrap` 对**源代码**是对的、对**文档**是错的。
  - **选项列表的语义与两条交互缺失**：单选项列表没有 `role="radiogroup"`/`role="radio"`（屏幕阅读器只念「按钮」，**不念这是单选还是多选**），已补 `role` + `aria-checked`；同时补上参照实现的两条交互——**单选即自动前进**（选完不必再按「下一题」）、**单选的自由文本替换已选选项**。
  - **「选项 / 其他」两个槽位没有互斥（真 bug，UI 与线上会不一致）**：`withCustom` 清了选项，反方向却没有——`toggleOption` 在单选下**留着旧的自由文本**。于是「先打一段字、又点了一个选项」之后，卡片显示该选项已选中，而 `buildAnswer` 因为「有文本就以文本为准」发出去的却是那段**已经被放弃的文字**：读者看到的答案与模型读到的答案不是同一个。参照实现的 `choose` 两个方向都清，已对齐（并补了反方向回归测试）。
  
  结构棘轮：按职责拆了 5 个文件（`session.ts` 698→585、`client-frame.ts` 204→163、`frame-router.ts` 210→196、`protocol.ts` 471→447、`kernel-boot.ts` 112→75），其余必要的上限放宽由 `pnpm gates:update` 逐条打印 `RAISED` 记录在案。
- b21a782: 三处「状态没有被记住」的修复，以及为了让它们可测而做的职责拆分。
  
  **模型选择跨进程记住。** 座位（`ModelSeat`）是内存态、跟着内核 `model` 事件走，所以换完模型重开就回到 boot 默认值。落盘交给壳层（`cli/config-write.ts` 的 `saveModelChoice`），经 `ControllerOptions.persistModel` 注入——web 不能 import cli，而只有壳层知道配置文件长什么样。写入**改写原始文本**而不是把解析后的对象写回去：`loadConfig` 会跑 `expandDeep`，`{env:MY_KEY}` 会被展开成密钥，序列化回去等于用明文替换引用（新测试钉住这一点）。落盘同目录 tmp + rename；写失败按错误帧报给读者，**不回滚已经发生的切换**——那一次运行确实已经在新模型上。
  
  浏览器侧存不了这件事：`NOVA_WEB_PORT` 未设时端口临时分配，而端口是 origin 的一部分，每次启动都是新 origin，localStorage 恰好会在需要它的时候是空的。
  
  这条链路有**两处**断点，不是一处：controller 不落盘（上面说的），以及 `launchWeb` 逐字段手抄 controller 选项时**静默丢掉了新加的可选字段**——可选属性不在类型里，编译不报错，而 controller 的单测直接调 `WebController.create`、根本不经过这道缝，于是「模型记忆」在所有单测里都成立、只有真实启动失效。`launchWeb` 现在只解构出四个托管项（静态目录、端口、主机、就绪回调），其余整份透传给 controller，并由 `web/test/launch-web.test.ts` 走**真入口**钉住。
  
  **会话跟着工作区搬。** 侧栏按日志里**最新**的 `workspace` 标记归档；该标记此前只在会话创建时落一次，于是换工作区后仍在运行的那个会话继续挂在旧目录下。`setWorkspace` 现在在记录的工作区确实变了时补一条标记（`moveSessionWorkspace`，log-only，不进模型可见面）。
  
  这条修复曾被三处独立缺陷挡住，三处都在这里一并修掉：①头部扫描取的是**第一个**标记（完整投影取最新一个），而标记追加在提示词之后是常态，于是中途搬过的会话被列在**已经离开**的目录下；②头部扫描在首条提示词处 `break`，根本读不到后面的标记；③列表的缓存键只有 `mtime`，而 **NTFS 时间戳落在约 15ms 的网格上**——「换工作区后立刻重列」这条最常见的路径里前后 `mtime` 可能完全相同，旧 head 被永久命中。现在是「两边都取最新标记、扫完整个头部、键为 `mtime:size`」，三条各有回归测试（size 那条用整毫秒固定 mtime 才能隔离出 size 的作用——亚毫秒精度 `utimes` 写不回去）。
  
  **空白会话不再堆积。** 会话在第一条提示词之前就已存在，所以「新会话」会立刻留下一个空日志，而列表是纯粹遍历目录、没有任何空判据——每按一次就多一行读作「新会话」却什么都没命名的壳。判据是 core 的 `isBlankSession`（用户角色消息是否**全部**是 runner 播种的片段）：已在空白会话上再点「新会话」只回一份新基线、不再新建日志；列表里只有当前打开的那个空白会话成行。头部扫描（`session-peek.ts` 的 `blank`）是同一判据的有界读法，且**缓冲区读满即判非空**——截断的头部里「没看到提示词」不等于「没有提示词」，失败要偏向显示。服务端为此多读若干头部再裁页。
  
  顺带把两块超限文件按职责拆开：`controller.ts` 的帧路由里，触碰文件系统的五个帧归 `fs-frames.ts`，侧栏行策略归 `session-rows.ts`；core 的会话目录扫分成 `session-files.ts`（目录遍历）、`session-peek.ts`（头扫描）、`session-listing.ts`（记忆化）、`session-workspace.ts`（标记）与 `session-index.ts`（目录 API）。
- b21a782: **模型接入改为 BYOK 多供应商、Skills 改认通用 `.agents` 标准、QQ 机器人在 `nova --web` 内真正接入，以及一批会话界面缺陷修复。**
  
  > 插件分层与开关的内容在 `.changeset/plugin-tiers-and-switches.md`，不在此重复。
  
  ### 模型接入：初次使用即空壳（BYOK）
  
  - **`~/.nova/config.json` 的 `provider` 变为可选**，新增 `providers[]` 与 `activeProvider`。首次启动不再要求先手写配置文件：产品直接进入设置页，由「设置 → 模型」添加第一个端点。文件不存在时按空配置启动；**文件存在但内容损坏仍然报错**，不会被静默覆盖。
  - 设置页新增**供应商编辑区**：可增删多个 OpenAI 兼容端点、逐个「获取模型列表」（`GET {baseURL}/models`，探测结果不落盘）、从取回的目录里勾选要加入清单的模型。此后按既有规则自动补齐上下文窗口与多模态能力（可手改）。
  - **密钥永不回显**：页面只知道「是否已设置」，保存时留空即保持原值。写回的是**原始文档**，所以 `{env:NAME}` 引用逐字保留——写解析后的对象等于用明文替换引用。
  - 新增 `ChatProvider.setEndpoint()`，切换端点在同一客户端上原地发生（不重建实例，会话句柄与缓存亲和不受影响）。
  - **修复首次保存必定失败**（两处）：配置文件不存在时 `patchConfig` 抛 `missing config`；且 `~/.nova/` 目录不存在时 tmp+rename 落盘失败。二者都只在「干净的第一次运行」出现，正是这个功能的主场景。
  
  ### QQ 机器人：`nova --web` 内真正接入
  
  - 此前 `nova --web` 只对凭据做一次连通性测试，**不会实际收发消息**——凭据填好、开关打开，什么都没发生。现在凭据有效且在役时，网关通道在**同一进程内**运行：每个 QQ 对端独立会话，走无人值守审批策略（`never`，与 `nova exec` 一致）。
  - **`qqbot` 现在总会出现在插件列表里**：roster 的清单由**候选**构建，而此前通道只在凭据检查通过后才被构造，于是未配置时插件在页面上完全不存在——想开启也无从下手。`qqbot` 属 `advanced`（默认关），仅提供候选不产生任何开销。
  - 凭据不可用时给出可执行的说明，而不是让 WebUI 无法启动。
  
  ### Skills：改认通用 `.agents` 标准目录
  
  - 发现根按优先级：项目 `.agents/skills` → 项目 `.nova/skills`（向后兼容）→ 用户 `~/.agents/skills` → 用户 `~/.nova/skills`（向后兼容）。此前只扫 `.nova`，因此装在 `~/.agents/skills`（多个 agent 工具共用）的 skill **完全不显示**。
  - 除目录包 `<name>/SKILL.md` 外，新增支持扁平 `<name>.md`。
  - **修复 YAML 块标量**（`description: >-` / `|`）被读成字面量 `>-` 的缺陷——真实 `.agents` skill 大量使用这种写法（实测 12 个里 8 个），导致描述在索引里变成一串符号。折叠式按 YAML 规则以空格连接，字面式保留换行；缩进行（`metadata:` 的子键）不再被误当顶层键。
  
  ### 会话与界面
  
  - **运行中可修改审批等级**。此前有两道锁：服务端拒绝，且设置面板的选择器在整个运行期间被 `modeControlsLocked`（`composerDisabled || !isIdle`）禁用——即使放行服务端也点不动。现在审批档只跟 `composerDisabled` 走，执行模式仍锁（它重建工具集，属缓存前缀）。
  - 会话开始后，输入框不再显示模式选择（它只属于 hero 阶段）。
  - **修复端点未返回 `usage` 时整条会话统计消失**：`timePill()` 把「N 轮 N 步」这句计数关在「至少量到一个时间量」的门后，而量测来自 provider 的 `usage` 事件——端点忽略 `stream_options.include_usage` 时根本没有 `usage`，于是 `run_stats` 已累加的轮/步被连坐丢弃。现在计数只以 `runs`/`requests` 为门，量测项各自决定在不在；缓存命中信息单独缺席。
  - **修复运行中发送的消息可能永远得不到回复**：旧 `runLoop` 先清空 `pending` 再判继续条件，信号一 abort 就把队列**销毁**而非延后——停止后发的消息有日志、有界面，却拿不到它排队换取的那次运行。现在队列由 `PromptQueue` 持有，吸收点唯一（请求真正读到它的那一步），abort 边界换新 controller；插话在**当前运行的下一个步骤边界**即被模型读到，不再等到下一整轮。
  - 其余界面修复：展开的过程组被强制套用折叠态间距；连接重试中显示为静态「已断开」图标；子代理摘要字号因误用 `font` 简写变量被静默丢弃；目录选择器把「读取失败」与「空文件夹」显示为同一句话；输入框 `+` 与设置按钮因 UA 按钮内边距而错位；侧边栏收起轨道的图标控件补上提示浮层。
  
  ### 目标模式（goal）
  
  - 新增 `create_goal` / `update_goal` 工具与 `/goal` 命令（`/goal` 查看，`/goal clear` 清除）。目标作为**仅落日志**的整份快照（last-write-wins），与 `todo_write` 同构：续接时随 `ready` 恢复，模型不为它付上下文。
  - 活跃目标在下一次请求注入一行**临时** user 消息以跨轮继续——复用 job 通知与计划提醒已有的请求级 ephemeral 尾通道（不落日志、每请求重算）。由插件侧产出，core 不需要认识 goal。
  - 轮次预算有硬上限：用尽后目标转为 `blocked` 并写明原因，而不是无限继续或静默停下。
  - 前端新增目标面板（默认折叠、无目标不渲染），位于计划面板之上。
  
  ### 其它
  
  - `SessionEvent` 新增 `goal/change`；`KernelEvent` 新增 `goal`；`ready` 新增可选 `goal`。
  - `AgentSession.announceGoal()` 是「记录并广播」目标的唯一门口（`appendEvent` 之后 `publish`），保证「记下了」与「播出去了」不会各走一边。
  - **修复结构门禁脚本本身**：`structure-budget.mjs` 的上限计算恒等于「不变或上调」（`Math.min(old, headroomOf(old))` 恒为 `old`），于是任何一次不带子串的 `gates:update` 都会把中间态的行数膨胀**永久烙进上限**，之后长回那个空间门禁不再报红。现在上限始终跟随文件实际行数，缩小会**下调**（本次一次性收紧 12 个文件），增长逐条打印 `RAISED`。
  - `pnpm gates` 行数预算已同步；新增文件已登记。
- b21a782: **目标模式：输入框里终于有反馈，`/goal` 也能真的设定目标。**
  
  参考实现（dsh `ui-goal` + `ui-conversation` 的 composer）里，斜杠目标模式有两处专门的呈现：输入框在草稿停在 `/goal ` 时画一行**提示语**，且这行提示会用「当前有没有目标」消歧；宿主则把 `/goal <目标>` 当真建立一个目标。Nova 此前两处都缺——输入框零反馈，`/goal` 只认查看与 clear，于是「目标模式」在界面上不可观测。
  
  - **命令**（plugins）：`/goal` 语法对齐参考实现的 `parseGoalCommand`——`<目标>` 建立、`edit <目标>` 修改、`pause` / `resume` / `clear` 是精确控制词、空参数查看；输出随状态给出一行**可用命令表**（进行中 → `edit`/`pause`/`clear`，已暂停或受阻 → `edit`/`resume`/`clear`，已完成 → 新建/`clear`）。已有目标时再输一个目标**拒绝**而不是静默替换（轮次计数属于已经开始的活），`edit` 保留同一个目标与预算；`complete` 是终态，`pause`/`resume` 对它明确拒绝并指向正确动作。语法与生命周期各成一件事，故从 `kernel-commands.ts` 拆到 `goal-command.ts`；每次写入仍只走 `AgentSession.announceGoal`（先落日志、再广播）。
  - **输入框**（web/ui）：新增 claim 提示（`composer/claim-hint.ts`）——草稿是注册表认得的命令、且参数仍为空时画一行 ghost hint；`/goal` 有两个变体，由**是否已有目标**决定（`hint.goal` / `hint.goal.active` 的消歧，与参考实现的键规则逐字一致），文案取参考实现 zh 词表的原文。于是提示语与命令互为承诺：提示说能输目标，就真的能建目标。草稿的「首 token + 参数」解析收敛成 `command-menu.ts` 的 `draftCommand()`，命令帧与提示共用同一份判断。
  - **回放安全**（web）：目标仍只有一份存储——log-only 的 `goal/change`，读者看到的都从它来（活的是 `goal` 事件，切换会话或重启是 `ready.goal`）。新增端到端回放测试：`/goal 发布 v1` 之后**换一个进程**读同一份日志，基线里目标完好、轮次计数一致；且目标续做注入的那条**临时提示词不会**作为用户消息出现在日志或回放里（与压缩摘要同一类陷阱：core 写给模型看的东西绝不能被画成用户说过的话）；`clear` 是**被记录的状态**，重启不会把目标从更早的事件里复活。
- 83a875d: **一切皆插件落地 + 形态收敛到浏览器 UI（M11 批10–批11）**。两批一起发：批10 把内核能力全部变成可替换的插件服务，批11 删掉 TUI——两者合起来才是"一个内核 + 一种产品界面"的完整姿态。
  
  ### 一切皆插件（批10）
  
  - **插件容器（`@nova-agent/core` 新公共面：`core/plugin/`）**：Cordis 式 `Context` / `Fiber`（pending→loading→active→failed→disposed，含依赖变更 reload）/ 服务键寻址（`key<T>()` + provider 换代驱动依赖方重载）/ 类型化事件（emit、waterfall、parallel、serial、bail 五种派发）/ `ctx.effect()` 撤销（**正确拆除由构造保证**）/ 结构化配置校验。`waterfall` 的胜出者是"自己返回了非 undefined 的那个"，`next(...)` 可委派并改写参数；`serial` 由第一个决定性裁决胜出（审批门是 priority 1000 的监听者）。
  - **能力服务缝（新公共面）**：approval / llm / tools / commands / sessions / compaction / jobs / spill / skills / surfaces 全部成为**可按键替换的服务**，生命周期钩子成为内核事件（`beforeLlmCall` / `beforeToolCall` / `afterToolResult` / `pluginLoaded`）。历史插件 API（`{ name, activate(ctx) }` + `registerTool`/`registerCommand`/`registerHook`）在 `@nova-agent/plugins` 的宿主门面上被**适配**到容器——内置插件与第三方插件一行不改就获得正确生命周期。
  - **配置层扩展点（新公共配置面）**：`~/.nova/config.json` 新增 `plugins.disable`（不加载的内置插件名）与 `plugins.extra`（额外插件模块：绝对/相对路径或包名，须以 `default`/`plugin` 导出 `{ name, activate }`）。**不改源码即可选择、替换或扩展任一能力**。拼错的 disable 名告警；extra 加载失败即启动失败。
  - **可溯**：`/plugins` 打印 roster（名字 / 状态 / 注入的服务），数据源是 `kernel.roster()`。
  - **内核装配只有一个点**：`createAgentKernel()` 从 325 行单文件拆成 env/roster/facade/session 四份；四个 runner 全部经 `cli` 的 `bootKernel()` 装配；provider 的会话亲和（`setSessionId`）改由 sessions 服务在 open/activate 时绑定——四处手写的 `bindSessionAffinity` 全部删除（WebUI 与 qqbot 的会话亲和此前靠手工接线，现在结构上不可能漏）。
  - **单一实现**：审批答案解析三份合一（`core` 新增 `parseAskResult`，WebUI 帧 / 插件 asker / 桥接消息走同一解析器与同一 fail-closed 规则，理由与 scope 有界）；控制字符策略三份合一（`core` 新增 `hasControlChars`，多行字段例外一致）。
  - **四个真 bug**（均有回归测试）：①审批弹窗答案若在 publish 内**同步**到达会被占位 resolver 吞掉 → run 永久挂死；②事件泵里抛错的监听器变成未捕获异常**杀掉进程**（现在转成 `notice` 上报）；③`prompt()` 先入内存后落盘，写失败时内存与磁盘发散；④`gateCompact` 被 `running` 守卫挡死——**自动压缩从未真正生效**，每轮都报一次幻影失败。
  
  ### 形态收敛（批11，破坏性）
  
  - **TUI 整体删除**：`packages/tui`、`packages/tui-app` 与 Rust 包 `packages/tui-rs` 连同 CLI 胶水（`tui-mode.ts` / `rust-tui.ts` / `rust-tui-wire.ts`）全部移除；包数 8 → 6。
  - **`nova` 的默认形态改为浏览器界面**（原来起全屏 TUI）。迁移：需要终端形态用 `nova --repl`（非 TTY 仍自动回落 readline REPL）；`nova --web` 保留为显式拼法。`nova exec` / `nova qqbot` 不变。
  - **`@nova-agent/web` 导出变更**：`resolve_approval` 帧的 `answer` 现在是内核的 `AskResult`（线上解析走 `core` 的 `parseAskResult`），`WireAnswer` 与 `toAskResult` 随之删除；浏览器端照旧可以只发 `{reason}` / `{scopeWords}` 这类裸 grant，解析归宿主。
  - **surface 认领表**（`cli/surfaces.ts`）：换默认形态时踩到的坑——首版把「非 TTY 一律回落 REPL」排在浏览器界面之前，于是管道里的 `nova --web` 被 REPL 抢走（真机冒烟脚本正是这么跑的：`stdio: ['ignore','pipe','pipe']`，改动后它会一直等 URL）。现在 `--web` 在两种 stdio 下都认领，只有 `--repl` 排在它前面；`cli/test/surfaces.test.ts` 用「四种调用 × 交互/非交互」的认领表直测钉住。
  - **配置**：`ui.theme` 只影响 REPL（浏览器面有自己的明暗 token 档）；`--theme` 同理。
  - 文档按新形态重建：`AGENTS.md` 重写（6 包架构、容器与服务缝、WebUI 契约、公共 API 六面），`README.md` 与配图重绘，随 TUI 过时的 `docs/`（`tui-design.md`、`MILESTONES.md`、外部工具生成且已失真的 `architecture/`）删除；版本测试改为**从磁盘发现工作区包并校验 changesets 锁步组**（原先它一直在检查一个已删除的包）。
- 83a875d: **模型端：真正的模型选择（目录 / 切换 / 显示名）**。此前后端只有"配置里写了哪个模型"这一个事实——顶栏把它当 crumb 静态印出来，composer 里的模型芯片是惰性文字，用户实测判定「功能缺失」。
  
  - **内核**（core / plugins）：`ChatProvider` 新增三个可选成员 `model` / `setModel(model)` / `listModels()`（`ai` 的 OpenAI 兼容客户端早已实现，此前无人调用）；`KernelEvent` 新增 `model` 变体（`model` + 可选 `name` / `contextWindow`）；核心新增 `core/kernel/model.ts`——`ModelOption` / `ModelGroup` / `ModelCatalogPort` / `ModelControl` 与 `canSwitchModels` 守卫；`Kernel.models?: ModelControl` 由 `plugins/runtime-models.ts` 提供：目录 = **端点公布的 id**（`GET /models`）+ **壳层的元数据**（显示名 / 窗口），切换**原地改写同一个客户端**（不重建 provider，会话句柄、子代理、缓存亲和绑定都仍指向它）后由会话发 `model` 事件。未提供目录（或客户端不可重定向）时 `Kernel.models` 缺席，座位保持惰性。
  - **浏览器面**（web）：客户端帧 `list_models` / `set_model`，服务帧 `models`（拉取失败带可渲染原因，菜单留重试）、`state.modelName`、`ready.modelSwitching` / `ready.modelName`；服务侧状态抽成 `web/model-seat.ts`（标签 / 窗口 / 目录拉取 / 切换），控制器只把 `model` 事件变成给所有客户端的 `state` 回声——**座位跟着事件走，不跟点击的乐观值走**。前端座位（`ui/src/composer/ModelSeat.tsx`）触发器显示目录里的**显示名**，菜单按需拉取（冷启动不等端点），在役行打勾；换模型未带名字 / 窗口时**清空**而不是沿用上一个模型的（错的百分比比没有百分比更糟）。**顶栏的模型 crumb 删除**：harness 把模型放在 composer 的 `conversation.input.model`，一个模型只应有一个显示处。
  - **壳层**（cli）：`model-catalog.ts` 提供 `ModelCatalogPort`（端点主机名 + models.dev 元数据，peek 优先、离线可用），`nova --web` 启动时一次 lookup 同时供仪表分母与座位显示名。
  - 其它：`sessionLogPath()` 从 web 控制器移入 core（`session-index.ts`）——"resume 目标必须是 sessions 根下的 `.jsonl`"是会话存储的性质，不是某个界面的。
  - 真机走查：座位点开 → 站点目录 30+ 行（含 models.dev 显示名）→ 切换 → 触发器随 `state` 回声改名 → 新模型真跑一轮得到回答。
- 83a875d: **命令目录：`/` 菜单真的能跑命令了**。批13 前的状态是：内核的 `commands` 服务键与 `CommandRegistry` 早已就位，但**没有任何一方往里注册**——于是每个界面都得自造一套目录，而 composer 的 `/` 菜单只是个空壳（它甚至有完整样式，就是没有数据源）。用户实测判定「压缩上下文按钮」缺失。
  
  - **内核**（core / plugins）：`KernelEvent` 新增 `command` 变体（`name` + `phase: run|done` + 可选 `text`），`AgentSession` 新增 `announceCommand`；`plugins/kernel-commands.ts` 提供**命令目录的唯一生产者**——`kernelCommandsPlugin` 经 `ctx.registerCommand`（第三方插件用的同一条公共 API）注册 `/compact`，`commandRunner` 同时给出**活目录**与**唯一 runner**：目录每次读容器（后注册的命令立即出现在每个界面的菜单里），runner 开一条 `run` 行、收集命令自己的 `log` 输出、以 `done` 行收尾——命令抛错**在它自己的行里报原因**，未知名字同样留一行 `未知命令：/x`，调用方（任何 surface）永远拿到一条可渲染的结果而不是异常。`Kernel` 公共面新增 `commands` 与 `runCommand(name, args)`。
  - **浏览器面**（web）：客户端帧 `command {name, args}`（名字按注册表词法校验——`^[a-z][a-z0-9_-]{0,63}# @nova-agent/plugins

，参数长度与控制字符有界），`ready.commands` 下发目录；控制器把帧转成 `kernel.runCommand`，报告走事件流（`command` 事件 → 转录行），**没有第二套应答帧**。
  - **前端**（web/ui）：`composer/command-menu.ts` 是一组纯函数——打字到 `/` 开菜单、查询过滤（名字优先、描述兜底）、选中回写草稿（`/name ` 尾空格正是让菜单随之关闭的那一步）、以及最要紧的**一份草稿意味着什么**：注册表认得 `/name` 就发命令帧，认不得就原样发提示词（界面绝不吞掉注册表没收编的文本）；`InputBar` 只做按键路由（↑↓ 走行、Enter/Tab 落定、Esc 关菜单）与把 `ComposerMenu`（此前的无数据壳）渲染进卡的浮层锚座；转录新增 `command` 行（同一命令两次运行是两行，按发生顺序；`done` 收敛到最近一行的名字，重复 `done` 不会叠空行）。顺带补上 harness 头部的 **corner 座**：`conversation/PanelExpandButton`（`ui-sidebar-right` 的 ExpandButton 移植）——详情板收起且有可展开的调用时出现的 28px 圆钮，点开详情板后自己消失。
  - 真机走查（本机 `nova --web`）：输入 `/` → 菜单列出 `/compact 压缩上下文：总结历史，日志保留完整记录`；打 `/comp` 过滤出同一行；Enter 落到草稿 `/compact `；再 Enter 发送 → 转录出现 `/compact 执行中` + 「上下文压缩中（手动）…」+ 状态药丸「压缩会话」→ 收敛为 `/compact 已完成` + 「手动压缩完成 — 保留最近 2 条消息」，会话日志里留下 `compaction/start → summary → end` 三事件（压缩摘要真的被下一轮读到了）。
  - 顺带：死代码清除——`format.ts` 的会话统计单行文本（`sessionStatsText`）在换肤后已无消费者（统计面板自己出行），连同它的测试一起删除；`pnpm smoke:web` 的 bundle 标记同步到当前界面文案，并新增两条本批检查（`ready.info` 携带内核命令目录、未知命令名也在事件流上留一行）→ **27/27 PASS**。
- 83a875d: **会话列表不再闪 + 每轮反馈状态落盘 + 图标尺寸修正 + 静态缓存策略（M11 批14）**
  
  - **修复：侧栏会话列表卡在「加载中…」**。`ready` 此前会把会话列表一并清空，而**切换会话会广播 `ready`**——于是每次点击侧栏都先把列表清掉，只剩"打开 socket 时问过一次"的请求，一旦那一次没赶上重连，面板就永远停在加载态。现在 `ready` 只把列表标记为陈旧（`sessionsStale`），客户端在"陈旧且无请求在飞"时单飞补问，**旧行一直渲染**（与 deepseek-harness 同策略：启动/重连拉一次，其余靠推送增量）。
  - **会话列表更快**：新增 `@nova-agent/core` 的 `SessionListing`（并行 `stat` + 按 mtime 记忆化 `peekSession`），`listRecentSessions` 走它。639 份日志实测：首问 45ms、再问 20ms（此前 48–64ms，且每次重问都重读全部日志头）。
  - **每轮反馈状态现在是持久的**（用户缺口：`20:36 · 用时 4秒 · 首 token 2.3秒 · 89 tok/s`）。`RunStats` 以 log-only 事件 `run/stats` 追加进会话日志（`afterMessageId` 锚定它收尾的消息，落盘先于广播），因此续接、页面重载后的会话**不再丢掉每一轮的状态行与底部统计条**——此前 `RunMeter` 只在进程内，重载即失。回放时投影成 `meta` 块，整份日志的折叠值随 `ready.runTotals` 下发；轨迹视图新增一行「运行量测」。**时钟只有一个**：回合的元数据行拥有它，助手尾行只留复制/分支。
  - **修复：内联 SVG 没有内在尺寸导致的两处真实观感 bug**。只有 `viewBox` 的 SVG 在 flex 行里对父级宽度贡献为零：工具行的「详情」药丸被压成 44px 高的一坨竖排文字，模式选择器的箭头塌成 0×0。改为**把设计盒写进元素**（`width`/`height` 属性，即 harness `IconXxx16` 的做法），CSS 只按调用点缩放（药丸 12px、触发器箭头 14px）。`ui/test/style-guard.test.ts` 新增守卫：每个内联 `<svg>` 都必须声明设计盒。
  - **静态资源缓存策略**：`index.html` 一律 `no-cache`，`/assets/*`（Vite 内容哈希产物）`immutable`。此前两者都没有缓存头——浏览器可能用启发式缓存把旧文档留在手里，而旧文档指向的资产 URL 已被重建删掉，重载会给出旧界面或一片空白。
  - **公共面新增**（均为向后兼容新增）：`core` 导出 `anchoredRunStats` / `parseEventLine` / `missingToolResults` / `SessionListing`；`web` 新增入站帧解析模块 `client-frame.ts`、`WireBlock` 的 `meta` 变体、`WireTraceRow` 的 `run` 变体、`ready.runTotals`、`server.ts` 的 `cachePolicy`。
- b21a782: **工作区切换、会话删除、`@` 文件引用**：三项此前「缺一个入口」或「完全没有」的能力，这次补齐，每项的协议面与 dsh 的实现对齐（不是自创形状）。
  
  - **工作区切换**（core / plugins / web）。内核侧 `kernel.setWorkspace()` 一直存在（`switch_workspace` 工具、`--resume` 恢复工作区都在用），缺的是**客户端帧与界面入口**。新增客户端帧 `set_workspace {dir}`：控制器先经 **`resolveWorkspaceDir()`** 校验（不存在 / 不是目录 / 落在 `~/.nova` 内一律拒答），**再**调内核——`setWorkspace` 会把 bash / search / fs 的根全部改指，所以校验必须发生在它之前，否则工具会指向一个不存在的位置。校验通过后广播新的 `ready`（`rootDir` 是客户端获知工作区的唯一来源，因此搬动必须在基线里可见，而不只在句柄上）。`resolveWorkspaceDir` 与 `sessionLogPath` / `deleteSessionLog` 一起落在新的 `core/session-target.ts`：**「surface 传来的字符串 → 会话存储认的路径」是一件事**，与 `session-index.ts` 的目录枚举（只列不抛）职责不同，失败模式也不同，故按职责拆开。
  - **会话删除**（core / web）。新增客户端帧 `delete_session {file}`。`deleteSessionLog()` 复用 `sessionLogPath()` 的同一道校验（删除与 resume 的边界完全一致，`../../secret.jsonl` 与越界路径一律抛错），**真删**（`unlink`，不是归档标记——日志即会话，文件还在就仍会被列出、仍可 resume）。文件已不在时返回 `false` 并由控制器回一条 error 帧（「会话文件不存在（可能已被删除）」），因为客户端的列表可能是陈旧的，这是正常竞态而非故障。前端：会话行悬停时把时间戳单元格换成删除按钮（dsh `Rows.tsx` 的规则），点开确认对话框（dsh `ArchiveSession.tsx` 的位置），**取消键带 `data-modal-autofocus`**——误按 Enter 应落在安全的那一侧。
  - **`@` 文件引用**（core / web）。新增客户端帧 `list_files {query}` 与服务端帧 `files {query, items, truncated}`。`core/file-listing.ts` 是新的工作区遍历：广度优先、`/` 分隔的相对路径、跳过 `.git` / `node_modules` / `dist` 与点目录、**绝不跟随符号链接**、条目数（200）与墙钟（1s）双上限——被截断时**明说**（`truncated`），因为「没有更多」与「没查完」是两件不同的事。`resolveWorkspacePath()` 复用同一套边界规则，把菜单里的一条候选解析回绝对路径。前端：`composer/reference-menu.ts` 是纯函数组（与 `command-menu.ts` 对称）——`atQuery` 只在**词首**的 `@` 处开菜单（邮箱地址不能弹出文件列表）、空格结束未加引号的引用、`"…"` 让带空格的路径保持为一个 token；`formatMention` / `referenceDraft` 写出的是 **`@path` 这种纯文本**，不是新协议对象——引用就是用户本可以手打的文本，于是「model-visible ⟺ logged」无需任何日志改动就仍然成立。菜单帧带 `query` 回传，落在旧文本上的迟到答案据此丢弃（`state.ts` 的 `files` 归约）。
  - **文件上传已移除，改为零拷贝引用**（web）。曾经按 dsh `file-upload` 的路线契约实现过 `POST /api/upload`，把字节流式落盘到 `~/.nova/cache/uploads/` 并把它并入 trusted read roots，好让 `read_file` 够得着。**该功能已整体删除**，因为它解决问题的方式是错的：有路径的文件**本来就该**用 `@path` 引用（模型用 `read_file` 去读），那份副本喂给模型的东西从原路径一样读得到，代价却是把用户的字节复制一份、且只增不减（实测一个 24MB 视频被白白复制，而模型根本无法消费它）。如今**文件**附件是指向原位的 `@path` 引用，**没有上传目录、没有 `trustedReadRoots` 豁免**（工作区外的路径走正常审批门）；唯一仍走字节的是**粘贴的图片**——它没有路径，见 `pasted-image-recognition.md`。真正的约束是浏览器：拖入/粘贴的 `File` **拿不到真实路径**（`File.path` 是 Electron 私有扩展；`showDirectoryPicker()` 的 handle 不带路径），所以唯一能拿到真实路径的途径是**宿主自己枚举**——`list_directory {files:true}` 让每一层同时列出文件，`+` 菜单的「引用本地文件」打开它。拖放仍 `preventDefault`（否则浏览器会导航到该文件、丢掉会话），但**非图片**文件只回一句解释，**绝不静默复制**。
  - **服务端崩溃修复（P0）**：`/` + 非法百分号编码（`/%`、`/%zz`、截断的 UTF-8 转义）会让 `decodeURIComponent` 抛 `URIError`；由于 `handleHttp` 是 async 而调用处只有 `void`，该异常成为 unhandled rejection，Node 默认策略**直接结束进程**——一条未认证请求就能杀掉正在跑的会话。现在两处都补：调用处 `.catch()` 兜底（已发头则收尾，否则回 500），以及 `decodeURIComponent` 自己 try/catch 回 400。测试钉住「三个畸形路径都 400，且服务器随后仍在服务」。
  - **会话列表动画**（web/ui）：把 dsh 的 `AnimatedRows`（FLIP）移植过来——`getSnapshotBeforeUpdate` 在 DOM 仍是**旧**列表时记录每一行的位置，`componentDidUpdate` 再让每行从记录处滑到当前位置；离场的行克隆进 `position:absolute` 的惰性浮层淡出（真实节点已被 React 卸载，瞬间消失的行没有东西可淡）。三条门保留原样，各自对应一个失败：**`ready`**（加载占位符 → 首个真列表不该每一页都让所有行动画进来）、**`resetKey`**（切换分组模式或改搜索词是**替换**视图，不是重排——看起来相似的行不能被飞过整个面板）、**首次输入后才武装**（切换后的首帧不是用户动作）。类组件不是风格偏好：`getSnapshotBeforeUpdate` 没有 hook 等价物。为避免「渲染的行」与「动画对比的 key」漂移，两者现在由 `sidebarRows()` 的**同一个行树**导出（`rowKeysOf()` 深度优先展平，与 DOM 嵌套顺序一致）。
  - 测试：新增 `core/test/file-listing.test.ts`（11 条：跳过树、`/` 分隔、上限与 `truncated`、不跟随符号链接逃逸、越界与绝对路径拒绝）、`session.test.ts` 补 `deleteSessionLog` 5 条（含越界与父目录拒绝）、`web/test/server.test.ts` 补畸形路径 1 条、`web/test/controller.test.ts` 补三帧 5 条、`web/ui/test/reference-menu.test.ts`（16 条）与 `sidebar-view.test.ts` 补行树 11 条。
- b21a782: **模型端重做：大小写无关的 id 对账、配置 `models[]` 名单、设置页能力编辑器。** 起因是一个真实的断线：端点对模型 id **大小写敏感**（`deepseek-v4-flash` → 503，`DeepSeek-V4-Flash` → 200），于是「模型列表打不开、切换无效」。
  
  - **id 按当前端点的名单对账，绝不硬编码拼写**（core）。`core/model-id.ts`：`resolveModelId(configured, available)` 三趟匹配（精确 → 唯一大小写无关 → 唯一标点无关），歧义时保留调用方原样而不是猜；`sameModelId(a, b)` 是同一规则的判等（空串先短路，`''` 不等于 `''`）。`kernel-config.ts` 异步化（`createProvider` → `resolveProviderModel`），先问端点再决定请求里写什么名字。**大小写是单个站点的命名怪癖，不是可写进配置的事实。**
  - **能力有三级优先级**（core）。新增 `core/model-catalog-rules.ts`：配置 `models[].<field>` → models.dev → 未知。合并**逐字段**（`??` 而非 `||`，所以显式 `false` / `0` 存活）且是**覆盖而非重述**——只写 `id` 的条目照样从 models.dev 拿到窗口与模态。**未知是合法答案**：占用环不画百分比，而不是继承上一个模型的数字或猜一个窗口。
  - **配置新增顶层 `models[]`**（cli / core）。非空即**全量接管**菜单（站点没公布的 id 也能选，被移除的不会再出现），`catalogIds` 保证**在役模型永远在列**（菜单得答得出「我在跟谁说话」）。读写落在新的 `cli/src/config-models.ts`（从 `config-read.ts` / `config-write.ts` 按职责拆出）：读**活取**而非捕获数组（否则设置页保存后菜单要到重启才变），写整份替换、空列表删除该键、`{env:MY_KEY}` 引用在往返后保持为引用（改写原始文本，不写回展开后的对象）。
  - **设置页可增删模型、逐字段改能力**（web/ui）。新增 `ModelConfigEditor`：自动值为占位符（「自动」），手动填写的值覆盖它——两者的差就是操作者在偏离什么。id 用 `<datalist>` 从**端点公布的名单**里选，避免把命名怪癖抄错。协议新增客户端帧 `list_model_config` / `save_models` 与服务端帧 `model_config {models, published, automatic}`。
  - **`AgentSession` 仍没有 `setModel`**：切换依旧是 `ChatProvider.setModel()` 原地改写同一客户端 → `announceModel()` 发事件。窗口未知时**清空分母**而不是沿用上一个模型的数字。
  
  **测试**：新增 `core/test/model-catalog-rules.test.ts`（15 条：逐字段合并、显式 `false` 存活、配置全量接管、拼写对账、在役模型恒在列、去重）。`core/test/model-id.test.ts` 补 13 条。
  
  **同批修掉的两个过程性缺陷**（不是产品行为，但每次开发都在付代价）：
  
  - **`pnpm test` 不再污染真实 `~/.nova`**（根）。此前隔离靠每个测试自己记得调 `withFakeHome`，而**五个套件忘了**——含建真内核跑在临时工作区、会话日志却写进开发者真实主目录的 `plugins/test/runtime.test.ts`，累积了 600+ 个垃圾会话。现在 `vitest.config.ts` 的 `setupFiles` 指向 `packages/test-setup.ts`，在任何测试模块加载前把 `USERPROFILE` / `HOME` 指向临时目录。**会被人忘掉的规则等于没有规则。**
  - **结构棘轮的行数上限带余量**（根）。上限原是「当前行数」，于是每个文件一落地就在 100%：门禁只会在收尾时说「你已经超了」，说不出「你快超了」，结果每次都要为十几个文件做**批量返工拆分**。现在上限 = `当前行数 + max(10, 10%)`，且每次运行都会打印剩余不足 10 行的文件（出现在 `pnpm check` 快环里，写代码时就能看见）。纯转出桶（只含 `export *` / `export { … } from`）不再计行数——它的长度是模块条数而非设计属性。
- b21a782: 粘贴的图片现在会真正送进模型识别，`@` 引用的文件仍然只是文本引用。
  
  **规则（两条，因为字节住的地方不同）**
  
  - **粘贴/拖入浏览器的图片 → 上传，模型真的看图。** 剪贴板只给字节、不给路径（`File.path` 是 Electron 私有扩展），所以不落盘就再也找不回来。接受 `image/png` / `image/jpeg` / `image/webp` / `image/gif`（`image/svg+xml` 不算：它能带脚本，且不在请求路径接受的格式内）。粘贴与拖入行为一致。
  - **`@` 引用的文件（含图片）→ 不识别、不上传。** 引用就是 `@path` 文本，模型用已有的 `read_file` 去读。原来的行为一行未改。
  
  **新增**
  
  - `POST /api/image`：唯一承载图片字节的路由。（客户端帧上限 512 KiB 而图片允许到 8 MiB，塞不进帧——所以必须有一条走字节的 HTTP 路由。）`content-length` 只作前置拒绝，真正的上限由 `readBoundedBody` 边读边数，超限即断开。
  - `GET /api/image/<sha256:hex>`：把已存的字节**读回**浏览器。转录里只有引用，所以少了这条路由，一次刷新就会让对话里明明有过的图片**静默消失**。id 是内容摘要，URL 因而不可变、可永久缓存；按形状先校验（`sha256:` + 64 位小写十六进制）再按名查找，所以请求**无法**指到任何路径；媒体类型由字节重新嗅探决定，并带 `nosniff`。
  - 图片按内容寻址存在 `~/.nova/cache/images/<sha256>`：重复粘贴是 no-op，读取时校验摘要；媒体类型由**字节**嗅探决定，客户端声明的类型只是路由提示。
  - 能力门在**发请求时**判、且只在真有图片时才查询：模型声明接受图片就内联为 `image_url` 的 `data:` URI；明确声明不接受就换成说明性占位符（而不是静默丢弃）；**声明缺失视为接受**——模态表查不到普通网关别名是常态，把「查不到」当「这模型瞎」会打瘸本来正常的视觉模型。
  - 粘贴图片在 composer 里显示 64px 缩略图（含上传中/失败态与移除按钮）。无图片的会话与本次变更前**逐字节相同**：`content` 仍是纯字符串。
  - 已发送的图片在**转录里**显示（气泡上方、与气泡同右缘），刷新后由 `GET /api/image/<id>` 重新取回；无图提示词不新增任何字段。
  
  **修正**
  
  - `imageOmittedText` 与新增的 `imageLostText` 分开：模型能收图但字节丢失时不再错误地宣称「本模型只接受文本」——那句假话会随日志被此后每一轮重复。
  - `GET /api/image/:id` 曾忘记 `decodeURIComponent`：`pathname` 不解码，浏览器发来的 `sha256%3A…` 永远匹配不上 id 形状，于是**每个真实请求都 400**。
- b21a782: **插件分层（core / standard / advanced）+ 第三方插件开关真生效 + 插件管理页重做与汉化。**
  
  三个用户可感知的故障，根因各不相同：
  
  - **第三方插件无法关闭**：`runtime-roster.ts` 把 `plugins.extra` 加载的插件**原样**塞进工具宿主，绕过了 `applyRoster` 的过滤，也从 `unknownDisabled` 的入参里缺席。于是第三方插件的名字永远进不了「关掉」这条路径——开关点了也没用。现在**四个来源（surface / builtin / extra / 内核命令）走同一道闸**（`roster-filter.ts` 的 `loadableRoster`），extra 一并纳入拼写检查。
  - **`jobs` 关不掉，报错还指着一个用户没见过的名字**：能力服务 provider 与内置工具插件**同名 `jobs`**，而"核心不可关"清单把两者一起锁了——工具行渲染了开关，每次点击都抛 `load-bearing`。provider 改名 `jobs-service`（**服务键仍是 `jobs`**，所有 `ctx.get(jobsKey)` 读者零改动），工具插件保留 `jobs`；那份手写清单删除，改由 tier 表派生（`NON_DISABLABLE_PLUGINS = CORE_PLUGINS`），**不再有第二份会漂移的名单**。
  - **`subagent` 这类进阶能力默认常开**：roster 无条件传 `subagent: {…}`，于是它既关不掉（不在核心清单里却总被装配）又不符合「按需开启」的意图。现在 `subagent` / `ptc` / `qqbot` 是 **advanced：默认关闭，写 `plugins.enable` 才进入 roster**。
  
  ### 分层与开关契约
  
  - 新增 `tier: 'core' | 'standard' | 'advanced'`：**core**（不可关、不渲染开关）＝ `toolbox` / `llm` / `approval` / `approval-gate` / `jobs-service` / `spill` / `compaction` / `sessions` / `skills` / `commands` + 基础工具 `fs-read` / `fs-write` / `search` / `ask-user`；**standard**（默认开、可关）＝ `bash` / `jobs` / `todo` / `workspace`；**advanced**（默认关、按需开）＝ `subagent` / `ptc` / `qqbot`。未知名字 fail-open 到 standard——把第三方插件划进 core 会让它**永久不可关**，那正是要修的缺陷。
  - **生效规则只有一个函数**（`plugin-tier.ts` 的 `enabledByTier`）：`disable` 命中 → 关（**disable 优先**，安全侧）；否则 `enable` 命中 → 开；否则按 tier 默认。
  - **两张表按 tier 分工**：`standard` 的开关写 `plugins.disable`；`advanced` 的开关写 `plugins.enable`（关闭＝移出 enable，**不写 disable**——后者优先，写进去就是一道回不来的单向门）。**唯一的例外是 `ptc`**，理由见下条。`KernelConfig.plugins` 与配置 schema 各加 `enable?: string[]`。
  - **`ptc` 是唯一的例外，因为它有第二个录取口**：`code.mode !== 'native'` 本身就是「我要 PTC」，roster 的 `codeModeOptIn()` 会把它翻译成一条 `enable` 表项。于是**只把名字从 `enable` 删掉不够**——推导立刻把它加回来，`reroster()` 后它仍在，校验抛 `plugin "ptc" is still loaded after disabling`：**开关点了就报错，永远关不掉**，正是本次要修的那类单向门，而我们自己犯了同一类。
    修法是 `ptc` 这一行**同时写 `disable`**（`disable` 优先于推导出的 `enable`），并让 `env.state.codeMode` 跟着行状态走（关 → `native`；开 → 若为 `native` 则升 `both`，与 `runtime-builtins.ts` 的取法一致，保证「状态」与「实际加载的插件」不会各说各话）。**两个方向都要写**：只写关不写开，残留的 `disable` 会把它**永久焊死开不回来**——同一个门朝另一边。
    其余 advanced（`subagent` / `qqbot`）没有这个推导，`enable` 单独就能决定，无需这行。
    验证不只断言内存状态：用例把落盘后的两个 list **重新喂给一个新内核**，确认重启后仍是开着的——那才是这类 bug 最容易漏掉的一环（内存对了、磁盘把门焊死了）。
  - **迁移是纯派生、不回写**：`toKernelConfig` 对既有配置推导 `enable`——`tools.code.mode` 存在且非 `native` → `ptc`；`qqbot` 块存在 → `qqbot`。`workspace` **刻意不派生**（tier=standard 默认开、disable 优先，该条永远不生效，死代码比没有更糟）。升级后老配置行为逐字不变。
  - **中文文案唯一表**（`plugin-labels.ts` 的 `PLUGIN_LABELS`）：`describe()` 与 `describePlugins()` 都从这里取名，缺条目回落到插件自己的 `name`，**绝不编造**。`PluginRosterEntry` / `PluginDescriptor` 各加 `tier` 与 `title`；`WireRosterEntry` 的 `tier` / `title` 可选，老 host 容忍。
  
  ### 插件管理页（dsh 式）
  
  - 按 **tier 三组**（核心功能 / 基础能力 / 扩展能力）取代原来的 origin 分组——origin 说的是"谁发布的"，tier 说的才是"读者能对它做什么"。
  - 核心行**不渲染开关**并说明 `plugins.locked`；扩展行标注 `plugins.defaultOff`；行可展开（`<li><button aria-expanded>`）看描述与注入的服务名（折叠时保持可扫读）；**启动失败的行排到本组最前**并给出计数。
  - 搜索同时匹配中文名、英文名、描述与注入服务名；**移除开关前的确认弹窗**（每次翻转都可原地撤销，真正的安全网是内核侧的 tier 拒绝，它带原因回话）。
  
  ### 顺带
  
  - `packages/cli/src/config.ts`（原 302 行、已超上限）把 `models[]` / `providers[]` 两份 zod schema 抽到 `config-schema-models.ts`，两者共用同一个 `modelsSchema`——顶层与供应商内的模型形状本来就是逐字相同的两份拷贝。
  - `config-write.ts` 新增 `setPluginsEnabled(names, homedir?)`：严格照 `flipSwitch` 的纪律读 raw 文档、同目录 tmp + rename、**空数组即删键**（"没有进阶插件被开启"是键的缺席，不是 `[]`）；既有导出签名一字未改。
  - `web-mode.ts` 把 `setPluginEnabledList` 接进 `persistConfig`（surface 只接一个 writer 就永远开不回 `subagent`）。
  - `roster-entry.ts` 的行构建抽成唯一实现 `toWireRosterEntry`，`roster` 帧与 `plugins` 帧两条路径由此**永远同形**。
- b21a782: 多会话不再串台；删除会话是最终的；对话列表与消息气泡按参考实现对齐。
  
  **修正（串台的三个真实来源）**
  
  - **后台 job 现在有归属会话。** 注册表是**每进程**一份（job 必须比产生它的那一轮活得久，也要跨会话切换存活），而 `list()` 不看会话：A 会话起的 `bash` 后台任务会出现在 B 会话的基线与转录里，切换后 A 的完成通知还会注入 B 的模型请求。`JobStart` 现在**必填** `sessionId`，`list` / `get` / `readOutput` / `stop` / `drainFinished` 一律按会话过滤，那个「播给谁」的监听器也按当前会话过滤。无主 job（第三方工具没传 owner）**对所有会话可见**——这是刻意的 fail-open：藏起来会让 job 不可见地跑着，行画不出来、通知送不到，等于丢掉这份工作。
  - **删除「当前打开的」会话不再被下一次写入复活。** 会话句柄持有日志路径且用 `appendFile` 追加，而 `appendFile` 会**创建**缺失文件：删掉正在运行的会话日志后，那一轮仍会把自己的消息写回去，留下一个只含删除后事件的日志——看起来被截断、还在列表里、也不是用户删掉的那个。现在 `Session.seal()` 让「删除是最后一句话」成为存储层的性质，且删除前先停掉旧会话（在飞的运行提交不进去）。
  - **切换会话时的重复行**：`list_sessions` 每个日志一行，由测试钉住不重复。
  
  **对齐（对话列表）**
  
  - 会话行的图标/搜索/清空/溢出按钮从 `border-radius: 50%` 改回参考实现的 `--dsw-radius-sm`（折叠轨道里是 `--dsw-radius-md`）——参考实现里是圆角方块，不是圆。
  - 单列表模式与搜索结果列表补回 2px 行距：它们没有分组包裹层，于是紧贴成一块，比旁边的分组树更挤。
  - 侧栏 `.logoRow` 下边距 8px → 4px；折叠态恢复 `overflow: visible`（36px 的开关比 35px 行更宽，基准行的裁剪会切掉它的右缘）；`.newSession` 的 `12px` 字面量改用 `--dsw-radius-md`。
  
  **对齐（消息气泡）**
  
  - 工具栏 chip（模型座位与权限）的圆角从 `24px` 改回 `--dsw-radius-sm`；模型座位标签字重 500 → 400（参考实现的 Figma 注记是「13/20 regular」，而相邻的权限 chip **确实**是 500——这份不对称是参考实现自己的，照抄而不是统一）。
  - 卡片窄于 560px 时三个工具组收紧到 8px 间距（参考实现的 `@container` 规则），不再提早换行。
  - 已发送的图片显示在气泡上方、与气泡同右缘。
  - 统计 pill 用 `999px` + `corner-shape: round`：全局 `superellipse(1.5)` 会把胶囊端压方，而参考实现明确配对了这两个声明。
  
  **新增的守卫**
  
  - `style-guard.test.ts` 增加**反向**检查：组件写的每个 `css.<name>` 必须真的被本子树某张表定义。原来的检查只走 CSS→消费者，于是 `ImageCard` 的 `css.pending` 在类名改成 `.spinner` 后一直没人发现（`cx()` 丢掉 `undefined`，渲染是对的，引用是死的）。这条新检查当场又抓出一个：`StatusRows.tsx` 的 `css.metricDuration` 从未被定义过，时长那一行因此一直没有样式。
- b21a782: **修复：配置声明的 surface 插件现在会作为普通插件行进入 `/plugins`，可以被列出与开关。**
  
  现象：在 `~/.nova/config.json` 的 `surfaces` 里声明 `@nova-agent/tui-app/surface` 后，`nova --tui` 能走，但 webui 的插件管理页**始终看不到**它——既不能确认它已加载，也无法通过开关关掉。
  
  根因是装配链路的一处接线缺口，而不是设计意图缺失：
  
  - plugins 侧早已就绪：`createAgentKernel` 的 `opts.surfaces`（`{ registry, loaded }`）会经由 `runtime-env` 提供 `surfaces` 容器服务，再由 `runtime-roster` 把每个已加载的 surface 用 `surfacePlugin` 包装成**普通插件行**（origin `surface`，落入 tier 表与开关）。"配置过的 surface 应出现在 `/plugins`" 是一条已写明的契约。
  - 但 cli 的三个装配点**都没把这个 payload 传进去**：`buildSurfaceRuntime`（动态 surface 路径）、`bootKernel`（exec / repl / qqbot）、`WebController.create`（`nova --web`）。于是 `opts.surfaces` 恒为 `undefined`，那条"surface → 插件行"的逻辑永远走不到——`/plugins` 自然看不到它。
  
  本次打通整条透传链：
  
  - `core` 新增 `SurfaceRows` 类型（`{ registry: SurfaceRegistry; loaded: readonly AgentSurface[] }`），`runtime-assembly` 的 `CreateKernelOptions.surfaces` 改用它，避免三处手写同形联名。
  - `cli/src/surfaces.ts` 的 `loadDynamicSurfaces` 现返回 `LoadedSurfaces`（`{ entries, rows }`），把已加载的 surfaces 和共享 registry 一并暴露；`index.ts` 将其注入 `SurfaceRequest.surfaces`。
  - 四个装配点（`bootKernel` / `buildSurfaceRuntime` / `startWeb` / 动态 surface 的 `runSurface`）从 `SurfaceRequest.surfaces` 读取并透传给 `createAgentKernel({ surfaces })`。
  - `web` 的 `ControllerOptions` 增加 `surfaces?`，`WebController.create` 转发给 `createAgentKernel`。
  
  ### 回归守卫
  
  `packages/plugins/test/surface-registry.test.ts` 新增用例：给 `createAgentKernel` 传入 `surfaces: { registry, loaded }`，断言 `kernel.roster()` 里有该 surface 的行（`origin: 'surface'`），且 surface 的插件行注册到**同一个** registry 实例。改回旧行为（谁都不传 `surfaces`）该用例即红。
- b21a782: 把终端界面（TUI）从 cli 的内置功能改造为**配置驱动的动态 surface 插件**——兑现「`nova --tui` 是一个插件，不是 cli 源码里硬挂的内部 surface」。
  
  这次是对 `tui-surface-restore` 那一份 changeset 描述的机制的**结构改造**（机制变了，功能没变）：TUI 不再是 cli 自带的 surface，而是 `tui-app` 通过公共 `AgentSurface` 契约导出的一个插件，由 `~/.nova/config.json` 的 `surfaces` 行点名后动态加载。参照系是 dsh：host 源码永不点名 `@deepseek-harness-tui/dsh-tui`，它在 `cordis.yml` 的 `plugins` 行里被动态解析。
  
  - **`@nova-agent/core`**：`AgentSurface*` 契约从 `kernel.ts` 拆出到 `surface.ts`，kernel.ts 收为纯 barrel（结构预算要求拆不要求抬）。契约仍是纯类型、零实现，core 不认识任何具体 surface。
  - **`@nova-agent/plugins`**：新增 `surface-registry.ts`——`createSurfaceRegistry()`（数组注册表）+ `loadSurfacePlugins(specs, cwd)`（动态 `import()`、`default ?? surface` 具名导出、`isAgentSurface` 校验 `{name,claim,start}` 三件齐备、缺一即启动失败）。`resolveModuleSpec` 与 `loadExtraPlugins` 共用同一原语。`surfaces` ServiceKey 仍声明、仍**无容器提供者**（刻意死缝：注册表必须先于内核装配存在，而容器是内核装配的产物——往容器里 provide 一个「内核还没装好时就要用」的东西自相矛盾）。
  - **`@nova-agent/tui-app`**：新增 `src/surface.ts` 插件入口——`export const tuiSurface: AgentSurface`，`claim` 读 `flags.tui && !flags.repl && interactive`，`start` 走 `startTuiSurface(runtime)`。package.json 新增 `"./surface"` 子路径导出，tsdown `entry` 加 `src/surface.ts`。`answersQuestions: true` 由 surface 自己声明。
  - **`@nova-agent/cli`：`cli` 的白名单从 `[plugins, ai, core, qqbot, web, tui, tui-app]` 收窄到 `[plugins, ai, core, qqbot, web]`——`tui`/`tui-app` 刻意不在列**。这是 dsh 模型：host 源码不点名 surface 包。`dep-direction.mjs` 的正则扫**全文件文本**（含注释与字符串），所以 cli 源码里**零** `@nova-agent/tui`/`@nova-agent/tui-app` 字面量——`grep` 已验。`tui-mode.ts` 删除；`tui` 的 `SurfaceEntry` 与 `import('./tui-mode.js')` 从 `surfaces.ts` 删除。
  - **`cli/src/surface-host.ts`（新增）**：`buildSurfaceRuntime(surface, m, argv)` 是**任何动态加载 surface 的通用装配点**（调用点 ③）——`runSurface()` 调 `surface.start(runtime)`，host 装内核。`userQuestions` 从 `surface.answersQuestions ?? surface.interactive` 推导（不再手抄），TUI 路径因此与 `repl`/`web` 同源——这正是 `tui-surface-restore` 漏的那一行，如今由 surface 自己声明、host 读取。`toAgentSurfaceRequest`/`toCommandPorts`/`toFlags`/`toDiagnostic` 适配。
  - **`cli/src/surfaces.ts`（重写）**：`loadDynamicSurfaces(config, cwd, argv, registry)`——`config.surfaces` 缺省→`[]`；否则 `loadSurfacePlugins` + `registry.register` + 适配成 `SurfaceEntry`（claim/start → `runSurface`）。`resolveSurface(m, extras=[])` 把动态 surface 放在 SUBCOMMAND 与 DEFAULT 之间。先序遍历保留：子命令仍最高、`--repl` 仍强过 opt-in、浏览器仍兜底。
  - **`cli/src/config.ts`**：`surfaces: z.array(z.string().min(1)).optional()`，schema 仍是 `.strict()`。注释用裸名「tui-app 包的 ./surface 子路径」——不含 `@nova-agent/` 字面量，正则安全。
  - **`cli/src/index.ts`**：`main()` 先 `createSurfaceRegistry()` + `loadDynamicSurfaces(config, process.cwd(), args, registry)` 再 `resolveSurface`。`--tui` 未在 `surfaces` 配置时给一条引导错误（点名「tui-app 包的 ./surface 子路径」），而非静默回落到 web——一个显式 opt-in 不该静默选错端。
  - **`cli/package.json`**：从 dependencies 删除 `@nova-agent/tui` 与 `@nova-agent/tui-app`——cli 不再静态依赖 surface 包。
  
  **测试**：`cli/test/surfaces.test.ts` 重写（注入一个 fake tui surface 作 `extras`，钉死动态层优先级与回落，7 个用例）；`plugins/test/surface-registry.test.ts` 新增（真实临时 `.mjs` 模块：default/surface 具名导出、no-export 拒绝、import 抛错拒绝、相对路径，9 个用例）；`tui-app/test/surface.test.ts` 新增（claim 的四个方向直测，6 个用例）。
  
  **门禁证据**：`pnpm gates` → 「依赖方向：8 个包全部符合白名单」「行数预算：409 个 src 文件全部在上限内」；`pnpm verify` → build/typecheck 全 Done、175 文件 2034 测试通过（+16）；`grep @nova-agent/tui packages/cli/src` 零命中。**「cli 不能静态依赖 surface 包」是机检红线**，不再靠约定。
  
  **未解决**：①根 `package.json` 尚未加 `@nova-agent/tui-app` 工作区依赖——裸 spec `@nova-agent/tui-app/surface` 在 monorepo dev 下从仓库根解析是否走通，需 `pnpm build` 后真机 `pnpm nova --tui` 验证（需 `~/.nova/config.json` 的 `surfaces` 行声明）；②TUI 真机验收仍无法自动化（`tui-surface-restore` 的第三条理由延续）；③调用点 ① ② 的 `userQuestions` 仍各自手传（repl/web 显式 `true`，exec/qqbot 默认 `false`）——只有 ③ 从 surface 声明推导，因为它服务第三方 surface。
- b21a782: 以插件形态恢复终端界面（TUI）：`nova --tui`，显式 opt-in，管道下自动回落 `--repl`。
  
  参考 `dsh-TUI`（dsh 的 TUI 插件）补齐「dsh 只有 WebUI」的缺口，但**不移植它的实现**——那一层是 React 19 + react-reconciler + Ink 与约 30 个 `@deepseek-ai/*` peer，而本仓的 surface 姿态是零第三方依赖。移植的是**能力**，实现用本仓自己的分层：
  
  - **`@nova-agent/tui`（新增，零依赖）**：字符宽度表（CJK/emoji 双宽）、ANSI 清洗、键序解码、cell 网格与增量重绘。**不认识内核**——它只认「字符格 + 按键」。空白的依赖白名单由 `dep-direction.mjs` 机检，所以「零依赖」是门禁保证的性质而非约定。
  - **`@nova-agent/tui-app`（恢复并扩展）**：与 web 同构的 surface。`blocks.ts` 归约、`panels.ts`/`question-card.ts` 渲染、`keys.ts` 键链全是纯函数（`tui` + `tui-app` 共 17 个测试文件 / 261 个断言，全部在无 TTY 的测试车道直测），`app.ts` 只做「把纯层输出写进 stdout」。当初 TUI 被删的三条理由中，前两条由这次分层直接解掉：渲染层不再与产品逻辑纠缠，终端状态只有 `stop()` 一个出口。
  - **提问卡**：`ask_user_question` 在终端也画得出来并答得了，语义与 web 侧逐字对齐（`question.ts` 是 `web/ui/src/question/decisions.ts` 的一对一移植）——跳过算决定、选项与自由文本互斥、id 走 `Object.hasOwn` 防原型链命中。
  - **`userQuestions: true`（`cli/src/tui-mode.ts`）**：这是 `ask_user_question` 的 opt-in，默认 false 且 fail-closed。恢复 TUI 时它正是漏的，于是工具在、UI 在、提问永远不发生（模型只会收到 `no user-questions answerer accepted the request`）。三个装配点（`kernel-boot` / `web/controller` / `tui-mode`）现在一致。
  - **`pendingQuestions()` 回放**：`start()`/`setAgent()` 除了挂起审批还要回放挂起提问，否则在一个已经停等中的 run 上永远画不出卡片——那个 run 的事件早已发完，而 surface 是后挂上来的。
  - **`--tui` 的认领规则**：排在 `web` 之前（否则默认形态会吃掉它），但带 `interactive` 前置条件，所以朝管道画帧不可能发生；`--tui --repl` 时 `repl` 胜出。两个方向都有直测钉住。
  - **argv 解析拆出 `cli/src/cli-args.ts`**：`parseArgs` 与「谁来服务这行命令」是两个问题，拆开后 `surfaces.ts` 的上限从 258 降到 205。
  - **`tui`/`tui-app` 纳入锁步版本组**，工作区 9 个成员、8 个受白名单管辖。
  
  **未解决**：TUI 的真机验收仍无法自动化（`pnpm smoke:web` 的终端对应物还不存在），这是它当初被删的第三条理由，也是唯一没被这次恢复解掉的一条。见 `AGENTS.md` §7.4。
- b21a782: **WebUI：修掉用户报的 8 处与参照实现（dsh）不一致的地方。** 逐条都能在 dsh 源码里找到出处。
  
  **转录**
  
  - **不自动跟随**：滚动容器解析错了。真正的滚动元素是外层的 `[data-conversation-scroll]`（`ChatView.module.css` 把 `.scroll` 强制成 `overflow: visible`），而代码在往 `.scroll` 写 `scrollTop`。新增 `scrollportOf()` 统一解析，贴底判定、`ResizeObserver`、翻页与回底按钮全部改走它。
  - **用量 pill 闪烁**：判定条件用错。改为 dsh `TurnTailNodeView.tsx` 的 `endsWithResponse`（该轮是时间线最后一轮**且**回复非空），去掉了错误的 `!running` 门。
  - **「用量 … tok」与回复的间距不对**：尾行此前渲染在**答复行内部**（同一个 React key），列的 16px 节奏从不作用于它。改成**独立 flow 行**，于是 16px + 4px = 20px，与 dsh 的 `turn-tail` 规格一致。
  
  **输入区**
  
  - **粘贴的 .mp4 卡片位置错乱**：缺 dsh `.rail` 的 `margin-bottom:-6px` 与 `padding:2px 10px 0`；同时按 dsh 把 `overlayAnchor` 提到卡片首个子元素。
  
  **工具与代理**
  
  - **调用 subagent 无端要求审批**：`permission: 'execute'` 是元凶——`autoAllows` 从不放行 `execute`，所以缺省 `read-only` 档每次都弹窗。改为 `'read'`：委派本身不是副作用（dsh 里**没有**每工具权限字段，且把子代理策略钉成 `never`），嵌套调用仍逐个过同一道审批门。
  - **subagent 显示与 dsh 不一致**：新增 `subagents` 语义 kind（`ToolCallKind` 因此**加了一个成员，属公共面新增**）+ `subagent-view.ts` 的 `presentCall` / `presentResult`（标题「创建代理」、后台标记、报告全文），对齐 dsh 的 `tool.title.subagent` 与「代理回复」。
  
  **模式与工作区**
  
  - **运行中可切换模式**：服务端此前没有守卫。`set_approval_mode` / `set_code_mode` 在 `agent.running` 时回错误帧（「运行中不能切换访问模式」/「运行中不能切换执行模式」），客户端两个 chip 同时 `disabled || running`。这是一处**有意的加严**：dsh 的 `locked = disabled` 不含运行中，用户明确要求两侧都锁。
  - **注入了错误工作区的项目文档**：见单独的 `workspace-context-reseed.md`。
  
  **前端 reducer 的两处缺陷**（本轮补）：
  
  - **事件分类不是全集的（潜在沉默丢弃）**：`state-events.ts` 用两个谓词把 `KernelEvent` 分成「转录」与「运行状态」，两者都以 `default: return false` 收尾。于是**新加一个内核事件变体会被静默丢掉**——编译不报错、测试不会红，只是那一路上线后没有渲染（本仓已经出现过同类的「声明齐全、消费者齐全、唯独没有生产者」）。而 AGENTS.md 的规矩正是「判别联合的穷尽 switch 以 `assertNever` 收尾」。现在两个谓词 + 一个**显式的 `IgnoredEvent` 联合**必须覆盖全部 28 个变体，`classifyEvent` 以 `assertNever` 收尾：漏掉一个变体是**编译错误**（已实测：把 `command` 移出转录集，`tsc` 报 `not assignable to parameter of type 'never'`）。两个真正不绘制的通道（`message`、`turn_aborted`）不再藏在 `default` 里，而是进 `IGNORED_REASONS` 并各自写明理由。测试再钉一层：变体清单必须是 28 个，且「被忽略集」恰好是这两条。
  - **`NOTICE_LABELS` 的原型链查找（真 bug）**：`NOTICE_LABELS[event.code]` 在 `code === 'constructor'` 时返回的是**原型链上的 `Object`**，而不是 `undefined`——于是那句 `meta === undefined` 的兜底**判不出来**，hint 会渲染成 `undefined · <正文>`。注意 `client.ts` 的事件来自 `JSON.parse(...) as ServerFrame`，是**未经校验的断言**，所以这条路径不是理论上的：畸形/伪造帧就能触发。改用 `Object.hasOwn` 判定（与本仓其它 8 处同类修复同一纪律），并补回归测试覆盖 `constructor` / `toString` / `valueOf` / `__proto__` 四个敌意 code。
  
  **内核：被拒工具调用漏发 `tool_call_start`（真 bug，现场与回放不一致）**
  
  `length` 截断与「参数不是合法 JSON」两条防御路径此前只发 `tool_call_result`，**不发 `tool_call_start`**。而 surface 的工具行是**由 `tool_call_start` 建立的**（`state-events.ts` 的 `mapTool` 找不到对应行就原样返回），于是同一次运行出现两种画面：**浏览器当场什么都不显示**（那批工具失败了却像没发生过），而**刷新一次却能看到失败行**（回放走 `transcript.ts`，按 assistant 的 `tool_calls` 配对结果重建）。用户能观测到的差异就是「刷新前后不一致」。
  
  修法是让「拒绝一个调用」与「执行一个调用」一样**成对发出开始与结果**，并把 `refuseCall` 与 `synthesizeMissingToolResults` 一起放进新的 `agent/refuse.ts`——两者是同一条不变量的两面：**消息日志必须为每个 assistant `tool_calls` 都留下一条结果**，无论那个调用是被拒绝、被拒绝授权、还是被消费者中途丢弃。`loop.ts` 因此从 211 行降到 189 行（低于 212 的上限，无需放宽）。回归测试在两条防御路径上各自断言「START 存在、id 一致、且排在同一条结果之前」——把 `refuseCall` 里的那行 `yield` 去掉，两个测试立刻变红。
  
  **设置面板与外壳的四处缺陷**（本轮补，来自对 `ui-settings-*` 的一次专项审计）
  
  - **设置面板的两个模式选择在运行中仍可点（真 bug，违反既定决策）**：面板把 `disabled` 接的是 `composerDisabled()`，而那个函数**没有 running 项**（只判连接与挂起提问/审批）；composer 座上的同两个 chip 接的却是 `disabled || running`。于是运行中点下去只会换来服务端一句「运行中不能切换访问模式」，而这条错误落在**转录里的一条瞬时 hint**，不在读者正看着的面板上；控件还保持可点，可以反复点。这与既定决策「运行中一律禁止切换（审批模式 + 执行模式都锁）」直接冲突。修法是把这条规则**收成一处**：`chrome-view.ts` 新增 `modeControlsLocked = composerDisabled || !isIdle`，`isIdle` 从 `chromeView()` 里提出来供两者共用（顺带让 `chromeView` 不再复制那份判断），面板改接它。回归测试覆盖 thinking/writing/tool/compacting/retrying 五个相位。
  - **`ModelSection` 的缓存门与它自己的注释矛盾**：注释写「每次打开都按需取」，代码却是 `if (catalog === null)`——**每个会话只取一次**。而面板关闭即卸载、`catalog` 留在 reducer 里，所以除首次外的每次打开都用着可能任意陈旧的列表；composer 的 `ModelSeat.show()` 才是真的每次都发。改为无条件发（与 seat 及注释一致），失败仍有显式的「重试」按钮兜住。
  - **搜索框把 Escape 吞掉（真 bug，键盘死键）**：外壳的既定规则是「焦点在文本框里时 Escape 归那个框，不归外壳」（`modal-layer.ts` 明文写着）。`DirectoryBrowser` 的两个输入框照此实现了（Escape 取消本次编辑），但 `PluginsSection` 的搜索框**什么都没做**——于是那条「归字段」的规则在这里变成了**Escape 完全失效**，读者除了鼠标没有出路。两处一起修：字段用 `data-modal-escape-owner` **声明**它接管 Escape（搜索框清空查询，再按一次才关面板），而 `modal-layer` 改为**只对声明了的字段让行**——原来是对所有 `INPUT`/`TEXTAREA` 一律让行，这正是「声明与消费者齐全、却谁都没做事」那类死代码的温床。静态测试钉住「该标记只随搜索框出现」。
  - **`models.intro` 是一句照抄来的错误指引**：文案逐字取自 dsh，而在 dsh 里那一节**确实有 API 密钥输入框**；Nova 的这一节只是模型列表，照着做的人找不到任何可填的地方。改为描述它真正做的事（选择本会话所用模型）。另外删掉一个**全仓无消费者**的文案键 `models.current`。
  
  顺带修正 `SettingsPanel.tsx` 头部注释里过时的节数（写着「本界面只注册一节」，实际 `App.tsx` 注册了三节），并补上它与 `PluginsSection` 的 `onClose` 接线。
  
  **「渲染了但从未接通」的分叉按钮（本轮订正一条既有错误结论）**
  对照 dsh 的 `ui-chat` 时发现：Nova 的 `chat/MessageIconActions.tsx` 把分叉按钮的**全套渲染分支都写好了**（`onBranch !== undefined` 才渲染、`branchUnavailable` 时保留焦点并附理由），`MessageItem.tsx` 的 `UserMessageRow` / `AssistantTailRow` 也把 `onBranch` 一路透传——但**全仓没有任何调用点传过它**。实测探针：真实生产行 `AssistantTailRow` 渲染出的 HTML 里 `复制` 存在、`分支` 不存在。也就是说这个按钮在真实产品里**从来没有出现过**，而 `branchUnavailable` 描述的是一个不存在的座位。
  
  它之所以一直没被发现，是因为 `chat-message-chrome.test.ts` 里那条测试**手工把 `onBranch` 喂给组件**——组件层断言全绿，接线层却一次都没被覆盖。这正是本仓 AGENTS.md 记着的那类缺陷（声明与消费者齐全、唯独没有生产者；测试照着手写 fixture 一路绿）。本轮补上另一半：新测试断言**flow 层真正构造的行只提供复制**（探针值直接变成断言），并说明这个 prop 何时才可以被接上——参照实现在 `TurnTailNodeView.tsx:69` 接的是 `forkAt(data.seq)`，而 Nova 的 `WireBlock` **不带 seq**，内核也没有「在某个日志位置分叉出一条新会话」的操作。**缺的不是渲染，是能力与锚点**；此前 `docs/dsh-parity-inventory.md` 把这一行记作「已有复制/分叉」，是把渲染分支误读成了已接通的入口，本轮一并订正。
  
  （不接线的理由已写进测试注释：若要接上，必须**先**给 `WireBlock` 加锚点并实现 fork 操作，再反转那两条断言。四个目标后端文件目前都恰好卡在行数上限，这个改动无法顺手带上。）
  
  **问题卡被一个模型给的问题 id 崩掉（真 bug，「`?? fallback` 挡不住原型链」的第 10 处）**
  
  `ui-user-questions` 的草稿表是对象字面量，查表写的是 `drafts[question.id] ?? EMPTY_DRAFT`——而问题 id 是**模型给的**（`ask-user.ts` 的 `parseQuestions` 只限长度、不排除 `constructor` 这类名字）。对 `id: "constructor"`，`drafts['constructor']` 取到的是**继承来的 `Object` 函数**而不是 `undefined`，所以 `??` 的回退分支**永远不会走**，`isComplete` 拿到一个函数去读 `.length` 就抛 `TypeError: Cannot read properties of undefined (reading 'length')`——**整张问题卡当场崩掉**，用户既答不了也退不出。
  
  实测（探针跑了真实函数）：`allComplete` / `firstIncomplete` / `buildAnswer` / `isComplete` **四个全部抛错**；`__proto__` / `toString` / `valueOf` / `hasOwnProperty` 同理。这与本仓此前的 9 处是同一个缺陷类（MIME 表、工具标签表、语言表、通知表……），而这次的下游后果最重：不是显示错一个字，是卡片整个抛异常。
  
  修法遵守单一实现：`question/decisions.ts` 新增**唯一**的安全查表 `draftOf(drafts, id)`（`Object.hasOwn` + 强转），四处调用点（`allComplete` / `firstIncomplete` / `buildAnswer` 与 `QuestionPanel.tsx` 的当前草稿）全部改走它。回归测试用五个继承成员名逐一钉住「回落值可用」（不只是「非 undefined」——还断言 `isAnswered` / `isComplete` 为假），并另加两条：一个整批都是恶意 id 的批次**四处都不得抛错**、以及读者真答了那道题之后**仍能读回自己的草稿**（防止守卫过度拒绝）。变异验证：把 `draftOf` 换回 `??` 写法，2 条测试立刻变红。
  
  审计过程中一并核对了其余同类的 id 键控表（`sidebar/view.ts` 的展开表、`SessionBrowser` 的折叠态、`DiffCard` 的行类表）——这三处要么已用 `Object.hasOwn`，要么只做 `=== true` 比较、不会把函数当值解引用，**无需改动**。
  
  **附件功能整体是空转的（真 bug，本轮最重的一处，来自对 composer 的一次专项审计）**
  
  三个入口（拖入 / 粘贴 / 隐藏 picker）都会把文件 `POST` 到 `~/.nova/cache/uploads/` 并在待发送栏里画出一张卡——但**模型永远不知道这个文件存在**：`UploadedFile.path` 记下了宿主存的绝对路径**却没有任何消费者**（全仓 grep 只命中它自己的文档注释），`ClientFrame` 没有任何附件字段，`agent.prompt(text)` 只接受字符串。而 `attachments.ts` 的模块头注释还断言「那条路径就是草稿引用的东西（见 `formatMention`）」——一句与实现相反的话。这也是它一直没被发现的原因：卡片长出来了、进度条动了、`bytes` 也对，看起来整条链路是通的。
  
  修法沿用本仓既有的诚实路径——**引用本来就是文本，不是协议对象**：新增 `attachmentMentions()`，把每个 `ready` 行的绝对路径按 `formatMention` 的语法写成 `@path` / `@"path with spaces"`，追加在提示词尾部。`read_file` 能解析绝对路径，而上传目录本就是两个 trusted read root 之一，所以模型免审批即可读取；**不需要新帧、不需要动内核**。三个细节都有测试钉住：**只写已落盘的**（进行中/失败的行没有路径；尤其 `retry()` 会把行改回 `uploading` 却**不清 `path`**，所以那道状态判断是承重的，变异验证过）、**语法表达不了的路径跳过而非改写**（控制字符与 `"` 无法转义，硬写会指向另一个文件）、**没有附件时提示词逐字不变**。命令帧不带附件（`/command` 不是提示词）。
  
  同一轮修掉的三处相邻缺陷：
  
  - **发送后附件栏永不清空**：`submit()` 只清草稿与光标，`useAttachments` 连 `clear` 都没有。于是已发送的卡**留在栏里装作还没发**，下一次发送会再带上它一遍；又因为 composer 不随会话重挂载，它还会跟着读者跨会话漂移。补 `clear()` 并在提交时调用——mention 已进转录，卡片的使命结束。
  - **拖入文件夹被静默吞掉（真 bug，且是一句运行期不可达的文案）**：`add()` 会返回拒绝文案，隐藏 picker 那条路把它交给了界面；但 drop 与 paste 的监听器绑在 hook 内部，**没有调用方可返回**，返回值得到了却不用。更糟的是浏览器文件对话框选不了目录，所以唯一的发布点**永远不可达**——`DIRECTORY_REFUSED` 从未出现在屏幕上，而「把文件夹拖进来」恰是桌面上最常见的动作。给 hook 加 `onRefused` 汇聚点，三条入口统一经 `admit()`：任一条都不可能再忘记发声。
  - **（该条已随上传功能移除而失效）** 曾有一条「上传未完成时 Enter 照样发送」的修复：`primarySeat` 只看 `disabled || empty`，与上传状态无关，于是传输中按 Enter 会发出**指向尚不存在文件**的提示词；当时补了守卫并把 `canSubmit` 改为读**座位自己的判定**（`seat.kind === 'send' && !seat.disabled`），使按钮与 Enter 不可能各说各话。上传已整体删除（附件改为指向文件原位的 `@path` 引用，见 `model-end-rework.md`），**没有传输态，也就没有这个窗口**——`primarySeat` 现在恒传 `uploading: false`，但「按钮与 Enter 读同一个判定」的修法保留了下来。
  
  **同一审计确认的三处「注释与实现相反」与三处视觉偏离**
  
  - **`usageAction` 在 `clock="start"` 座位被静默丢弃**：`endInfo` 只为 `end` 分支计算、又只渲染 `endInfo`，所以选 `start` 的调用方接受并透传了这个 prop 却永远看不到它。dsh 的尾行是 `clock === 'end' ? <span>{usageAction}{clockEl}</span> : usageAction`——两个座位都渲染。当前两个调用点恰好都是 `end`，属**潜在**缺陷，但位子已经挖好；已补齐并加测试（变异验证：改回 `null` 即红）。
  - **统计条的「输入」行与自家面板自相矛盾**：`promptTokens` 是**计费输入**（已含缓存读取），却被标成「输入」摆在「缓存读取」上方——**上一个数包含下一个数**。dsh 该位置印「未缓存输入」，而 Nova 自己的 `TurnUsagePill.tsx:84` 早就那么算了。改为 `未缓存输入 = promptTokens - cachedTokens`，一个会话不再对同一个数字有两种说法。
  - **`QueueDock.module.css` 声称「本仓没有 `-dimmed` label 档」**：该 token 在 `design-platform.css` 明暗两档都有定义，且 `MessageItem.module.css:158` 已在用——替代理由不成立，已改回 dsh 的原 token。
  - **`InputBar.tsx` 头部声称「没有附件入口、没有 `@` 参考目录」**，而该文件同时 import 了两者——正是这句过时注释把上面那个真实缺口藏了起来。已改写为准确描述。
  - **触发菜单的可高亮行对读屏软件不可见（真 bug）**：focus 一直留在草稿框里（combobox 模式），所以「箭头停在哪一行」此前**只表现为一个 CSS 类**——listbox 没有 `aria-activedescendant`，行也没有 id。读屏用户听得到列表，却听不到哪一行已就绪（`aria-selected` 对不持有焦点的行不播报）。按 dsh `MenuView.tsx:134` 的做法把指针挂在 listbox 上，行 id 由同一个 `listboxId` 派生（不传 id 则 id 与指针**一起消失**，不会留下悬空引用）；无高亮时不写该属性——指向一个不在 DOM 里的元素比什么都不指更糟。
  - **触发菜单会长到会话标题栏上面**：`MENU_MARGIN` 取的是通用 `Menu` 原语的 12px，而这个菜单和 dsh 的 input trigger 坐同一个位置、锚在 76px 标题栏之下（`SessionHeader.module.css` 的 `min-height: 76px`）。菜单是 `position: absolute`，标题栏**不会把它推下去**，于是一份长的 `@` 列表会盖住标题栏。dsh 在同一座位用 `TOP_MARGIN = 84`（76 + 8px 余量），已对齐。
  - **`QueueDock` 三处圆角各差一档**：顶栏 `12px` 应为 `--dsw-radius-lg`（16px）、标题行与列表行 `8px` 应为 `--dsw-radius-md`（12px）。同一张卡上三处可见差异，而同文件 `border-radius: inherit` 说明它本来就知道这里靠 token 传递。
  - **composer 主卡圆角写死 `22px`**：dsh 在同一规则用 `var(--dsw-radius-panel)`（本仓定义为 28px，`SettingsPanel` 已在用该 token），是产品最显眼表面上 6px 的偏离。
  - **两个模式 chip 的焦点环用 `--dsw-alias-border-l3`**（一档边框色）而非 `--dsw-focus-ring-color`：后者本仓已定义且在另外五个样式文件里使用——这两个 chip 是仅有的**不显示焦点色**的可聚焦控件。
  
  **验证**：`pnpm verify` 全绿（116 文件 / 1347+ 测试）；本轮每条行为修复都做了**变异验证**（恢复缺陷 → 确认变红 → 恢复修复 → 确认变绿），并有两处因变异未被捕获而**加强**了测试（`retry()` 遗留陈旧 `path` 的可达路径、`usageAction` 在 `start` 座位的渲染）。
  
  **侧栏/工作区审计再修四处（同一轮的第三个审计面）**
  
  - **`frameAction` 的查表挡不住原型链（真 bug，本缺陷类的第 11 处，也是最后一处）**：`MAPPERS[frame.type]` 是裸索引，而**从 `JSON.parse` 到这里之间没有任何东西校验判别式**（`client.ts` 直接 `as ServerFrame`）。于是 `type` 命中 `Object.prototype` 的成员名时，取回的是一个**函数**并被当作 mapper 调用：`valueOf` / `hasOwnProperty` 在 socket 的 `onmessage` 里抛 `TypeError: Cannot convert undefined or null to object`，`constructor` 返回一个假 action、落不进 reducer 的 `switch`，使 state 变成 `undefined`。已用 `Object.hasOwn` 收口（**未识别的帧必须被忽略，而不是被路由**），并实测枚举六个继承成员名逐一不抛、且真帧与普通未知字符串行为不变。
  - **断开 socket 会让目录选择器变成死局（真 bug）**：`connection` 分支清了 `historyPending` 与 `trace.pending`，**唯独漏了 `directory.pending`**；而那个标志是承重的——对话框自己**以 `!pending` 为条件**发起首次列举，同时 `pending` 期间「新建文件夹」与「打开」都被禁用。于是在列举途中掉线会留下一个**没有任何帧能解除**的死局，只能关掉再开。已按同一规则清掉（已画出的层级留在屏幕上，只丢在途标志）。
  - **一次点击发出两份 `list_directory`**：`App.tsx` 的 `onBrowse` 自己 `send` 了一次，而对话框挂载后其开屏 effect 又发一次，两个答复还会互相竞争（落败者顺手清掉 `error`）。按「一个手势一个请求一个主人」去掉前者，让对话框的 effect 成为唯一发起者。
  - **`DirectoryState.creating` 是死状态**：三处写入、**全仓零读取**，也没有任何调用方传过 `directory_ask.creating`（`App.tsx` 两处都传裸 action）；对话框的「新建文件夹」用的是它自己的 `draft`。整条链路（类型、action 字段、三处赋值）已删除，并同步修掉两条仍在断言该字段的既有测试。
  
  **同一审计面里被驳回/确认无问题的**（记录以免下次重复审）：`sidebar/view.ts:115` 的 `Object.hasOwn(known, key)` 与 `view.ts:180` 的 `expansion[key] === true` 都安全（后者与字面量 `true` 比较，继承来的函数过不了）；auto-expand effect 虽然在 deps 里写了它自己会写的 `expansion`，但**不是死循环**——写入后键变成 own property，`autoExpandKey` 随即返回 `undefined`，下一轮不再更新状态，多跑一趟即收敛；`AnimatedRows.tsx`、相对时间分桶、`SessionBrowser` 每次渲染只读一次 `Date.now()`、侧栏轨道下传 `state={undefined}`、删除确认框把 `data-modal-autofocus` 放在「取消」——都与参照实现一致。
  
  **引用菜单与目录下钻在键盘上完全不可用（真 bug 三处，来自对 composer 的第三次审计）**
  
  - **`@` 文件菜单无法被 Enter/Tab 选中**：菜单的开合由**两个**触发源决定（`slashQuery` 的 `/` 令牌 **或** `atQuery` 的 `@` 引用），但判定「Enter 该不该收下高亮行」的 `menuSettlesOnEnter` **只认 `/`**。于是文件菜单明明开着，Enter 却落到发送路径，把 `@src/ma` **当散文原样发出去**——高亮的那个文件从未被采纳。已让两个触发源给出同一答案。
  - **目录下钻的 chevron 是个渲染出来的空操作**：`ComposerMenu` 声明了 `onDrill`、把它接进了 chevron 的 mousedown，**但唯一的调用点没传**（`onDrill` 全仓只出现在 ComposerMenu 自己内部）；而那个 handler 又 `stopPropagation`，所以点击既不下钻也不选中，整次点击被吞掉。同一道缝也解释了 Tab 从不生效——它被折进 settle 分支，没有下钻路径。已补 `onDrill={pick}` 并把 Tab 接成 chevron 的键盘孪生。
  - **选中的目录令牌一写出来就是死的**：`referenceDraft` 一律追一个空格、`formatMention` 一律闭合引号，于是 `atQuery('@src/ ')` 与 `atQuery('@"my dir/" ')` **双双返回 null**——即使 chevron 修好，也没有可续接的令牌。dsh 的 `formatFileMention` 对目录**故意让引号保持打开**（`@"my dir/`）、且不追空格。已按此对齐，并让 `formatMention` 显式收一个 `directory` 参数而不是靠调用方拼斜杠。
  - **把整段按键仲裁提出组件**：为了让上面这条**可断言**（UI 测试车道没有 DOM），`menuKeyDecision(key, draft, caret, row, reference)` 成为 `command-menu.ts` 里的纯函数。这正是一道藏 bug 的缝——**调用方漏传 caret**、判定只认一个触发源，两个缺陷都因为内联在组件里而无法被测试捕获。现三条变异（去掉 `reference`、caret 强制取尾部、去掉 Tab 下钻）都会让测试变红。
  - **`mentions()` 是死导出**：文档声称它用于「从文本本身渲染附件 chip，使 chip 不会比它代表的令牌活得更久」，而全仓只有它自己的测试导入它。已删除函数与测试。
  
  **会话分组的「展开其余 n 个」改成按块步进**：此前是一个布尔成员集，一次点击把 40 个会话全放出来（200 个会话的工作区从 5 行直接跳到 200 行）。参照实现用**每组的数字上限**、每次点击推进一个 `COLLAPSED_SESSION_LIMIT`（5），并在「下一块就够装下剩余」时一次开满——这样最后一次点击落在「收起」而不是留下第二个只剩两条的溢出行。已按此实现 `nextSessionLimit`，并保留参照实现的两个计数分工：**控制按钮是否出现**看折叠态（开满后仍是回退手势），**按钮文字**看在途上限。`SessionBrowser` 的 `revealed` 集合随之换成 `sessionLimits` 数字表（也进了 `resetKey`）。
  
  **侧栏连接指示器：重连按钮从未接通，且缺三条状态规则**
  
  - **整条重连链路没有任何生产者**：`ConnectionIndicator` 声明 `onReconnect`、接进 `<button onClick>`、据此渲染 `.hoverLabel` 与两条无障碍标签——**但唯一的调用方 `SidebarFoot` 没传**。线上永远走只读分支，`<button>`/`onClick`/`.hoverLabel`/`.warning:hover` 全是**不可达死代码**，掉线时读者只看到不能点的标签。已接通 `App → Sidebar → SidebarFoot → ConnectionIndicator`。
  - **手动重连会让退避越走越远**：退避上限 5s，只调 `close()` 的话读者每按一次「重连」都继承已长大的延迟——**自己的点击把自己推得更远**。已让手动重连折叠等待并把退避重置回 500ms（`nextRetry` 纯函数，含上限与重置两条规则）。
  - **胶囊进出场**：dsh 有 150ms 淡出与进场 keyframes，Nova 是当场 `return null`。已补 `indicatorTransition` 纯函数 + 定时器，并让 `reduced-motion` 同时关掉动画与过渡。
  - **`connecting` 胶囊闪一帧**：dsh 的 `CONNECTING_MIN_VISIBLE_MS = 800` 最短可见时长**优先于**「连接成功」确认（否则 2s 确认窗口被保持吃掉）。已按同一分支顺序实现。
  - **三处视觉偏离**：高度 32→28px（与旁边的设置触发器同高，否则掉线时脚行变高）、补 `1px transparent` 边框、补 `hover` 态。
  
  **两处「把 `Object.prototype` 的成员当数据用」的第 12、13 处（同一缺陷类，均已实测复现）**
  
  - **`SubagentRow` 会把函数源码打印进转录**：`SUB_STATUS_LABELS[sub.status]` 是裸索引，`sub.status` 来自 `subagent_update` 帧。用 `constructor` 实测，**渲染出的 HTML 里含 `function Object() { [native code] }`**——读者转录里出现 JavaScript 源码。`JobRow` 同一写法。已收口到 `statusLabel(table, status, fallback)`。
  - **`traceRowText` 会把继承函数当标签返回**：`ROLE_LABEL`/`COMPACTION_LABEL`/`OUTCOME_LABEL` 三处裸索引，键都是 `trace` 帧的判别式。实测 `typeof text.label === 'function'`——轨迹面板会把函数交给 React 渲染。已收口到 `pick(table, key, fallback)`。
  - 两处守卫都做了**变异验证**（改回 `table[key] ?? fallback` 立刻变红）。
  
  **设置面板新增三个管理页：Skill 中心 / 插件管理器 / QQ 机器人**
  
  - **Skill 中心**：列出项目级与系统级的全部 Skill，每个带一个开关；关掉后该 Skill 不再进入后续对话的技能索引（`skills.disable`，按名匹配两个层级），但**仍留在列表里**可随时开回来。
  - **插件管理器**：按「系统插件 / 第三方插件 / 内核能力」分组展示运行状态与自述，每个可单独开关（`plugins.disable` 的界面入口；`subagent` 这类可选插件因此可以按需关掉）。**承载型插件**（toolbox / llm / approval / jobs / spill / compaction / sessions / skills / approval-gate / commands）拒绝关闭并说明理由——关掉它们等于把工具面拆掉，而不是「少一个功能」。
  - **QQ 机器人**：第三方渠道插件的独立配置页，展示 appId 与密钥的存储状态、保存后写回配置、并可就地「测试连接」。**密钥永不回显**：有 `{env:NAME}` 引用时页面显示**变量名**而非值，字面密钥只显示「已配置」；留空表示保持已存密钥不变。
  
  **本轮修掉的 3 个真 bug**（三个都在上面三个页面的实现里，且都逃过了并行开发时的各自单测）：
  
  - **Skill 开关是单向的（最严重）**：面板的行从 `kernel.skills` 建，而那是**过滤后**的列表、`enabled` 还硬编码 `true`。于是把一个 Skill 关掉，它就从面板里**消失**，再也点不回来——`skills.disable` 只能在配置文件里手改。已补 `allSkills`（未过滤的发现）与 `disabled`，行按真实开关集算 `enabled`。
  - **`clientSecretRef` 永远为空**：`web-mode.ts` 拿 `loadConfig()` 的结果去匹配 `{env:...}`，但加载已经跑过 `expandDeep()`、那里**已是明文**，正则永不匹配，页面永远显示不出「引用环境变量 NAME」。已加 `readQqBotSecretRef()` 读**原始文档**（与所有写入者同一份「绝不把展开后的对象写回去」的纪律）。
  - **被拒绝的开关会永久卡死整页**（`SkillsSection` / `PluginsSection` / `QqbotSection` **各犯一次**）：三个组件都等「下一个快照到达」来清 in-flight 状态，注释还写着「拒绝走 error 帧，另一处处理」——而**那个「另一处」不存在**。拒绝时快照永不变，控件（在插件/Skill 页是**整页所有**开关）从此永久禁用。已在 reducer 的 `error` 分支加 `manageError` 信号，三处各补一条监听。
  - **QQ 页主按钮不可读且违反样式护栏**：用了半透明的 hover 浮层色当实心填充、配字面 `#fff`（后者被 `style-guard.test.ts` 直接抓住）。已改用全仓统一的实心按钮配方。
  
  **结构**：`pnpm gates` 一次抓出 15 个越限文件，其中 `config-write.ts` 是 4 倍超限。按职责拆了三处：`config-doc.ts`（**怎么改**：原始文档读写 / 原子替换 / 拒改不可解析文件）与 `config-write.ts`（**改什么**）、`config-read.ts`（**读什么**：存的是哪个变量引用、现在能不能用）、`config-expand.ts`（`{env:NAME}` 的展开规则）；另拆 `runtime-assembly.ts`（surface 要**提供**什么）与 `runtime-types.ts`（surface 会**消费**什么）。
  
  **插件不得阻塞主线程：`qqbot` 未配置不再让 `nova` 起不来（真 bug，用户报告）**
  
  `loadConfig` 对整份文档跑 `expandDeep`，任何未解析的 `{env:NAME}` 一律抛错。但 `qqbot` 是**第三方渠道插件**，它的凭据只有 `nova qqbot` 用得上——浏览器界面、REPL、`exec` 全都不读这个值，却一起被它拖死：用户配了 `qqbot.clientSecret: "{env:QQ_SECRET}"` 而没设该变量，`nova` 直接退出并只打印一句关于那个变量的话。
  
  修法是把展开按**归属**切片：核心段（`provider`）保持加载即抛（没有可用凭据的 provider，起了也跑不了一轮），插件自有段则**保留字面并记录诊断**，由拥有者在真正需要它的地方报错——`nova qqbot` 明确点名哪个字段哪个变量，浏览器界面把提示挂在该插件自己的设置页上。**保留字面而非替换成空串**是刻意的：空串凭据会发到网上换回一个没头没尾的 401，留字面至少自解释且能被按名字拒绝。名单是**插件白名单**而非核心黑名单，所以以后新增的段默认仍属核心、仍会大声失败。
  
  **验证**：`config.test.ts` 新增 11 条覆盖两个方向（插件段降级 / 核心段仍致命 / 混合文档 / 每变量只报一次 / 保存后从磁盘重判）；变异验证把 `qqbot` 移出白名单 → 4 条立刻变红。另加 UI 静态渲染测试。`pnpm verify` 全绿（120 文件 / 1443 测试）。
- b21a782: **内核：工作区切换的上下文重播种下沉到内核，把「换项目后仍注入旧文档」从每个 surface 的职责变成一个机制。**
  
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

### Patch Changes

- b21a782: 把「这个 surface 有没有人可回答 `ask_user_question`」的推导收口成一个 core 纯函数 `deriveUserQuestions(caps)`（返回 `answersQuestions ?? interactive ?? false`，fail-closed）。
  
  此前这条规则在 `plugins/runtime-env.ts` 的服务端 provider 与 `cli/surface-host.ts` 的 `buildSurfaceRuntime` 各写一遍——规则若变，两处会不同步，且没有任何测试钉住。现在两个读它的地方共用这一个函数，规则变更先改函数、`core/test/user-question.test.ts` 先红。直测钉住：有人 surface 且有声明 ⇒ true、交互式 surface 缺省 ⇒ true、无人值守 ⇒ false、显式 `answersQuestions: false` 不会被 `interactive: true` 复活。
- b21a782: 文档与代码对账、两条死代码清理、结构门禁补上最大的盲区、一条会偶发变红的测试。
  
  **文档与事实相反（4 处）。** `README.md` 的测试徽章写 `986 passing`（实际 1755）、指向 `AGENTS.md §10`（该文件只有 §1–§8，公共 API 面是 §8）、并宣称「内核装配只有一个点…四个 runner 全部经它装配」——而 `bootKernel` 只有 3 个调用点，`web/src/controller.ts` 的 `WebController.create()` **直接调 `createAgentKernel`**，权威文档 §4 早已把这件事写成「内核装配有两个调用点，不是唯一装配点」。README 现在照实说：`nova` 的默认形态恰恰是唯一绕过 `bootKernel` 的那个。`AGENTS.md` §8 第 3 条写 `SessionEvent` 的 **9** 个事件类型，与同文件 §5 的「共 10 个变体」及代码矛盾，已改为 10；§5 把子代理进度回调的接线点记成 `runtime-roster.ts`，实际在 `runtime-builtins.ts` 的 `kernelPlugins()`（roster 只是调用者）。README 的 smoke 项数由 20 改为 21——`scripts/smoke-web.mjs` 有 22 处 `check()`，其中握手那条是 `check(..., true)` 的**恒真断言**，不是检查。
  
  **`docs/` 与门禁盲区。** `structure-budget.mjs` 与 `dep-direction.mjs` 原先只扫单层 `packages/<包>/src`，于是 `packages/web/ui/src`——全仓最大的一块代码（172 个文件、24,613 行）、且是一个**真实 pnpm 工作区成员**——既无行数上限、也无依赖方向检查，`pnpm gates` 会照样报「全部在上限内」。两者改为扫 `packages/<包>/src` **及其嵌套成员的 `src/`**（嵌套成员按宿主包的白名单管辖），172 个新条目一次性入账，受管文件数 210 → 382。顺带查实一处**幽灵依赖**：`packages/web/ui` 的 `package.json` 没声明 `@nova-agent/core`，而 `ui/src/types.ts` / `rightbar/files-model.ts` / `rightbar/terminal-model.ts` 都在 import 它——它此前只是靠父目录 `packages/web/node_modules/@nova-agent/core` 这个 junction 才解析得到，`@nova-agent/core` 从 `web` 消失的那一天就会断。已补上 `workspace:*`。
  
  **两条死代码。** `roster-filter.ts` 的 `applyRoster()` 全仓零调用点（真正在用的是同文件 `loadableRoster`），且它是「按名过滤」的第二份实现——按单一实现纪律删除，连同 `roster.ts` 的再导出。`builtin/index.ts` 的 `trustedReadRoots` 文档注释仍在描述「browser uploads land in `~/.nova/cache/uploads/`」，而那个目录**已被刻意删除**（有路径的文件一律走 `@path` 引用），注释改为说明「今天没有调用点，`spillReadRoot` 是唯一在册的 trusted read root」。
  
  **偶发变红的测试。** `web/test/controller.test.ts` 有三处用固定 `setTimeout(20/30ms)` 等一轮跑完，而不是同文件已有的 `conn.waitFor(...)`。全量并发下机器一慢就丢事件，实测 5 次全量里有 1 次失败：`expected [ 'user_message', 'phase', …(4) ] to include 'message'`（单跑该文件 5/5、单跑 web 车道 12/12 均通过，故是测试自身的竞态而非产品缺陷）。三处改为等待真实事件。
  
  `AGENTS.md` §8 第 5 条另加一条限定：`AgentSurface` / `AgentSurfaceKernel`、`surfaces` 服务键与 `pluginLoaded` 事件键**已导出但尚无提供者或消费者**，签名变更照样要升位，但在有人消费之前不作为可依赖的公共面——此前它们同时出现在「公共 API 面」与「死缝」两处，是文档内部的自相矛盾。
  
  顺带修掉两处合并残留的格式（`runtime-builtins.ts:34`、`controller.ts:180` 各有两个语句挤在同一行）。
- b21a782: **插件开关真生效：热开热关、跨重启持久、页面跟随；审批选择器回归输入框。**
  
  ### 关掉的不再「自动打开」（此前重启即复活）
  
  `tools.code.mode: "ptc"` 与配置里的 `qqbot` 块都是第二个录取口，此前启动时**无条件**推导一条 `enable`：关掉插件只是移出列表，文件里没留下「关过」的痕迹，下次启动推导又把它打开。现在推导统一让位于显式 `disable`（`impliedOptIns`，boot `kernel-config.ts` 与 live `runtime-roster.ts` 同一规则），`ptc` / `qqbot` 两行的开关**两个方向都写**（关闭也写 `disable`），开关跨重启持久。
  
  ### 关掉 PTC 时模式不再自相矛盾
  
  此前关掉 PTC 插件后 live 模式仍显示 ptc，设置与输入栏还能照选。现在：关闭时生效模式归回 `native`（文件保留操作者自己的 `tools.code.mode`，重新打开即恢复）；插件关闭期间 `setCodeMode` 对非 `native` 模式以中文原因拒绝——插件没加载的模式绝不运行；插件 flip 后浏览器立即收到 `state` 广播，模式 chip 不再停在旧值。
  
  ### 关掉的插件从页面消失
  
  设置导航由**活 roster** 派生：QQ 机器人插件关闭后其设置页从导航消失；重开的门是它在「插件管理」里的行（关掉的行永不从面板消失，不会单向）。
  
  ### 连带修复：boot 期关闭的插件本进程永远打不开
  
  重 roster 曾把启动文档的 `plugins.disable` 与 live 列表求并集，开关打开后又被这行加回来（`did not load after enabling`）。已改为以 live 列表为准。
  
  ### 审批权限选择器回归输入框（对齐 dsh）
  
  此前它被挂到会话头部右上角；现在输入框在**每个会话**都带审批档与执行模式两个 chip，运行中仍可调审批档（dsh 的 `conversation.input.permission` 语义），执行模式运行中锁定。
- b21a782: **右侧栏（变更 / 文件 / 终端）、模型设置页、QQ 连接信息页，以及冷启动的插件可用状态。**
  
  ### 右侧栏：变更、文件、终端
  
  新增右侧栏三个页签，都由内核的真实事实驱动：**变更**列出本会话改过的文件（`edit_file` / `write_file` 的工具调用，不猜），**文件**是工作区浏览，**终端**把一条命令当作**普通后台 job** 跑并分帧吐输出。终端不是 PTY（无 stdin、无窗口尺寸），这是诚实的边界；它独有的两条契约是：**读即游标推进**（所以只有面板自己启动的 job 可读，模型 `jobs output` 的输出不会被抢食），**归属归会话**（切会话即隐藏、会话结束即取消）。
  
  ### 模型设置页：多供应商一眼分清 + 参数可编辑
  
  供应商列表按**活配置**读取并标注活动项（按名字与属性，不靠列表顺序）；模型目录上方写明「在用模型属于哪个端点」；每个模型的能力字段（上下文窗口 / 最大输出 / 输入输出模态 / 附件 / 推理 / 工具调用）可编辑，且**同时显示「当前生效」与「自动值（占位）」**——两者的差就是操作者在偏离什么。越界值（容量、temperature）**拒绝写入并说明破坏了哪条规则**，而不是写出一份下次启动加载不了的配置。
  
  ### QQ 机器人页：六态 + BOT 名称 + 本次运行计数
  
  区分「未配置 / 已配置但未接入 / 连接中 / 已连接 / 连接失败（带原因）」；BOT 名称真去问网关（按 appId 缓存，取不到就说取不到，绝不编）；计数是**本次运行**收到 / 已回复与最近一条时间，并把口径写在同一句里（进程内计数、重启归零，不是历史累计）。插件关闭时不再渲染可用性存疑的字段，只给开启入口。
  
  ### 关掉插件时网关真的停
  
  此前关掉 `qqbot` 只翻 roster：**网关住在本进程的桥里，不在插件的 effect 里**，于是页面说「已关闭」而 QQ 那头还在收消息。现在关闭会挂断网关（幂等，未启动时也安全）。同一批修掉：配置文件不存在时 `readQqBotCredentials()` 不再抛——此前它让首次运行的 `nova --web` 在 `launchWeb` **之前**就崩，整台 WebUI 起不来。
  
  ### 冷启动的插件可用状态进基线
  
  设置导航由**活 roster** 派生（关掉的插件页从导航消失），而 `roster` 帧只由插件管理页请求：重启后直接打开设置，导航仍会画出已被关闭插件的页。现在 `ready` 基线自带活 roster（与 `commands` 同一条「attach 时读活注册表」纪律），首绘即正确。
- b21a782: **子智能体在界面上从来没显示过**（不是「显示得不对」）。`subagent_update` 声明在内核协议里、前端也写好了对应的行并测过，但**全仓没有任何地方发布这个事件**：进度回调被留给各 surface 自己传，而四个装配点（web / repl / exec / qqbot）一个都没传，于是回调链在 `onSubagentProgress` 处断掉，那个行是死代码。现在与后台 job 同样处理（`jobs.setListener` 的先例）——**在装配点接线**，把嵌套循环的生命周期直接发到当前会话上；surface 仍可覆盖。
  
  **首次请求的约 1 万上下文里，约 9500 是 AGENTS.md，而它一直被按字节计价。** 预算单位错了：估算器对中日韩字符约 1 token/字、对其它文本约 1 token/4 字，所以 32,000 **字节**的预算在这份中文文档（1.61 字节/字）上只买到约 9,400 tokens，却仍丢掉了文件的 47%。改为按 **token** 计（`PROJECT_DOC_MAX_TOKENS = 8000`，并通过 `projectDocMaxTokens` 暴露为配置项——dsh 里它也是配置而不是常量），截断点用同一套估算器二分求得，因此中日韩与 ASCII 不再被区别对待，切口仍落在完整字符边界。按本仓实测：注入量 18,019 → 8,000 tokens（44% 的文档）。
  
  **上下文占用环在续接会话时虚高。** `ready` 的回退读的是 `run/stats.promptTokens`，而它是**一轮内所有请求的求和**（`RunMeter` 刻意累加），不是「窗口现在多满」。实测一轮两请求报 25,268 而真实最后一次请求是 12,920（**+96%**）。现在这个数由内核的 `lastPromptTokens` 负责：进程内跑过就走内存锚点，否则从日志投影里取**最后一条 assistant 消息自己的 `usage.promptTokens`**，surface 不再自己重建。
  
  **弹窗没有入场动画。** dsh 的 `Modal` 让遮罩与卡片按同一时长和缓动淡入；本仓的工具侧板一直有，三个弹窗（设置 / 删会话 / 目录浏览）却是硬切，读起来是「闪一下」而不是「面板到来」。按 `ui-primitives/Modal.module.css` 的 `modalEnter` 补上，并在 `prefers-reduced-motion` 下停用。
  
  **轮次 header 上那行 `22:21 · 用时 2.8s · 首 token 1.7s · 42 tok/s` 已删。** dsh 的 `TurnProcessNodeView` 就是 `[label][chevron]`，它的样式表里**根本没有 detail 类**；每次运行的时钟 / TTFT / TPS / 工具时间住在会话统计 pill 的弹窗与轨迹表里。那行既重复了 label 自己的「用时」，又把一坨数字塞进了参考实现空着的位置。
  
  另外按行数门禁拆出 `agents-md-init.ts`（`/init` 的模板与「读链」是两件事，只共用一个文件名）。
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [b21a782]
- Updated dependencies [436d7b3]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
  - @nova-agent/core@0.4.0

### Minor Changes

- 1b6376d: 拒绝转追问（Grok 组件7 移植）：审批弹窗选中「拒绝」行后打字即补充拒绝理由（⌫ 删字、Enter 携理由拒绝、y/a 快捷批准不受影响），理由经 `{answer:'deny', reason}` → `decideDetailed` → hook verdict 一路回流，模型看到 `Permission denied: by user: <理由>` 而非光秃拒绝；AskFn 加宽 DenyGrant（老询问器零改动），空/畸形理由回落普通拒绝。
- b6255b3: 审批「总是允许」粒度可交互调节（Grok 组件6 移植）：弹窗选中 always 行时 ←/→ 调整授权词数（命令前 N 词实时预览、Enter/a 携带 `{answer:'always', scopeWords:N}`）；PermissionService 按**词前缀匹配**放行同前缀命令（`git status` 范围放行 `git status -sb`、不波及 `git commit`），N 越界/复合命令回落默认记忆粒度，畸形 grant fail-closed 拒绝；AskFn 返回值加宽（仍接受原 AskAnswer 字符串），弹窗提示行补全列裁剪。
- 1e35cdb: Hook verdicts go structural: `ToolCallVerdict` is now a discriminated union (`allow` carries nothing, `deny` carries only `reason`, `rewrite` requires plain-object `args`), validated by the new `validateToolCallVerdict` pure function. The plugin host rejects malformed verdicts fail-closed (deny with an actionable reason) and rejects `beforeLLMCall` hooks that widen the tool set (narrowing, e.g. the PTC projection, still passes). `runAgent` re-validates at its own gate so hand-rolled `AgentHooks` implementations get the same fail-closed net. No built-in plugin changes behavior — none rewrites or widens.
- 1b6376d: **内核收拢 + 可插拔 Surface（M11）**：拆掉"每个 runner 各自记簿记、各自猜阶段"的重复，把内核做成**唯一协议面 + 多家 surface**。
  
  - **`AgentSession` 句柄与 `KernelEvent` 协议**（core 新增公共导出）：surface 只拿到句柄——`prompt` / `abort` / `compact` / `resolveApproval` / `subscribe` / `pendingApprovals` / `usageSnapshot` / `dispose`——不再自己跑 `runAgent` 生成器、不再自己落盘。"model-visible means logged" 由内核 `consume()` 直接保证：凡进了模型可见面的事件必已进日志，surface 无从遗漏。
  - **旁路通道收编为事件**：`phase`（thinking/writing/tool/waiting/compacting）、`approval_request`、`tool_progress`、`subagent_update`、`job_update`、`notice`、`compaction/*` 全部并进 `KernelEvent`——原先 TUI 自推 phase、审批走 host 里一个隐形 await、job 靠轮询、压缩进度只存在于 SessionEvent 的四处旁路，现在是一条流。
  - **审批事件化（fail-closed 不变）**：`PermissionService` 的 ask 注入点保留为底层，内核提供适配器把 ask 转成"发 `approval_request` + 等 `resolveApproval`"；surface 断连或 abort 时挂起审批收敛为 deny。headless 消费者（exec/qqbot）继续走确定性拒绝。
  - **能力下沉**：`compact` / `auto-compact` / 上下文片段 / 工作区路径 / 会话索引从 cli 下沉 core（新公共导出）。`plugins/runtime.ts` 的 `createAgentKernel` 成为**装配单源**——host、审批桥、`PermissionService`、`JobRegistry`、上下文片段一处装配，provider 注入；core 保持 provider 与宿主无关。
  - **cli 变瘦**：argv → 装配哪个 surface + 配置发现 + provider 工厂 + 模型元数据。斜杠命令语义收为 `command-runner.ts` **一个 runner 两壳共用**（对内核做什么、参数怎么解析、报什么文案单源），顺带修掉 `nova --repl` 的 `/skill <name>` 死路（原先进「未知命令」）。exec/repl/qqbot 全部改为内核事件流的消费者——功能与 JSON 事件流 schema 不变。
  - `core` 另导出 `AgentSurface`（纯类型）：官方 surface 与第三方 surface 同地位，只依赖 core/plugins 公共 API，由 cli 按 argv 装配。
- 42c1bfb: 治理换血与消重拆壳（M9.0–M9.K，行为保持不变重构）。
  
  - **公共面新增**：core 导出 `errMessage`（错误转消息字符串单源）与 `truncateUtf8Head` / `truncateUtf8Tail`（UTF-8 整字符边界字节裁剪，收编 agent 落盘 / jobs 读取 / AGENTS.md 裁剪三份同构循环）；plugins 导出 `resolveShellName`（bash/powershell 解析单源，收编 cli `declaredShell` 与 bash `invocation` 两份真相）；呈现层的 `Palette` 接口补 `reset` / `clearLine` / `clearRight` 开态原语（收编手滚 raw ANSI；无色调色板对控制码返回空串，保证 NO_COLOR 恒静默）。
  - **结构棘轮**：`pnpm gates`（依赖方向机检 + 逐文件行数硬上限，只降不升）、`pnpm check` 快环 / `pnpm verify` 全环分层、oxlint complexity/max-depth/长函数规则上线；决策笔记体系删除。
  - **消重**：四 runner 的用户消息提交/重试与空补全文案/回合失败归类/审批预览与 toast/hooks 重绑单源；repl 与 TUI 的 13 个斜杠命令下沉 command-core（M11 批5 进一步收为 `command-runner.ts` 一个 runner 两壳共用）；`repl.ts` 的瞬态进度行出壳 `ReplProgress`、`/session` `/model` `/plugins` 报告行下沉；core 的 989 行 `agent.ts` 拆为 `agent/{notices,request,stream,tools,loop,options}.ts` + 桶文件（40+ 条行为测试不动）；plugins 的 fs/bash/search/run-code 内联 execute 体提为顶层具名函数，工厂只留 schema+接线；各包 `test/helpers/` 收敛 `scriptedProvider`（5 拷贝）与 `withFakeHome`（2 拷贝）。
  - **声明的行为例外（漂移修复）**：repl 审批预览宽度统一走 `toolArgSummary`；exec/qqbot 调色板装配走 `resolvePalette`，开始尊重 `ui.theme` 与 `NO_COLOR`（此前恒暗色）；repl bash 输出尾行缓冲并入 TUI 同源的 `TOOL_TAIL_KEEP_CHARS`（显示行仍裁到单行，观感不变）。
  - **缺陷修复**：TUI 首装与 exec 路径的 `hooksRef` 从未赋值——嵌套 subagent 因此绕开父审批门（exec 的 never 策略形同虚设）；重绑单源后审批门对嵌套调用恢复生效。
  - **热路径微优化（行为不变）**：`request-trim` 的 snip+micro 共享一次 `groupMessages`（snip 未改动时同引用短路）；`estimateTextTokens` 的 CJK 判定由正则改为码点区间比较（消除每字符 regex.test）；`OpenAICompatClient` 的工具序列化按数组身份 `WeakMap` 缓存，`PluginHost.tools` 返回稳定引用跨轮失效仅在 registerTool——启动后稳定工具集下每请求免一次 sort+map。
- 37ea5d6: core 新增「呈现意图词汇表」（`packages/core/src/presentation.ts`）：`ToolCallKind` / `FileLocation` / `FileDiff` 与 `card` 判别的 `ToolCallView` / `ToolResultView`，只描述一次工具调用**是什么**（无文案、无颜色、无列宽），让 TUI / WebUI / headless 从同一份结构渲染而不再按工具名 special-case。`ToolDefinition` 增加两个**可选**纯函数 `presentCall?(args)` / `presentResult?(args, content)`（§10 面 4）——不声明的工具照旧以 generic 卡渲染；两者都不进 provider 线上载荷，前缀缓存不受影响。内置工具已声明自己：bash → terminal（含 exitCode / droppedBytes）、write_file / edit_file → diff（FileDiff，presentCall 不读盘）、search_files → search（FileLocation + truncated）、read_file / list_dir → read、todo_write → plan。
  
  同时把两项**领域语义**从渲染包迁入 core：失败判定 `isFailureContent`，以及"哪些工具是只读的 / 参数是路径"的分类（`toolCallKind` + `isReadOnlyKind` / `isPathArgKind`）——旧渲染包的两张硬编码工具名表由此派生（该包已随 M11 批1 删除；`tui-app` 与 Web 前端一律走词汇表，不持有名字表）。
  
  **视图解析归宿主**：core 另导出 `callViewOf(tools, call)` / `resultViewOf(tools, call, content)`（从活工具表取声明）与 `ToolViewSource` 缝——事件出站方在帧上附视图，界面 `switch (view.card)` 消费，浏览器侧零按名特判、零失败启发式。

### Patch Changes

- Updated dependencies [1e35cdb]
- Updated dependencies [1b6376d]
- Updated dependencies [42c1bfb]
- Updated dependencies [37ea5d6]
- Updated dependencies [1e35cdb]
- Updated dependencies [1e35cdb]
  - @nova-agent/core@0.4.0

## 0.3.0

### Patch Changes

- @nova-agent/core@0.3.0

## 0.2.1

### Patch Changes

- f364394: 后台子代理可见性 + 内置工具对 shell 的信息量反超：`JobRegistry` 快照新增 `startedAt`/`progress`（peek，不占模型输出游标），后台 subagent 的嵌套活动（N tools · 最近调用）喂入 TUI——每个运行中的后台委派钉一行 `⧉ 子代理 label · Ns · …`（自带刷新 interval，活过父轮仍更新），结束原位改写为状态+用量行。`list_dir` 输出携带文件字节数（不再输给 `ls -la`）；bash 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`（Windows 下 python heredoc 免手写编码样板）；系统提示的 `run_code` 引用改为模式中性表述。
- Updated dependencies [f364394]
- Updated dependencies [f364394]
- Updated dependencies [f364394]
  - @nova-agent/core@0.2.1

## 0.2.0

### Patch Changes

- cf9f16c: 修复 `edit_file` 的 `$` 模式静默损坏：`applyEdit`/`tolerantReplace` 的替换值改用函数 replacer（`() => newString`），`$&`/`$1`/`` $` ``/`$'`/`$$` 一律按字面插入，不再被 RegExp 展开。修复 bash 输出头部截断丢尾：`runOnce`/`startBackground` 改用 `BudgetedBuffer` 双段缓冲（头部 60% + 环形尾部 40%，对齐 core 溢出落盘契约），中间丢弃字节数写入结果；背景 job 的 `readOutput` 保持 drain 语义，截断时给出提示。
- d69b9ba: Unified TokenGate (auto-compact.ts shared by all runners): preflight uses anchor-or-full-estimate so resume of a large session can no longer blow the context window on its first request; compactConversation/compactSession accept an optional AbortSignal forwarded to the summarizer. always-approval scope narrows compound commands to the whole normalized chain. TUI error path discards uncommitted partial assistant blocks (screen/log divergence fix); REPL gets an equivalent dim hint. agentTurn gets a catch guard so errors outside the event loop surface as blocks, not unhandled rejections.
- c9a8f61: P3 polish: jobs.ts comment drift fixed (completion injection channel exists since M6.4); dead code removed (extractReasoningHeader, reasoningRows, questionLines, isBlankAnswer + their tests); {env:NAME} throws naming the missing variable instead of silently expanding to empty; --version/-v/--help/-h only match as leading flags; interactive mode warns on stray positionals; runCompact no longer zeros cumulative session stats; PTC both-mode SDK slims bindings to name + one-line summary (native schemas carry full types); search_files in-process walk checks abort signal; spacing.ts contract comment aligned with frame.ts tight-pair implementation.
- 21dfe53: Structural refactor: extracted createSessionRuntime (packages/cli/src/session-runtime.ts) merging the ~60-line duplicated session/client/host/skills/fragment startup across all three runners (exec/repl/tui); runtime exposes reloadWorkspaceContext for workspace switches so fragment closures stay consistent. TuiStore convergence: removed all three `as any`/`as unknown as TuiStore` casts from tui-mode.ts by fixing structural compatibility (sessionPicker/approval types already matched; appendTail implemented inline; blocksVersion wired as getter; onChange made public on TuiStore). store.ts onChange promoted from private constructor param to public field for structural assignability.
- Updated dependencies [d69b9ba]
- Updated dependencies [c9a8f61]
- Updated dependencies [21dfe53]
  - @nova-agent/core@0.2.0
