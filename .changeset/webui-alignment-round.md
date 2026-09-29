---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

**WebUI：修掉用户报的 8 处与参照实现（dsh）不一致的地方。** 逐条都能在 dsh 源码里找到出处。

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
