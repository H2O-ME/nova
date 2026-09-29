# dsh `ui-*` 模块对齐清单（差异归档）

参照系：`deepseek-harness-master/packages/client/`（**只读**）。口径：逐模块比对**功能 / UI / 动画 / 交互逻辑**，并给出 Nova 侧落点或「未对齐」的判定与理由。行数为 `(Get-Content).Count`（含空行），只用来衡量规模量级，不是门禁口径。

Nova 侧浏览器前端只有 **12 个 `src/` 目录 + 21 个顶层文件**（`packages/web/ui/src`，217 文件），因此**不是**逐包对等移植：一个 Nova 目录常同时承接多个 dsh 包，一个 dsh 包也可能横跨多个 Nova 目录。下表 `落点` 列记的就是这层多对多关系——**落点为空 = 确实没有**。本清单只管**浏览器面**；终端面见文末「TUI 移植」。

## 判定口径

- **对齐**：功能可观测等价（文案/尺寸不必逐字相同，见 AGENTS.md §6「断言粒度」）。
- **部分**：主功能在，明确缺子能力；缺口写进「未对齐明细」。
- **未对齐**：Nova 无对应实现。
- **不适用（N/A）**：dsh 该模块依赖 Nova 内核**不存在**的能力（如多 surface 插件热装、原生目录选择器、多会话并行 tab）；**这不是缺陷**，理由逐条写在表内。

## 52 个 `ui-*` 模块

| # | dsh 模块 | 规模（文件/行） | 落点（Nova） | 判定 |
|---|---|---|---|---|
| 1 | `ui-agent-preset` | 25 / 4883 | — | **未对齐** |
| 2 | `ui-approval` | 11 / 1042 | `approval/`(8) | 对齐 |
| 3 | `ui-attachment` | 24 / 2334 | `composer/{attachments,attachment-rail,file-type,FileCard,FileTypeIcon,drop-entries,DropOverlay}` | 对齐 |
| 4 | `ui-brand-official` | 7 / 170 | `sidebar/SidebarLogoRow.tsx` | 对齐 |
| 5 | `ui-chat` | 158 / 28449 | `chat/`(35)、`flow.tsx`、`flow/`(2) | 部分 |
| 6 | `ui-commands` | 20 / 4157 | `composer/{command-menu,ComposerMenu}` | 对齐 |
| 7 | `ui-conversation` | 126 / 27071 | `conversation/`(19)、`composer/`(33)、`chat/ChatView.tsx` | 部分 |
| 8 | `ui-deliverables` | 43 / 5085 | — | **未对齐** |
| 9 | `ui-directory-picker-browse` | 11 / 3666 | `conversation/DirectoryBrowser.tsx` | 对齐 |
| 10 | `ui-directory-picker-native` | 8 / 468 | — | **N/A**（N3） |
| 11 | `ui-dockkit` | 37 / 8922 | `composer/DockStack.tsx` | 部分 |
| 12 | `ui-goal` | 19 / 1979 | `conversation/GoalPanel.tsx`、`composer/claim-hint.ts`、`plugins/goal-command.ts` | **已对齐**（dsh `GoalBar` 的动作按钮条未移植，面板暂只读） |
| 13 | `ui-input-trigger` | 22 / 4193 | `composer/{command-menu,reference-menu}`、`InputBar.tsx` | 部分 |
| 14 | `ui-jobs` | 11 / 1777 | `flow/StatusRows.tsx` | 部分 |
| 15 | `ui-layout` | 21 / 2781 | `shell/{AppFrame,columns,layout-store,use-layout}` | 对齐 |
| 16 | `ui-message-feedback` | 21 / 2867 | `chat/MessageIconActions.tsx`（**仅复制**；分叉按钮已渲染但从未接通，见未对齐明细 11） | 部分 |
| 17 | `ui-model-selection` | 16 / 2777 | `composer/{ModelSeat,stats-model}`、`settings/ModelSection.tsx` | 对齐 |
| 18 | `ui-open-in-app` | 25 / 2110 | — | **N/A**（N3） |
| 19 | `ui-permission-presets` | 19 / 2602 | `conversation/PermissionSelect.tsx`、`settings/GeneralSection.tsx` | 部分 |
| 20 | `ui-plan` | 22 / 1681 | `conversation/TodoPanel.tsx`、`chat/CompactionItem.tsx` | 部分 |
| 21 | `ui-plugin-manager` | 22 / 8178 | `settings/{PluginsSection,PluginRow,plugin-state,use-flip-feedback}`、`plugins/{plugin-tier,runtime-switch,runtime-roster}` | 对齐（开关真生效并跨重启持久；第二录取口 `ptc`/`qqbot` 双写 disable；关掉的插件页从导航消失） |
| 22 | `ui-primitives` | 191 / 27013 | `shell/{Menu,MenuCard,MenuSurface,Tooltip,anchored-popover,modal-layer,focus,use-escape}`、`styles/`、`icons.tsx` | 部分 |
| 23 | `ui-reference` | 7 / 1056 | `composer/reference-menu.ts`（`@` 引用） | 部分 |
| 24 | `ui-renderer` | 25 / 6397 | `main.tsx` | **N/A**（N1） |
| 25 | `ui-schedule` | 72 / 20978 | — | **未对齐** |
| 26 | `ui-session` | 8 / 1573 | `state.ts`、`state-events.ts`、`client.ts` | 对齐 |
| 27 | `ui-settings` | 22 / 2341 | `settings/{SettingsPanel,Section,SettingsRow,copy}` | 对齐 |
| 28 | `ui-settings-account` | 74 / 7921 | — | **N/A**（N2） |
| 29 | `ui-settings-agent-loop` | 12 / 493 | — | **未对齐** |
| 30 | `ui-settings-general` | 35 / 3052 | `settings/GeneralSection.tsx` | 部分 |
| 31 | `ui-settings-models` | 43 / 10423 | `settings/{ModelSection,ProviderSection,ModelConfigEditor}`、`settings/copy/models.ts` | 对齐（多供应商区分、能力字段可编辑并同时显示生效值/自动值；`contextBreakdown` 分类 token 数仍缺内核供给） |
| 32 | `ui-settings-plugin-inventory` | 11 / 2019 | — | **未对齐** |
| 33 | `ui-settings-plugins` | 11 / 583 | `settings/PluginsSection.tsx` | 部分 |
| 34 | `ui-settings-shell` | 12 / 643 | — | **未对齐** |
| 35 | `ui-settings-subagent` | 19 / 2224 | — | **未对齐** |
| 36 | `ui-settings-web-search` | 12 / 870 | — | **未对齐** |
| 37 | `ui-shortcuts` | 17 / 2207 | — | **未对齐** |
| 38 | `ui-sidebar` | 19 / 2482 | `sidebar/`(22)、`rightbar/`(10) | 对齐（右侧栏三页签：变更 / 文件 / 终端；终端是后台 job 的非 PTY 边界） |
| 39 | `ui-sidebar-browser` | 42 / 3248 | — | **N/A**（N5） |
| 40 | `ui-sidebar-documentpreview` | 161 / 14439 | — | **未对齐** |
| 41 | `ui-sidebar-files` | 25 / 2971 | — | **未对齐** |
| 42 | `ui-sidebar-right` | 47 / 8612 | `conversation/PanelExpandButton.tsx`（工具详情侧板） | 部分 |
| 43 | `ui-sidebar-terminal` | 29 / 1901 | — | **N/A**（N5） |
| 44 | `ui-skill` | 12 / 1478 | skills 索引注入（内核侧）；`/` 菜单无 skill 源 | 部分 |
| 45 | `ui-slots` | 9 / 2853 | — | **N/A**（N1） |
| 46 | `ui-subagent` | 16 / 3159 | `chat/TurnHeader.tsx`（子代理行） | 部分 |
| 47 | `ui-theme` | 45 / 4706 | `theme.ts`、`shell/boot-theme.ts`、`styles/*.css` | 对齐 |
| 48 | `ui-tool` | 72 / 10807 | `tool/`(23)、`card-view.ts` | 对齐 |
| 49 | `ui-trajectory` | 55 / 17663 | `trace/TraceView.tsx`、`trace-view.ts` | **未对齐** |
| 50 | `ui-user-questions` | 18 / 2815 | `question/`(3) | 部分 |
| 51 | `ui-workflow-run` | 12 / 2085 | — | **未对齐** |
| 52 | `ui-workspace` | 39 / 14767 | `sidebar/{SessionBrowser,ViewOptions,SidebarFoot}`、`conversation/DirectoryBrowser.tsx` | 部分 |

