---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

新增 `ask_user_question`：模型可以在运行中向人提问并等待回答（对齐 deepseek-harness `ui-user-questions` 的形状与中文文案）。

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