**小计**：对齐 11、部分 20、未对齐 14、N/A 7（合计 52）。

## 不适用（N/A）的逐条理由

- **N1 `ui-slots` / `ui-renderer`**：dsh 的插件化 UI 靠**运行时插槽注册表**（`ui-slots` 声明、`ui-renderer` 安装渲染器），才有「第三方 UI 模块热装进同一界面」。Nova 的前端是**单一 Vite 构建的静态产物**，没有浏览器侧插件加载器，插槽概念没有承载物。**空目录不是缺陷**：把插槽注册表搬进来而没有第三方 UI 模块可注册，就是一层无人消费的抽象（AGENTS.md §5「`surfaces` 键无消费者」是同类反面教材）。
- **N2 `ui-settings-account`**：管理 DeepSeek 账号登录与平台计费页。Nova 面向**任意 OpenAI 兼容端点**、凭证来自 `~/.nova/config.json` 的 `apiKey`（含 `{env:NAME}`），**没有账号体系**可登录，也没有计费后台。
- **N3 `ui-open-in-app`**：调宿主原生能力打开目录/文件（Finder/资源管理器/revealInOS）。浏览器标签页没有这类 API；Nova 的等价能力是 `list_directory` + 目录浏览弹窗（AGENTS.md §5 已记录 `showDirectoryPicker()` 拿不到路径）。
- **N4 `ui-directory-picker-native`**：桌面/Host 原生目录选择器，同 N3。
- **N5 `ui-sidebar-terminal` / `ui-sidebar-browser`**：右栏交互式 shell 与沙箱浏览器 tab。Nova 的右栏只有**工具详情侧板**；终端与内嵌浏览器都是大块独立能力，且 dsh 侧依赖其桌面宿主。**不是遗漏，是未立项**。

## 未对齐明细（按可实施性排序）

### A. 有明确内核/协议支撑，缺口只在界面

1. **`ui-shortcuts`**：快捷键参考与本地自定义。Nova 的按键处理散在 `composer-keys.ts` / `shell/use-escape.ts`，**没有可发现的快捷键清单**。可先做只读参考表（列出已实现的键位），不需要新协议。
2. **`ui-sidebar` 的会话操作**：重命名 / 归档 / 置顶 / 行内菜单 / 拖拽排序 / 手动排序。Nova 的会话行只有**删除**，且标题是**从日志头扫描派生**的（`core/session-peek.ts`，首条提示词前 120 字），**不是存储字段**。dsh 对应 `ui-workspace/src/client/rows/Rows.tsx`、中文文案在 `ui-workspace/src/client/locales.ts`（`menu.fork` 分叉会话 / `menu.archiveSession` 归档会话 / `menu.pinSession` 置顶会话 …）。**需要新协议帧**（内核 + web + UI 三层），是当前最大的一块缺口。
3. **`ui-skill`**：`/` 菜单缺少 skill 源。内核已把 skills 索引注入了上下文，`ui-skill` 只是把它接进 `/` 触发源；Nova 的 `command-menu.ts` 已有「注册表认得 `/name` 就发命令帧」的分发点，**接一个源即可**。
4. **`ui-settings-*` 五个配置页**（shell / agent-loop / subagent / web-search / plugin-inventory）：Nova 的内核**已有**对应可配置项（`tools.bash.timeoutMs`、`tools.bash.shellPath`、`tools.code.*`、`maxTurns`、`autoCompactTokenLimit`、`projectDocMaxTokens`、`notify`），但**前端一个都改不了**——`packages/web/src/protocol.ts` 的 `ClientFrame` **没有任何配置读写帧**，`ready` 也只带一个 `configPath` 字符串。这是「后端有、前端没有」的典型缺口。
5. **`ui-plugin-manager`**：Nova 的 `PluginsSection` 是**只读花名册**（名字/状态/注入的服务）。`plugins.disable` / `plugins.extra` 已是正式配置入口，因此可做成可写。

### B. 需要新内核能力（大块工程）

6. **`ui-trajectory`（39 文件表）**：Nova 的 `trace/` 只有 `TraceView.tsx`(82) + `.module.css`(129)，dsh 是 `TrajectoryTable.tsx`(3513) + `layout.ts`(1179) 等。**前提是有一个快照生产者**——轨迹表读的是逐轮逐请求的结构化快照，Nova 的 `run_stats` 只给聚合读数。
7. **`ui-plan` 的完整形态**：Nova 已有计划面板（composer dock 可折叠卡，`todo` 事件驱动），但 dsh 还有**计划模式**（plan mode 开关）与**转录内持久计划卡**。
8. **`ui-goal`** / **`ui-deliverables`** / **`ui-schedule`** / **`ui-workflow-run`**：分别需要 goal 生命周期、变更文件产物卡、保留型宿主任务、工作流运行节点——**四个都是内核侧新能力**，不是界面工作。
9. **`ui-sidebar-files` / `ui-sidebar-documentpreview`**：右栏文件树与文档预览 tab。`list_directory` 已能枚举目录。

### C. 需要新协议帧的小缺口

10. **`ui-message-feedback`**：Nova 的 `MessageIconActions` **只有复制**，**没有 Like/Dislike**（dsh 在 `ui-message-feedback`）。需要一个反馈帧与其落点。
11. **分叉会话（branch / fork）是一个「渲染了但从未接通」的按钮**（本轮订正的一条既有错误结论）：`chat/MessageIconActions.tsx:104` 的 `onBranch !== undefined` 分支与 `branchUnavailable` 提示都已写好，`MessageItem.tsx` 的 `UserMessageRow` / `AssistantTailRow` 也都把 `onBranch` 透传下去——但**全仓没有任何调用点传过它**（`onBranch=` / `extraActions=` / `branchUnavailable=` 三个可选位在 `packages/web/ui/src` 与 `packages/plugins/src` 里一次都没出现；只有 `usageAction=` 被 `flow.tsx:254` 传了）。dsh 是在 `ui-chat` 的 `TurnTailNodeView.tsx:69` 接的：`onBranch={() => { forkAt(data.seq) }}` → `apply.ts:247` 的 `ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })`。所以 Nova 侧的**渲染层是齐的，缺的是能力与帧**：内核没有「在某个日志位置分叉出一条新会话」的操作，线上也没有承载它的锚点（`WireBlock` 不带 `seq`）。此前本清单把它记作「已有复制/分叉」，是把**渲染分支**误读成了**已接通的入口**。
12. **`ui-agent-preset`**：agent 预设（多套系统提示/工具集/模型组合）在 Nova 内核里**没有对应概念**。
13. **`ui-jobs` / `ui-subagent`**：Nova 已有活动行与 `subagent_update` 事件，但 dsh 还有**后台任务面板**与**子代理会话目录 + 续接路由**。

## 本轮已修复（差异清单的实际收口）

### 多会话串台 + 侧栏/气泡/composer 对齐（第 7 轮）

**串台：三个真实来源，全部变异测试证明**

- **后台 job 无归属（主因，真 bug）**：`JobRegistry` 是**每进程**一份（job 必须比产生它的那一轮活得久、也要跨会话切换存活），而 `list()` 不看会话；`jobListener` 又把每个 job 播给**当时** `current()` 的那个会话。于是 A 会话起的 `bash` 后台任务会出现在 B 会话的基线与转录里，切换后 A 的完成通知还会注入 **B 的模型请求**。修法：`JobStart` 现在**必填** `sessionId`，`JobSnapshot` / `JobNotice` 都带 owner，`list` / `get` / `readOutput` / `stop` / `drainFinished` 与那个「播给谁」的监听器一律按会话过滤。**无主 job（第三方工具没传 owner）对所有会话可见**——刻意的 fail-open：藏起来等于让 job 不可见地跑着，行画不出、通知送不到，**等于丢掉这份工作**。
- **删除「当前打开的」会话会被下一次写入复活（真 bug）**：句柄持有日志路径且用 `appendFile` 追加，而 `appendFile` 会**创建**缺失文件——删掉正在运行的会话日志后，那一轮仍会把自己的消息写回去，留下只含删除后事件的日志（看着被截断、还在列表里、也不是用户删的那个）。根因比 `dispose()` 更深：**已 dispose 的会话仍能 append**。修法是让「删除是最后一句话」成为存储层性质——`Session.seal()` 在 `AgentSession.dispose()` 里被调用，`appendEvent` 对已封的日志抛错；删除顺序也改成**先停旧会话**再 unlink。
- **`followSession` 的重新指向本来就是对的**：门控测试证明切走的会话其迟到事件**从不**到达客户端，所以「每帧带 session 标记」的两条推测性测试被删掉（不是缺陷）。**线上的实时事件帧不带 `session` 字段，在上面的前提下是安全的。**

**侧栏（逐条对照 `ui-workspace/src/client/rows/` + `ui-sidebar/src/client/SidebarRoot.*`）**

- 会话行/搜索/清空/溢出的 **6 个控件**从 `border-radius: 50%` 改回参考实现的 `--dsw-radius-sm`，折叠轨道里是 `--dsw-radius-md`——参考实现是圆角方块不是圆。
- 单列表模式与搜索结果**补回 2px 行距**：它们没有 `.groupSection` 包裹层，于是贴成一块，比旁边的分组树更挤（参考实现用 `.flatList` / `.searchTree` 表达同一区分）。新增 `data-flat` 钩子与 `.wide[data-flat] .list > * + *`。
- `.logoRow` 下边距 `8px` → `4px`；折叠态补 `overflow: visible`（36px 开关比 35px 行宽，基准行的裁剪会切掉右缘）；`.newSession` 的 `12px` 字面量 → `--dsw-radius-md`。

**composer**

- chip 圆角 `24px` → `--dsw-radius-sm`；模型座位标签字重 `500` → `400`（dsh 那处是 400，而相邻的权限 chip **确实是** 500——这份不对称是参考实现自己的，照抄而非统一）。
- 卡片窄于 560px 时三个工具组收紧到 8px（参考实现的 `@container` 规则）。
- `StatsPills` 用 `999px` + `corner-shape: round`（全局 `superellipse(1.5)` 会把胶囊端压方，参考实现明确配对了这两个声明）；`ImageCard` 边框/圆角/内缩对齐。

**消息气泡**

- **气泡本身与 dsh 逐字节相同**——感知差异来自气泡**没拿到**的东西。
- **已发送的图片在转录里彻底消失（真 bug，与刚上线的粘贴图片功能直接冲突）**：`transcript.ts` 与 `server-frames.ts` 的 `user` 块只带 `text`，尽管 core 的 `UserMessage.images` 一直存在。于是**实时会话完全正常、一刷新附件就没了**。新增 id 寻址的 `GET /api/image/<sha256:hex>` 逐字节读回，`user` 块带上引用，气泡上方渲染。**这条 GET 路由曾漏了 `decodeURIComponent`**：`pathname` 不解码，浏览器发来的 `sha256%3A…` 永远匹配不上 id 形状，**每个真实请求都 400**（变异测试证明该修复必要）。
- 参考实现的 `.attachmentRow` 形状（`flex-wrap` + 右对齐 + 8px gap）照搬。

**新增守卫**

- `style-guard.test.ts` 增加**反向**检查：组件引用的每个 `css.<name>` 必须被本子树某张表定义。原检查只走 CSS→消费者，于是 `ImageCard` 的 `css.pending` 在改名后一直没人发现（`cx()` 丢掉 `undefined`，渲染对、引用死）。新检查当场又抓出 `StatusRows.tsx` 的 `css.metricDuration` 从未定义过——时长行一直没有样式。

**判定为「刻意偏离」、不修的**：`.sessionRow` 的 `row-in` 挂载淡入（dsh 没有）：`AnimatedRows` 的 FLIP 入场**只在指针/键盘已进入列表后才 armed**，所以「从列表外新建会话」这条路径没有 FLIP 淡入可依托，而这个 CSS 挂载淡入正好补上；它也在 `prefers-reduced-motion` 里被关掉。轮 header 在失败轮仍显示「用时 X」而非 dsh 的「已失败」：失败轮照样发 `run_stats`，且转录里已有一条 warn 色 hint 说明原因（`run_failed` 不落盘，回放时无从得知）。

- **附件功能整体是「空转」的（真 bug，最重的一处）**：拖入/粘贴/选择三个入口都会把文件 POST 到 `~/.nova/cache/uploads/` 并在栏里画出一张卡，但 `UploadedFile.path` **只写不读**、`ClientFrame` 也**没有任何附件字段**、`agent.prompt(text)` 只接受字符串——于是**模型永远不知道这个文件存在**。而 `attachments.ts` 的模块头注释还写着「那条路径就是草稿引用的东西（见 `formatMention`）」，一句与实现相反的断言。dsh 的做法是：非图片文件一律变成 `reference` chip，其文本就是 mention，随提交一起序列化。修法沿用本仓既有的诚实路径——**引用本来就是文本**：新增 `attachmentMentions()`，把每个 `ready` 行的**绝对路径**写成 `@path` / `@"path with spaces"` 追加到提示词尾部。`read_file` 能解析绝对路径，而上传目录本就是两个 trusted read root 之一，所以模型免审批即可读取；不需要新帧。**单一实现**：mention 语法继续由 `reference-menu.ts` 的 `formatMention` 唯一生产。
- **发送后附件栏永不清空（真 bug）**：`submit()` 只清了草稿/光标，`useAttachments` 根本没有 `clear`，于是已发送的卡**留在栏里装作还没发**，下一次发送会再次带上它，且因为 composer 不随会话重挂载，它会跟着读者跨会话漂移。补 `clear()` 并在提交时调用——mention 已经进了转录，卡片的使命结束。
- **拖入文件夹被静默吞掉（真 bug，死文案）**：`add()` 会**返回**拒绝文案，隐藏 picker 那条路把它交给了 `setIntakeError`；但 drop 与 paste 的监听器绑在 hook 内部、**没有调用方可返回**，返回值得到了却不使用。更糟的是浏览器文件对话框选不了目录，所以唯一的发布点**永远不可达**——`DIRECTORY_REFUSED` 是一句运行期不可达的文案，而「把文件夹拖进来」恰恰是桌面上最常见的动作。修法给 hook 加 `onRefused` 汇聚点，三条入口统一经 `admit()`，任一条都不可能再忘记发声。
- **上传未完成时 Enter 照样发送（真 bug）**：`primarySeat` 只看 `disabled || empty`，而 `composerKey` 的 `canSubmit` 传的是 `!disabled`——两者都与上传状态无关。于是在传输中按 Enter 会发出一条**指向尚不存在文件**的提示词。dsh 在 `view-binding.ts:128` 明确拒绝并给出 `file.stillUploading`。已按 dsh 原文补上该文案与守卫，并把 `canSubmit` 改为读**座位自己的判定**（`seat.kind === 'send' && !seat.disabled`），使按钮与 Enter 不可能各说各话。
- **`usageAction` 在 `clock="start"` 座位被静默丢弃**：`endInfo` 只为 `end` 分支计算、又只渲染 `endInfo`，于是选择 `start` 的调用方**接受并透传了这个 prop 却永远看不到它**。dsh 的尾行是 `clock === 'end' ? <span>{usageAction}{clockEl}</span> : usageAction`——两个座位都渲染。当前两个调用点恰好都是 `end`，所以是**潜在**缺陷而非线上故障，但位子已经挖好。已补齐并加测试。
- **统计条的「输入」行与自家面板自相矛盾**：`promptTokens` 是**计费输入**（已含缓存读取），却被标成「输入」摆在「缓存读取」上方——**上一个数包含下一个数**。dsh 该位置印的是「未缓存输入」，而 Nova 自己的 `TurnUsagePill` 早就那么算了。已改为 `未缓存输入 = promptTokens - cachedTokens`，一个会话不再对同一个数字有两种说法。
- **两处「注释与实现相反」**：`QueueDock.module.css` 声称「本仓没有 `-dimmed` label 档」，而该 token 在 `design-platform.css` 明暗两档都有定义、且 `MessageItem.module.css:158` 已在用——已改回 dsh 的原 token；`InputBar.tsx` 头部声称「没有附件入口、没有 `@` 参考目录」，而该文件同时 import 了两者——已改写为准确描述（并说明附件是靠 mention 文本而非附件帧承载）。
- **两处视觉偏离**：composer 主卡圆角写死 `22px`，dsh 在同一规则用 `var(--dsw-radius-panel)`（本仓定义为 28px，且 `SettingsPanel` 已在用该 token）；两个模式 chip 的焦点环用 `--dsw-alias-border-l3`（一档边框色）而非 `--dsw-focus-ring-color`，后者本仓已定义且在另外五个样式文件里使用——**这两个 chip 是仅有的不显示焦点色的可聚焦控件**。
- **触发菜单的可高亮行对读屏软件不可见（真 bug）**：focus 留在草稿框（combobox 模式），所以「箭头停在哪一行」此前只表现为一个 CSS 类——listbox 没有 `aria-activedescendant`、行也没有 id。按 dsh `MenuView.tsx:134` 把指针挂在 listbox 上，行 id 与指针由同一个 `listboxId` 派生（不传则两者一起消失，不留悬空引用）。
- **触发菜单会长到会话标题栏上面**：`MENU_MARGIN` 取的是通用 `Menu` 原语的 12px，而这个菜单锚在 `SessionHeader` 的 76px 之下、又是 `position: absolute`（标题栏不会把它推下去），长列表会盖住标题栏。dsh 同一座位用 `TOP_MARGIN = 84`（76 + 8px 余量），已对齐。
- **`QueueDock` 三处圆角各差一档**：顶栏 `12px`→`--dsw-radius-lg`（16px）、标题行与列表行 `8px`→`--dsw-radius-md`（12px）。
- **`frameAction` 的查表挡不住原型链（真 bug，本缺陷类第 11 处，也是最后一处）**：`MAPPERS[frame.type]` 是裸索引，而 `JSON.parse` 到这里之间**没有任何判别式校验**（`client.ts` 直接 `as ServerFrame`）。命中 `Object.prototype` 成员名时取回的是**函数**并被当 mapper 调用——`valueOf`/`hasOwnProperty` 在 socket 的 `onmessage` 里抛 `TypeError`，`constructor` 返回假 action 使 state 变 `undefined`。已用 `Object.hasOwn` 收口。
- **断开 socket 让目录选择器变死局（真 bug）**：`connection` 分支清了 `historyPending` 与 `trace.pending`，漏了 `directory.pending`；而对话框以「无层级且 `!pending`」为条件发起首次列举、并在 `pending` 期间禁用「新建文件夹」与「打开」，所以列举途中掉线会留下**没有任何帧能解除**的死局。已按同一规则清掉。
- **一次点击发两份 `list_directory`**：`App.tsx` 的 `onBrowse` 与对话框开屏 effect 各发一次，两个答复互相竞争。已让对话框 effect 成为唯一主人。
- **`DirectoryState.creating` 是死状态**：三处写入、全仓零读取，无调用方传过该字段。类型、action 字段与三处赋值已删除。
- **`@` 引用菜单与目录下钻在键盘上完全不可用（真 bug，两处，来自对 composer 的第三次审计）**：
  - **`@` 文件菜单无法被 Enter/Tab 选中**：菜单的开合由**两个**触发源决定（`slashQuery` 的 `/` 令牌 **或** `atQuery` 的 `@` 引用），但判定「Enter 该不该收下高亮行」的 `menuSettlesOnEnter` **只认 `/`**。于是文件菜单明明开着，Enter 却落到发送路径，把 `@src/ma` **当散文原样发出去**——高亮的那个文件从未被采纳。已让两个触发源给出同一答案（新增 `reference` 参数，由 `refSource` 传入）。
  - **目录下钻的 chevron 是个渲染出来的空操作**：`ComposerMenu` 声明了 `onDrill`、把它接进了 chevron 的 mousedown，**但唯一的调用点没传**（`onDrill` 全仓只出现在 ComposerMenu 自己内部）；而那个 handler 又 `stopPropagation`，所以点击既不下钻也不选中，整次点击被吞掉。同一道缝也解释了 Tab 从不生效——它被折进 settle 分支，没有下钻路径。已补 `onDrill={pick}` 并把 Tab 接成 chevron 的键盘孪生（`arbitrate('tab')` → `'drill'`）。
  - **选中的目录令牌一写出来就是死的**：`referenceDraft` 一律追一个空格、`formatMention` 一律闭合引号，于是 `atQuery('@src/ ')` 与 `atQuery('@"my dir/" ')` **双双返回 null**——即使 chevron 修好，也没有可续接的令牌。dsh 的 `formatFileMention` 对目录**故意让引号保持打开**（`@"my dir/`）、且不追空格。已按此对齐。
  - 为了让最后这条**可断言**（UI 测试车道没有 DOM），把整段按键仲裁从组件里提出来成纯函数 `menuKeyDecision(key, draft, caret, row, reference)`（`command-menu.ts`）——这正是一道藏 bug 的缝：调用方**漏传 caret**、判定只认一个触发源，两个缺陷都因为它内联在组件里而无法被测试捕获。现三条变异（去掉 reference、caret 强制取尾部、去掉 Tab 下钻）都会让测试变红。
- **`mentions()` 是死导出**：文档声称它用于「从文本本身渲染附件 chip，使 chip 不会比它代表的令牌活得更久」，而**全仓只有它自己的测试导入它**；待发送栏实际由 `attachments.files` 驱动（与 `attachmentMentions` 是两件事）。已删除函数与测试。

### 计划面板与尾行间距（第 8 轮，来自操作者对截图的两处点名）

- **计划面板横跨整个视口，比它坐着的输入卡宽一整圈（真 bug，已真机实测）**：`TodoPanel.module.css` 的 `.root` 写成 `width: 100%`，而 dsh 那份是**算出来的**——`100% − 两次 side-clearance − 四次 dock-inset`，再 `max-width: card-max-width − 四次 dock-inset`、`margin: 0 auto`。少减这一圈就是「明显太宽」：实测修复前面板占满 1254px 视口，修复后 **680px**，与输入卡的 712px **两侧各差 16px**（正是四个 dock inset）。同文件里 `QueueDock.module.css` 早就带着这条公式，两块卡共用一个 dock 却有两种宽度。顺带把 `.body`/`.header`/`.item` 的取值逐行对回 dsh（卡面与宽度移到 `.root`、`.body` 只留 `6px 12px` 内边距、`.item` 由 `align-items: flex-start` 改回 `center`），并补上 dsh 的 `backdrop-filter` 与 l2 滚动条重绑。
- **完成的计划行被划掉，整块读起来像一张删除清单（自创，已删）**：`.item[data-status='completed'] .content { text-decoration: line-through }` **在 dsh 那份 CSS 里根本不存在**（`data-status` 属性 dsh 有，但没有任何按状态的样式规则）。dsh 只用**状态点**表达进度，行的墨色对所有状态一致。已删掉该规则与 `in_progress` 的提亮规则；实测三条完成行的 `text-decoration-line` 全为 `none`。
- **`GoalPanel` 同一个病**：它挂在同一个 dock 上、同样 `width: 100%`，不同步修就会与刚对齐的计划面板错位。已按同一份几何重写（dsh 没有 goal 面板，其目标 UI 是 composer 上的条，所以这块卡是自有的——盒子跟随移植过来的兄弟卡，不自创第二套宽度）。

**有意偏离（操作者明确要求，勿「修回」）**：转录尾行与答案的间距。dsh 是列节奏 16px + 尾行自带 lead-in 4px = **20px**，我们已 1:1；操作者判定在本仓的转录密度下它读起来像**页脚从答案上飘开**，要求更紧凑。改法是给尾行一个 `--dsh-chat-flow-gap: 8px`（**复用同文件里「闭合过程组 → 答案」已有的那一档**，不是新拍的数），合成 **12px**。真机实测（CDP 量 `[data-chat-flow-kind]` 相邻盒）：答案底 → 尾行顶 = 8px。用户气泡的动作行是 `data-chat-flow-kind=user`，**不在**这条规则内，未受影响。

### 侧栏连接指示器（第 6 轮）

- **重连按钮整条链路从未接通（真 bug，本缺陷类的又一实例：声明 + 消费齐全、生产者缺席）**：`ConnectionIndicator` 声明了 `onReconnect`、把它接进了 `<button onClick>`、并据此渲染 `.hoverLabel`（「立即重连」悬停文案）与两条无障碍标签——**但唯一的调用方 `SidebarFoot` 没传**。于是线上永远走 `onReconnect === undefined` 的**只读分支**：`<button>`、`onClick`、`.hoverLabel` 与 `.warning:hover` 全是**不可达的死代码**，掉线时读者只看到一个不能点的标签。dsh 的 `onReconnect` 是**必填**。已把 `App → Sidebar → SidebarFoot → ConnectionIndicator` 四级链路接通，并给 `client.ts` 补 `reconnect()`。
- **手动重连会让退避越走越远（真 bug）**：即使接通回调，只调 `close()` 也不够——退避上限 5s，而读者每按一次「重连」都会**继承已经长大的延迟**，自己的点击把他推得更远。已让手动重连**折叠等待并把退避重置回 500ms**（`nextRetry(previousMs, immediate)`，纯函数，含上限与重置两条规则）。
- **连接胶囊消失得太突兀**：dsh 用 `EXIT_MS = 150` 的淡出（进场用 `indicator-enter` keyframes、离场用 `.leaving` 把 opacity 归零），Nova 是 `state === undefined` 当场 `return null`。已补 `indicatorTransition(rendered, target)`（纯函数）与组件侧的定时器，并让 `reduced-motion` 同时关掉动画与过渡。
- **`connecting` 胶囊会闪一帧**：dsh 有 `CONNECTING_MIN_VISIBLE_MS = 800` 的**最短可见时长**，且该保持**优先于**「连接成功」确认（确认窗口从胶囊真正可见时起算，否则 2s 会被保持吃掉）。Nova 没有这条规则——40ms 就成功的重连把胶囊闪一下，读起来像故障而不像进展。已按同一分支顺序实现（`indicatorState(connection, recovered, holdConnecting)`）。
- **三处视觉偏离**：高度 `32px`→`28px`（dsh 值，且与旁边的设置触发器同高，否则掉线时脚行会变高）、缺 `1px transparent` 边框（加色边框会改变盒子尺寸）、缺 `hover` 态。已对齐。

### 状态行与轨迹表的原型链查表（第 6 轮，`?? fallback` 缺陷类的第 12、13 处）

- **`SubagentRow` 会把 `Object.prototype` 的函数源码**打印进转录**（真 bug，已实测渲染）**：`SUB_STATUS_LABELS[sub.status]` 是裸索引，而 `sub.status` 来自 `subagent_update` 帧。用 `constructor`/`toString`/`valueOf` 实测：**渲染出的 HTML 里含 `function Object() { [native code] }`**——读者的转录里出现一段 JavaScript 源码。`JobRow` 的 `JOB_STATUS_LABELS[job.status]` 同一写法（实测未泄漏，因为索引结果被塞进 `aria`/类名之外的文本位，但同样是裸索引）。邻居 `jobDot`/`subDot` 用的是 `switch`/字面量比较，**所以这是唯二的两处**。已收口到 `statusLabel(table, status, fallback)`（`Object.hasOwn`）。
- **`traceRowText` 会把继承来的函数当标签返回（真 bug，已实测）**：`ROLE_LABEL[row.role]`、`COMPACTION_LABEL[row.phase]`、`OUTCOME_LABEL[row.outcome]` 三处裸索引，三个值都是 `trace` 帧的判别式（即宿主日志说了什么就是什么）。实测 `typeof text.label === 'function'`、`typeof text.trailing === 'function'`——轨迹面板会把一个函数交给 React 渲染。已收口到 `pick(table, key, fallback)`（`Object.hasOwn`）。
- 两处守卫都做了**变异验证**：改回 `table[key] ?? fallback` 后新增的测试立刻变红。

### 设置面板三个管理页（第 7 轮：接手「Skill 中心 / 插件管理器 / QQ 机器人」）

背景：这一轮的功能由**用户另开的并行会话**先落地（配置层 / 内核层 / Web 后端 / 前端骨架），用户暂停它后交给我接手。接口都声明齐全、单测各自通过，但仍查出 **3 个真 bug**（其中一个同一根因在**三个**组件里各犯一次）。共同教训：**「声明 + 消费齐全、生产者缺席」与「等待一个永不到来的答复」，是同一个盲区的两种形态**——测试照着手写的 fixture 一路绿，因为 fixture 直接给了组件它等的那个 prop。

- **Skill 开关是单向的（真 bug，最严重）**：`loadWorkspace()` 把**过滤后**的列表写进 `env.state.skills`，`kernel.skills` 返回的正是它，而 `manage-frames.ts` 的 `skillRows()` 就从这个列表建行、`enabled` **硬编码为 `true`**，`list_skills` 还硬编码 `disable: []`。后果：把一个 Skill 关掉 → 它从面板里**消失** → 面板再也点不回来（`skills.disable` 只能在配置文件里手改）。参照实现把「发现的全部」与「生效的」分开。已补 `env.state.allSkills`（未过滤发现）、`kernel.allSkills`、`kernel.disabled`，`skillRows(kernel, disable)` 按开关集合算 `enabled`，`list_skills` 读真实 disable 表。**变异验证**：把 `allSkills` 改回 `skills` → 3 条测试变红；`list_skills` 改回 `[]` → 1 条变红。
- **`clientSecretRef` 永远是 `undefined`（真 bug，死代码）**：`web-mode.ts` 用 `loadConfig()` 的返回值去匹配 `/^\{env:(...)\}$/`，但加载会跑 `expandDeep()`——`{env:QQ_SECRET}` 这时**已经是明文密钥**，正则永远不匹配。于是面板永远显示「已配置（不再显示）」而不是「引用环境变量 QQ_SECRET」，读的人无从知道密钥是从哪来的。已加 `readQqBotSecretRef(homedir?)`（`config-write.ts`，读**原始文档**，与所有写入者同一份纪律）并接进 `web-mode.ts`，删掉死掉的 `refName()`。**变异验证**：让正则永远匹配不到 → 2 条测试变红。
- **被拒绝的开关会永久卡死整页（真 bug，同一根因在三个组件里各一次）**：`SkillsSection` / `PluginsSection` / `QqbotSection` 都用「下一个快照到达 ⇒ 清掉 in-flight」的写法，注释还写着「拒绝会走 error 帧，另一处处理」。但**那个「另一处」不存在**：`error` 分支只写转录 hint，**不碰 `skills` / `plugins` / `qqbot`**，所以拒绝时快照永远不变、`switching` / `busy` **永远是那个值**，控件（以及两个 Section 里**整页所有**开关）从此永久禁用，只能关掉面板再打开。已在 reducer 的 `error` 分支加 `manageError: { seq, message }`（计数器而非布尔，同一句拒绝第二次仍可观测；`ready` 重连时清空），三个组件各补一条 `useEffect` 监听它。**变异验证**：去掉 reducer 那一行 → 3 条测试变红。
- **QQ 机器人页的主按钮不可读 + 违反样式护栏（真 bug，已被门禁抓住）**：`.primary` 用了 `--dsw-alias-interactive-bg-active`（一个**半透明 hover 浮层**色，不是实心填充）配字面 `#fff`。两处都错：前者在浅色模式下几乎无对比度，后者直接违反「组件 CSS 零字面色」护栏（`style-guard.test.ts` 报 `QqbotSection.module.css: #fff`）。已改用全仓统一的实心按钮配方（`--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-foreground`，与 `ApprovalPanel` / `DirectoryBrowser` / `QuestionPanel` / `DeleteSessionDialog` 同一对）。**顺带**：改正后护栏又报了一次同一个 `#fff`——因为它出现在我**新写的 CSS 注释里**，而护栏扫注释。注释已改写。
- **结构棘轮一次抓出 15 个超限文件**：并行会话的功能改动让 15 个文件越过行数天花板（`config-write.ts` 从 49 涨到 205，**4 倍**）。按 AGENTS.md「单文件超长是设计失败，按职责拆」拆了两处真正混了职责的：`config-write.ts` → `config-doc.ts`（**怎么改**：原始文档读写、原子替换、拒改不可解析文件）+ `config-write.ts`（**改什么**）；`runtime-types.ts` → `runtime-assembly.ts`（surface 要**提供**什么）+ `runtime-types.ts`（surface 会**消费**什么，并 re-export 前者以保住唯一的导入缝）。其余 15 个是功能驱动的正常增长，走 `pnpm gates:update` 显式 `RAISED` 落账。
- **旧测试里一条脆弱断言**：`plugins.intro` 文案带上了「并写入配置文件」，与断言「未加载时不渲染 `config.title`（=配置文件）」**子串相撞**而变红。产品的文案没错，是断言粒度太粗——已改断言 `config.copy`（复制路径按钮，加载态下不可能出现），这才是「那一行没渲染」的无歧义标志。
- **`QqbotSection` 此前零测试**：已补 5 条静态渲染测试，其中一条钉住该页自己的承诺（文案「密钥永不回显」）：有引用时显示**变量名**而非值、字面密钥只显示「已配置」、输入框在有密钥时仍为**空**。另有一条**反向**断言：这两个输入框**不应**声明 `data-modal-escape-owner`——该属性是「Escape 归本字段」的让渡，只在字段**真的会处理**该键时才成立（插件搜索框会清空、路径框会跳转），QQ 页的字段什么都不做，声明它反而是**吞掉** Escape、把读者锁在鼠标上。**我最初把这条测试写成了正向断言（以为该补上），是测试先红才让我发现该行为本就不该存在。**

### 插件不得阻塞主线程（第 8 轮：用户报告的启动失败）

用户报告：`nova` 直接退出，只打印 `config references environment variable {env:QQ_SECRET} but it is not set`。**用户诊断完全正确**——「插件不应该阻塞主线程运作，就是没配置也只应该在 webui 和设置卡片显示插件报错」。

- **根因**：`loadConfig` 对**整份**文档跑 `expandDeep`，任何未解析的 `{env:NAME}` 一律抛错。而 `qqbot` 是**第三方渠道插件**（AGENTS.md §4 原文：「`qqbot` 第三方插件编写示范」），它的凭据只有 `nova qqbot` 用得上——浏览器界面、REPL、`exec` 全都**不读这个值**，却一起被它拖死。一个插件把整个产品带下水。
- **修法**：把「展开」按**归属**切片（新增 `config-expand.ts`）。核心段（`provider`）保持**加载即抛**——没有可用的 provider 凭据，任何 surface 都跑不了一轮，这不是诊断而是「起了也没用」；插件自有段则**保持字面并记录诊断**。名单是**插件白名单**而非核心黑名单：以后新增的段默认仍属核心、仍会大声失败，除非有人显式把它交给某个插件。
- **不留空串**：未解析的引用**保留字面**而不是替换成 `''`。空串回退正是当初被废掉的坑（空凭据发到网上换回一个没头没尾的 401）；留字面至少自解释，而拥有者能在**发请求之前**按名字拒绝它。
- **失败移到真正需要它的地方**：`nova qqbot` 在启动时检查并**明确指出是哪个字段、哪个变量**（`qqBotConfigProblem`，读**原始文档**）；浏览器面把诊断挂在该插件自己的「QQ 机器人」页上（`qqbot` 快照新增 `error` 字段），页面上任何其他功能都不受影响。
- **保存后重新判定**：`recheckQqBot` 从磁盘重新推导，而不是保存即清除——存进**另一个**未解析引用同样不可用，清掉提示等于谎报修好了。
- **测试**：`config.test.ts` 新增 11 条（插件段降级 + 核心段仍致命 + 混合文档 + 每变量只报一次 + 从磁盘取判定）。**变异验证**：把 `qqbot` 移出插件白名单 → **4 条立刻变红**。另加 UI 静态渲染测试（有 error 时显示、健康时不显示）。
- **归档**：`config-write.ts` 按职责拆出 `config-doc.ts`（**怎么改**）与 `config-read.ts`（**读什么**：存的是哪个变量引用、现在能不能用），`config-write.ts` 只留「改什么」。

## 差异清单（既有条目）
- **`ui-user-questions` 的草稿查表崩溃（真 bug，`?? fallback` 缺陷类的第 10 处）**：`decisions.ts` 的四处 `drafts[question.id] ?? EMPTY_DRAFT` 都**挡不住原型链**——问题 id 是**模型给的**（`parseQuestions` 只限长度、不排除 `constructor`），而草稿表是对象字面量，于是 `drafts['constructor']` 取到继承来的 `Object` 函数、`??` 回退**永远不触发**，`isComplete` 拿函数去读 `.length` 抛 `TypeError`，**整张问题卡崩掉**。实测四个函数（`allComplete` / `firstIncomplete` / `buildAnswer` / `isComplete`）全部抛错。修法：`decisions.ts` 新增**唯一**的安全查表 `draftOf(drafts, id)`（`Object.hasOwn`），四处调用点全部改走它；`QuestionPanel.tsx` 的同名写法也一并收口。回归测试用五个继承成员名（`constructor`/`toString`/`valueOf`/`__proto__`/`hasOwnProperty`）钉住，并做变异验证（恢复 `??` 写法后 2 条测试立刻变红）。
- **`ui-user-questions` 的 Skip 死路（真 bug）**：`Skip` 只移动分页游标、**不记录跳过**，于是 (a) 单题批次的 Skip 是**彻底的空操作**，(b) 多题批次跳过的题永远 `isAnswered === false`，`allAnswered` 恒假，**提交按钮永久禁用**——用户走进死胡同。参照实现用 `completed = answered || skipped` 收口，Nova 缺的就是 `skipped` 这一位。已按 `isComplete` / `allComplete` / `firstIncomplete` / `skipQuestion` 收口，并把「提交被拒时跳到卡住的那一题」也补上。
- **`ui-user-questions` 的 detail 渲染**：Nova 用 `<pre>`，dsh 用 markdown（`MarkdownText`）——计划正文里的标题与列表会**按源码字面显示**。已改走 `MarkdownText`（`variant="compact"`），并同步修正 `.detail` 的等宽字体与 `white-space: pre-wrap`（对文档是错的）。
- **`ui-user-questions` 的选项语义**：单选项列表缺 `role="radiogroup"`/`role="radio"`（屏幕阅读器只念「按钮」，**不念这是单选还是多选、第几个**）。已补 `role` / `aria-checked`；同时补上参照实现的两条交互：**单选即自动前进**（选完不必再按「下一题」）、**单选的自由文本会替换已选选项**（否则同一题会同时带着选项与「其他」两个矛盾答案上路）。
- **`ui-user-questions` 的卡片头部（用户反馈「UI 效果简陋」后对齐）**：提问卡此前**借用了审批卡的彩色顶部条**（`等待确认` + dot + 序号 badge），而 dsh 的 `QuestionComposer` 是**干净的 header**——问题文本本身是卡片标题（16px/500 的 `h2`，可选 `header` 作为 eyebrow），右上角是折叠 / 放弃两个 24px 图标按钮，**没有彩色条**。已按 dsh 逐行对齐：`QstionPanel.header` 承载标题与折叠/关闭，`strip` 移除；选项前加**序号（单选）/ 勾选框（多选）**指示器（20×20）、选项选中态改为轻浮层背景 + 细边；自定义答案改为**选项形状的一行**（`customRow`，带指示器；无选项时才是独立 `customBlock`）；底部翻页器（`‹ n / m ›`）独立成 `pager`，进度不再挤在 badge 里。**有意保留**：审批卡的彩色条**不能再共用**——dsh 的审批卡本身就是 warn strip（`ApprovalPanel.tsx` 的 `StateDot + waiting`），所以审批卡是对的、别把它当「简陋」改回去。

## TUI 移植（终端面，`dsh-TUI-main` 参照）

参照系：`D:\下载\dsh-TUI-main\dsh-TUI-main`（**只读**）。名义规模 1069 文件 / 约 17.3 MB，`src/` 约 12.5 万行；其中**可移植的 UI 层**约 3.8 万行，**宿主耦合层**约 7.8 万行。

### 判定：移植能力，不移植实现

dsh-TUI 是 Ink（React 19 + react-reconciler）+ 约 28 个运行时依赖 + 约 30 个 `@deepseek-ai/*` peer + vendored `@dsh-std/*`。Nova 的 surface 姿态是**零第三方依赖**（`web` 自写 RFC6455 是同一条纪律），且渲染层一旦与产品逻辑纠缠就再也拆不开——这正是本仓 TUI 当初被整体删除的第一条理由。所以**逐文件移植被否决**，改为「能力对齐 + 本仓自己的分层」：

| 关注点 | dsh-TUI 的做法 | Nova 的落点 | 判定 |
| --- | --- | --- | --- |
| 字符宽度 / ANSI / 键序 | 依赖 Ink 与若干 `string-width` 类包 | `packages/tui`（**零依赖**，白名单为空由门禁保证） | 对齐（自研） |
| 重绘 | React reconciler 差量渲染 | `packages/tui/src/screen.ts` cell 网格 + 增量重绘 | 对齐（自研） |
| 转录与卡片 | React 组件树 | `tui-app/src/blocks.ts`（归约）+ `panels.ts` / `question-card.ts`（渲染），**纯函数** | 对齐（自研） |
| 键盘路由 | React 事件 + 上下文 | `tui-app/src/keys.ts` 单一键链，`KeyboardOwner` 定归属 | 对齐（自研） |
| 审批 / 提问 | 组件内状态 | transcript 两个独立字段 + 两张接管卡，审批优先 | 对齐 |
| 主题 / 配色 | dsh token 体系 | `tui-app/src/theme.ts` 的 `Palette`（诚实降级：无色终端走 `plainPalette`） | 部分（未做 dsh 的三层 token） |
| 图片 / markdown 渲染 | Ink 组件 + 终端图形协议 | **未做** | 未对齐（见下） |
| 桌面宿主集成（剪贴板/通知/打开文件） | 依赖 `@deepseek-ai/*` 宿主 | **不做**（N/A，与 N3/N4 同因） | N/A |

### 未对齐（明记，不装成已对齐）

1. **终端内图片渲染**：dsh-TUI 有终端图形协议路径，Nova 侧只做图片的**文本占位**。终端图形协议在 Windows Terminal / ConPTY 下支持度参差，收益与代价未评估，**未立项**。
2. **markdown 富渲染**：Nova 的终端面按纯文本行渲染，不做行内样式解析。浏览器面有元素树渲染（`web/ui`），终端面没有对应实现。
3. **真机验收无法自动化**：这是本仓 TUI 当初被删的第三条理由，也是本次恢复**唯一没解掉**的一条。`tui` + `tui-app` 共 17 个测试文件 / 261 个断言，但全部在无 TTY 的纯函数车道；「帧真的画对了、键真的收到了、退出真的还原了终端」在 CI 里没有自动化证据。`pnpm smoke:web` 的终端对应物**不存在**。见 `AGENTS.md` §7.4。

### 未采纳（并说明为什么不采纳）

- **Ink / React 的组件化终端渲染**：与「零第三方依赖」和「渲染层不碰产品逻辑」两条姿态直接冲突；且 Ink 的 reconciler 在本仓会变成第二个需要维护的渲染语义。
- **vendored `@dsh-std/*`**：那是 dsh 的内部标准库，搬进来等于把别人的内部约定变成自己的公共面。
- **插件化 UI 插槽（同 N1）**：Nova 的终端面是同一 Vite/tsdown 之外的独立包，没有运行时插槽承载物；「第三方 TUI 插件」目前没有消费者。

### 复用的那条既有结论

`ui-user-questions` 的两个真 bug（原型链查表、Skip 死路）在终端面**同样的形状会再犯一次**，因此 `tui-app/src/question.ts` 是 `web/ui/src/question/decisions.ts` 的**一对一移植**并按同一份规则收口：`draftOf` 走 `Object.hasOwn`、`isComplete = answered || skipped`。这不是巧合而是一条纪律——**同一个交互语义在两个 surface 上分叉，等于同一个按键在两处做不同的事**。终端面的回归测试同样带原型污染用例与「全跳过批次可提交」用例。
