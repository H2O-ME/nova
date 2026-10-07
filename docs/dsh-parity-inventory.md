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
| 10 | `ui-directory-picker-native` | 8 / 468 | `web/src/native-picker.ts` + `picker-frames.ts`、`web/ui/src/shell/native-pick.ts` | **已对齐**（机制同源；实现路径偏离见下方 N4，勿修回） |
| 11 | `ui-dockkit` | 37 / 8922 | `composer/DockStack.tsx` | 部分 |
| 12 | `ui-goal` | 19 / 1979 | `conversation/GoalPanel.tsx`、`composer/claim-hint.ts`、`plugins/goal-command.ts` | **已对齐**（dsh `GoalBar` 的动作按钮条未移植，面板暂只读） |
| 13 | `ui-input-trigger` | 22 / 4193 | `composer/{command-menu,reference-menu,reference-crumbs,ComposerMenu,ComposerCrumbs}`、`InputBar.tsx` | **已对齐**（@ 的目录列举语义、下钻面包屑、folder/file 行图标、「文件」节标题与 dsh `ui-reference`/`MenuView` 同源；dsh 的会话候选源未做——本仓没有 session reference 通道） |
| 14 | `ui-jobs` | 11 / 1777 | `flow/StatusRows.tsx` | 部分 |
| 15 | `ui-layout` | 21 / 2781 | `shell/{AppFrame,columns,layout-store,use-layout}` | 对齐 |
| 16 | `ui-message-feedback` | 21 / 2867 | `chat/MessageIconActions.tsx`（**仅复制**；分叉按钮已渲染但从未接通，见未对齐明细 11） | 部分 |
| 17 | `ui-model-selection` | 16 / 2777 | `composer/{ModelSeat,stats-model}`、`settings/ModelSection.tsx` | 对齐 |
| 18 | `ui-open-in-app` | 25 / 2110 | — | **N/A**（N3） |
| 19 | `ui-permission-presets` | 19 / 2602 | `conversation/PermissionSelect.tsx`、`settings/GeneralSection.tsx` | 部分 |
| 20 | `ui-plan` | 22 / 1681 | `conversation/TodoPanel.tsx`、`chat/CompactionItem.tsx` | 部分 |
| 21 | `ui-plugin-manager` | 22 / 8178 | `settings/{PluginsSection,PluginRow,plugin-state,use-flip-feedback,PluginPageSection}`、`plugins/{runtime-switch,runtime-roster}` | 对齐（开关真生效并跨重启持久；`enabled` 是**唯一**开关，行里的 `config` 归插件自己的 `Config` schema；插件自带设置页由 `manifest.page` + `PluginPageDescriptor` 描述、`PluginPageSection` 通用渲染，导航从活 roster 的 `page` 行派生，关掉的插件页从导航消失） |
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
- **N4 `ui-directory-picker-native`**：已补齐（2026-09-30，`pick_file` / `pick_directory` 帧 → 宿主原生对话框）。**机制同源，实现路径偏离，勿修回**：dsh Windows 用 koffi+COM 驱动 `IFileOpenDialog` 子进程，macOS `osascript`、Linux zenity→kdialog；Nova 零第三方依赖，Windows 走 PowerShell + WinForms、POSIX 仅 zenity（macOS 无 zenity 时回落进程内浏览器，osascript 未加）。**前台处理刻意不同**：dsh 在 Show 前合成一次 Alt 按键（`keybd_event(VK_MENU)`）解锁前台；**本仓实测否决了这条**——Alt 是全球按键，在火狐里会弹出传统菜单栏（用户报告的「卡出旧版火狐菜单栏」）。改用 WinForms 定时器轮询 `SetWindowPos(HWND_TOPMOST)` + `SetForegroundWindow` 顶自己的 `#32770` 窗口，零按键注入；轮询是必需的（窗口在 ShowDialog 之后才创建，且 `FolderBrowserDialog` 自己永远不激活——它正是用户报告「被盖在浏览器下面」的那条）。dsh 的中止协议（`WM_CLOSE` 重投 + kill 兜底）未移植——Nova 的 pick 子进程无超时、随断连收敛，不做中止。
- **N5 `ui-sidebar-terminal` / `ui-sidebar-browser`**：右栏交互式 shell 与沙箱浏览器 tab。Nova 的右栏只有**工具详情侧板**；终端与内嵌浏览器都是大块独立能力，且 dsh 侧依赖其桌面宿主。**不是遗漏，是未立项**。

## 未对齐明细（按可实施性排序）

### A. 有明确内核/协议支撑，缺口只在界面

1. **`ui-shortcuts`**：快捷键参考与本地自定义。Nova 的按键处理散在 `composer-keys.ts` / `shell/use-escape.ts`，**没有可发现的快捷键清单**。可先做只读参考表（列出已实现的键位），不需要新协议。
2. **`ui-sidebar` 的会话操作**：重命名 / 归档 / 置顶 / 行内菜单 / 拖拽排序 / 手动排序。Nova 的会话行只有**删除**，且标题是**从日志头扫描派生**的（`core/session-peek.ts`，首条提示词前 120 字），**不是存储字段**。dsh 对应 `ui-workspace/src/client/rows/Rows.tsx`、中文文案在 `ui-workspace/src/client/locales.ts`（`menu.fork` 分叉会话 / `menu.archiveSession` 归档会话 / `menu.pinSession` 置顶会话 …）。**需要新协议帧**（内核 + web + UI 三层），是当前最大的一块缺口。
3. **`ui-skill`**：`/` 菜单缺少 skill 源。内核已把 skills 索引注入了上下文，`ui-skill` 只是把它接进 `/` 触发源；Nova 的 `command-menu.ts` 已有「注册表认得 `/name` 就发命令帧」的分发点，**接一个源即可**。
4. **`ui-settings-*` 五个配置页**（shell / agent-loop / subagent / web-search / plugin-inventory）：Nova 的内核**已有**对应可配置项（`tools.bash.timeoutMs`、`tools.bash.shellPath`、`maxTurns`、`autoCompactTokenLimit`、`projectDocMaxTokens`、`notify`，以及**每个插件行自己的 `config`**），但**前端只能改插件那部分**——插件自带设置页（`manifest.page` + `PluginPageDescriptor` + `plugin_request`/`plugin_response`）已能读写某一行的 `config`，而 `packages/web/src/protocol.ts` 的 `ClientFrame` 对**核心段**仍没有任何读写帧，`ready` 也只带一个 `configPath` 字符串。所以今天剩的是「核心配置有、前端没有」这块缺口（`tools.code` 已随重构删除，执行模式现在是 `@nova-agent/plugin-ptc` 那一行 `config.mode` 的事，归插件自己的设置页）。
5. **`ui-plugin-manager`**：Nova 的 `PluginsSection` 是**只读花名册**（名字/状态/注入的服务）。`plugins.entries` 已是唯一的正式配置入口（`enabled` 单一开关、行里 `config` 归插件自己的 schema），因此可做成可写。

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
- **被拒绝的开关会永久卡死整页（真 bug，同一根因在三个组件里各一次）**：`SkillsSection` / `PluginsSection` / `QqbotSection`（**`QqbotSection` 已随插件架构重构删除**，见 AGENTS.md §5 插件设置页；当时三处各犯一次）都用「下一个快照到达 ⇒ 清掉 in-flight」的写法，注释还写着「拒绝会走 error 帧，另一处处理」。但**那个「另一处」不存在**：`error` 分支只写转录 hint，**不碰 `skills` / `plugins` / `qqbot`**，所以拒绝时快照永远不变、`switching` / `busy` **永远是那个值**，控件（以及两个 Section 里**整页所有**开关）从此永久禁用，只能关掉面板再打开。已在 reducer 的 `error` 分支加 `manageError: { seq, message }`（计数器而非布尔，同一句拒绝第二次仍可观测；`ready` 重连时清空），三个组件各补一条 `useEffect` 监听它。**变异验证**：去掉 reducer 那一行 → 3 条测试变红。**这条纪律今天仍适用**：任何「等下一个快照清 in-flight」的控件都必须同时听 `manageError`，因为拒绝**不会**产生新快照——插件设置页的表单也一样。
- **QQ 机器人页的主按钮不可读 + 违反样式护栏（真 bug，已被门禁抓住）**：`.primary` 用了 `--dsw-alias-interactive-bg-active`（一个**半透明 hover 浮层**色，不是实心填充）配字面 `#fff`。两处都错：前者在浅色模式下几乎无对比度，后者直接违反「组件 CSS 零字面色」护栏（`style-guard.test.ts` 报 `QqbotSection.module.css: #fff`）。已改用全仓统一的实心按钮配方（`--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-foreground`，与 `ApprovalPanel` / `DirectoryBrowser` / `QuestionPanel` / `DeleteSessionDialog` 同一对）。**顺带**：改正后护栏又报了一次同一个 `#fff`——因为它出现在我**新写的 CSS 注释里**，而护栏扫注释。注释已改写。（`QqbotSection.module.css` 这个文件已随该组件删除；配方规矩不变。）
- **结构棘轮一次抓出 15 个超限文件**：并行会话的功能改动让 15 个文件越过行数天花板（`config-write.ts` 从 49 涨到 205，**4 倍**）。按 AGENTS.md「单文件超长是设计失败，按职责拆」拆了两处真正混了职责的：`config-write.ts` → `config-doc.ts`（**怎么改**：原始文档读写、原子替换、拒改不可解析文件）+ `config-write.ts`（**改什么**）；`runtime-types.ts` → `runtime-assembly.ts`（surface 要**提供**什么）+ `runtime-types.ts`（surface 会**消费**什么，并 re-export 前者以保住唯一的导入缝）。其余 15 个是功能驱动的正常增长，走 `pnpm gates:update` 显式 `RAISED` 落账。
- **旧测试里一条脆弱断言**：`plugins.intro` 文案带上了「并写入配置文件」，与断言「未加载时不渲染 `config.title`（=配置文件）」**子串相撞**而变红。产品的文案没错，是断言粒度太粗——已改断言 `config.copy`（复制路径按钮，加载态下不可能出现），这才是「那一行没渲染」的无歧义标志。
- **`QqbotSection` 此前零测试**：已补 5 条静态渲染测试，其中一条钉住该页自己的承诺（文案「密钥永不回显」）：有引用时显示**变量名**而非值、字面密钥只显示「已配置」、输入框在有密钥时仍为**空**。另有一条**反向**断言：这两个输入框**不应**声明 `data-modal-escape-owner`——该属性是「Escape 归本字段」的让渡，只在字段**真的会处理**该键时才成立（插件搜索框会清空、路径框会跳转），QQ 页的字段什么都不做，声明它反而是**吞掉** Escape、把读者锁在鼠标上。**我最初把这条测试写成了正向断言（以为该补上），是测试先红才让我发现该行为本就不该存在。**（组件与测试都已随重构删除；**那条反向断言的教训被 `PluginPageSection` 继承**：通用渲染器只在字段类型真的声明了键盘行为时才让渡 Escape。）

### 插件不得阻塞主线程（第 8 轮：用户报告的启动失败）

用户报告：`nova` 直接退出，只打印 `config references environment variable {env:QQ_SECRET} but it is not set`。**用户诊断完全正确**——「插件不应该阻塞主线程运作，就是没配置也只应该在 webui 和设置卡片显示插件报错」。

- **根因**：`loadConfig` 对**整份**文档跑 `expandDeep`，任何未解析的 `{env:NAME}` 一律抛错。而 `qqbot` 是**第三方渠道插件**（AGENTS.md §4 原文：「`qqbot` 第三方插件编写示范」），它的凭据只有 `nova qqbot` 用得上——浏览器界面、REPL、`exec` 全都**不读这个值**，却一起被它拖死。一个插件把整个产品带下水。
- **修法**：把「展开」按**归属**切片（新增 `config-expand.ts`）。核心段（`provider`）保持**加载即抛**——没有可用的 provider 凭据，任何 surface 都跑不了一轮，这不是诊断而是「起了也没用」；插件行里的引用则**保持字面并记录诊断**。**归属判据后来从「插件白名单」改成结构性的**（`plugins.entries[].config` 里的未解析引用归那一行，见 AGENTS.md §3）：旧的 `PLUGIN_OWNED_SECTIONS = new Set(['qqbot'])` 是**宿主源码点名插件**，重构时已删除；今天新增一个插件不需要改宿主任何一行，它的 `{env:NAME}` 自动归它自己。
- **不留空串**：未解析的引用**保留字面**而不是替换成 `''`。空串回退正是当初被废掉的坑（空凭据发到网上换回一个没头没尾的 401）；留字面至少自解释，而拥有者能在**发请求之前**按名字拒绝它。
- **失败移到真正需要它的地方**：`nova qqbot` 在启动时检查并**明确指出是哪个字段、哪个变量**；浏览器面把诊断挂在该插件自己的设置页上（`page` 描述符的 `status` / `note` 字段），页面上任何其他功能都不受影响。
- **保存后重新判定**：从磁盘重新推导，而不是保存即清除——存进**另一个**未解析引用同样不可用，清掉提示等于谎报修好了。
- **测试**：`config.test.ts` 新增 11 条（插件段降级 + 核心段仍致命 + 混合文档 + 每变量只报一次 + 从磁盘取判定）。
- **归档**：`config-write.ts` 按职责拆出 `config-doc.ts`（**怎么改**）与 `config-read.ts`（**读什么**：存的是哪个变量引用、现在能不能用），`config-write.ts` 只留「改什么」。

> **本节两条机制已随插件架构重构改写**（见 AGENTS.md §3/§5）：①「插件白名单」改成**结构归属**（`plugins.entries[].config` 的引用归那一行，`PLUGIN_OWNED_SECTIONS` 已删除），所以「把 `qqbot` 移出白名单 → 4 条变红」那条变异验证不再有对应代码；②QQ 专用的帧与设置页（`qqbot` / `save_qqbot` / `test_qqbot` 帧、`qqbot` 快照的 `error` 字段、`recheckQqBot`、`QqbotSection` / `QqbotGuide` / `qqbot-view.ts`）**全部删除**，取而代之的是**一对通用帧** `plugin_request` / `plugin_response`（`packages/web/src/plugin-frames.ts`）与一个通用渲染器 `PluginPageSection.tsx`——插件自己回一个 `PluginPageDescriptor` 描述它的状态与字段。**这几条改动的净效果是本节想要的那个结果**：一个插件的配置问题只让那一行报错，不再拖死整份启动。

### 上下文视图按 `dsh-context` 重做（第 9 轮：用户点名「插件显示页面有些简陋，没达到」）

参照 = 第三方 dsh 插件 `dsh-context`（Apache-2.0，本地 `D:\下载\dsh-context-main`，其自带 `AGENTS.md`）。**对齐的是几何与词汇，不是代码**——它的客户端（1.4 万行、Tailwind 类 + 宿主 `@deepseek-ai/*` 原语）搬不进本仓，逐项换算到本仓的 CSS module + token 层与 fold 的数据面。

- **对齐取值**：构成条 16px（原 12px）、段间 2px 缝、未占满的窗口画斜纹剩余区；趋势图 130px 画布 + 18px 头、14px 柱宽、2px 节奏、左侧 44px 轴栏、5 档刻度（1/¾/½/¼/0）与虚线网格 + 实线零基线；行/卡节奏沿用 pane 既有（12px 卡内边距、tabular 数字、`--dsw-*` 色）。
- **对齐词汇**（`locale` 的 key 反查所得）：`当前上下文 / 上下文趋势 / 上下文事件 / 文件活动 / 轮次 / 请求 / 工具调用 / 缓存命中 / 读取 · 写入 · 搜索 / 全部 / 约 N tokens（估算）`。分类名沿用本仓既有（系统提示/工具定义/注入上下文/用户输入/助手回复/工具结果），与 chat 侧一致。
- **对齐结构**：统计条（新）、当前上下文（大号读数 + 已用百分比 + 悬停联动的图例）、趋势（真图表 + 悬停气泡 + 点击钉住 + 明细行）、**窗口元素**（新卡：构成条的「开箱」，一类别一张可折叠卡）、文件（按用途逐枚徽章 + `+增/−删`）。**上下文事件卡**曾在第 9 轮按操作者裁定删除（面板只答两问），**第 14 轮接回**（2026-10-01）——读数一直在 `ContextTimeline.events` 与 fold 里，把「为什么变了」当第三问接回是面板姿态的修正，不是数据面扩张。
- **第 14 轮继续补齐（2026-10-01，前端纯函数 + SSR 直测，零内核改动）**：① **事件卡**（`EventsCard.tsx`）：倒序一行一条，每 kind 自带字形与中文词（压缩 `✂` / 工作区 `⇆` / 目标 `◎`）；新增 kind 是 fold 一处的改动，不是 UI 重构。② **趋势明细 Δ 与缓存命中**（`TrendDetail.tsx` 扩展）：悬停或钉住非最新请求时，每类别行追加带符号 Δ 药丸（增绿减红）；明细底部一行给缓存命中率（`cached / prompt`，与 chat pill 同算式）。③ **热力图**（`HeatmapCard.tsx`，新）：最近 8 周的请求/token/输出三档按周排列的日格热力图，**单会话**口径（跨会话归并归仪表盘，未做）；格子按当日值对峰值的比值取 0..4 级。（热力图后于第 17 轮按操作者裁定删除。）
- **第 16 轮补独立测试覆盖（2026-10-01）**：事件卡此前的断言只夹在 `context-view.test.tsx` 的存在性检查里（`data-context-events`），与 Browser/DNA 的独立测试文件不同口径。本次新增 `web/ui/test/events-card.test.tsx`（4 用例：空态提示、倒序、三种 kind 的字形与中文词、`freed > 0` 才出 Δ 且只在压缩行）。仪表盘卡的独立直测在 `dashboard-card.test.tsx`（4 用例：corpus 摘要 + sparkline + 工作区 top-5、leaderboard 上限 5、空语料全空格、加载中不渲染）此前已落地。同轮还给热力图卡写过 3 条直测——第 17 轮删卡时一并移除。
- **第 17 轮按操作者裁定删两张卡（2026-10-01）**：**上下文浏览器（`BrowserCard`）与活动热力图（`HeatmapCard`）移除**——面板回到更短的列。删的是卡片不是数据面：窗口快照契约（`ContextWindowSnapshot` / `windowAt` / `windowAtSeq`）与只读路由 `GET /api/context-window` 保留，DNA 卡仍按请求拉同一份快照；热力图是纯前端折叠，连同 `ContextView.module.css` 的 `heat*` 段与 `browser*` 段一并删除（共享类不动，样式护栏全绿）。事件卡与 DNA 卡的独立直测保留。
- **刻意未移植（数据面不在本仓）**：费用/计价与模型价格表、智能体网络图、**轮次条**（会话日志没有 turn/step 坐标——`ContextPoint` 只有 `seq`/`at`）、**自动压缩预留带**（内核按 `autoCompactTokenLimit` 绝对阈值压缩，窗口比例不是本仓的事实；要画得先把它加进 `ready`）。**计时 spans 已落地**（2026-10-01，第 15 轮）：内核 `RunMeter` 记每请求 `startedAt`/`firstTokenAt`/`finishedAt` → `RunStats.requestTimings` → `run/stats` 事件 → fold 用 `afterMessageId` 锚点合并到 `ContextPoint.timing`；前端 `TimingCard.tsx` 一行一请求给 TTFT / 总用时 + 底部平均。**跨会话仪表盘已落地**（2026-10-01，第 15 轮）：内核 `aggregateSessions(root)` 一次走遍 `~/.nova/sessions` 把 `run/stats` 折成按日 / 按工作区桶，`GET /api/dashboard` 把结果返回，前端 `DashboardCard.tsx` 14 天 sparkline + 工作区 top-5 + corpus tokens 合计（挂载时自取；加载中 / 失败 / 空语料时不渲染）。**DNA 卡已落地**（2026-10-01，第 15 轮）：窗口快照契约 `ContextWindowSnapshot` 在 core，`plugin-context` 的 `ContextReading.windowAt(seq)` 是唯一实现（规则与 `compositionBefore(seq)` 同源），再导出 `windowAtSeq`；`web/src/context-window.ts` 加 `GET /api/context-window?session=&seq=` 只读路由（认证门后、会话 id 经 `sessionLogPath` 校验、seq 解析为非负整数），前端 `DnaCard.tsx`（堆叠条 + 类别条；条本身只读 point.cats 不需要宿主，所以测试壳里照画）。同轮的 `BrowserCard.tsx`（按请求折叠、点开拉快照内联展开 cat/label/tokens）后于第 17 轮删除——路由与快照契约由 DNA 继续消费，故保留。**`web` 因此进 `plugin-context` 的依赖白名单**。
- **不重复读数**：悬停气泡只报「身份 + 总量」，输入/输出/缓存命中归明细行；缓存命中百分比复用 `cacheHitText`（与聊天 pill 同一实现）。
- **真机量测**（headless Edge + CDP，临时 home + 复制一份真实会话）：六张卡同宽 710 / 同列 x=501（与转录同宽轴）；构成条 680×16；趋势柱 14×112；元素表 19 行；轴刻度 13.4K/10K/6.7K/3.3K/0。变异验证三条：趋势顺序反排、构成条不做饱和、文件徽章退回支配规则——各自立刻变红。
- **随之修掉的滚动缺陷（用户报告「不能上下滚动，卡在这了」）**：上下文与轨迹两面板在共享 rollport（`[data-conversation-scroll]`）之外各开了一层 `overflow:auto; overscroll-behavior: contain`；面板跟着内容长高，所以那层**永远没有滚动范围**，而 Chrome 对「没有范围 + contain」的元素**就地吞掉滚轮且不链给父级**——整页滚不动。修法：两面板都不再自开滚动条，滚动归共享端口（转录同款 `scrollportOf`）；上下文面板挂载时把端口回锚到顶部。**A/B 实测**：修复前轮滚 → `scrollTop` 恒 0；修复后 → 300；把旧 CSS 注回面板元素 → 又回 0。卡住的日志列表（文件活动，`max-height: 320px`）也去掉了自写的 `overscroll-behavior-y: contain`，到底后滚轮正常链走（参照实现同样不写）。

### 动效移植 + tooltip 词汇混用修复（第 10 轮：用户点名「页面 ui 没有动画」「悬浮弹窗是黑的看不清文字」）

- **tooltip 词汇混用（真缺陷）**：上下文面板的 `barTip`/`chartTip` 用了**外壳 chrome 的恒暗底**（`--dsw-alias-tooltip-bg`）配**主题跟随的字**——亮色主题下黑底配深字，读不清（用户截图实证）。dsh 的词汇是两套：外壳 chrome 提示恒暗（`ui-primitives` 的 tooltip），**面板内数据气泡跟随主题**（dsh-context `base.css` 的 `.lc-tip`：`bg-layer-2` 底 + `border-l1` 细边 + `label-primary` 字）。已归位后者；真机双主题读数：暗色 bg `rgb(49,54,56)` / 字 `rgb(229,227,223)`，亮色 bg `rgb(255,255,255)` / 字 `rgb(15,17,21)`，两侧 `tip-in 0.15s` 渐入在。
- **上下文面板动效整套移植 dsh-context**（样式逐份对照其 `base.css`）：构成条/趋势柱**入场横扫**（`lc-stacked-in 0.4s` scaleX、`lc-bar-in 0.35s` scaleY，逐列延迟 = `--lc-i` 槽位 × 40ms / 15ms，**封顶 20** 让长日志约一秒落定；槽位计算收在 `context-model.ts` 的 `staggerStyle` 唯一一处，killing test + 变异验证）；悬停联动成对（本段 `brightness(1.18)`、邻段压暗、行底色过渡）；图例改 dsh 的 chip 形（网格 `minmax(160px,1fr)`、选中 600 + 品牌描边环、值右对齐）。全部包 `prefers-reduced-motion` 静默档。CDP 实测逐列延迟与图例网格的 computed 值。
- **全仓动效缺口收口（用户点名「整个 webui 就很缺动画」）**：28 张样式表的可点面（菜单项、设置行、按钮、图标位、宽度把手指示、行 hover）补齐 dsh token 的 hover 过渡（`--ds-transition-duration` + `--ds-ease-in-out`，四属性按需取用）；`MenuSurface` 与 `QueueDock` 补 dockkit 同款浮层入场（`140ms ease-out`，opacity + scale(0.98)）。**刻意偏离（记档）**：dsh 自身的菜单浮层入场是瞬时的（无动画），本仓给它加了渐入——观感更一致，属有意为之而非对齐缺口。全部包 reduced-motion。
- **量测环境的一课**：headless Edge 154 默认开启**网页自动深色**（WebContentsForceDark）——亮色 token 正确解析（`--dsw-alias-bg-base` computed = 白）而渲染层被整体压暗，`getComputedStyle` 读到的 used value 也被改写。此前三轮「亮色仿真失败」全是它；`--disable-features=WebContentsForceDark` 重启后亮色实测一次通过。**量测环境的渲染层篡改会伪装成应用缺陷**，先排除再定罪。

### 流式渲染与滚动跟随（第 11 轮：用户点名「实时流式卡卡的」（内容/思考/动画）「发送新消息不自动滚动，参考 dsh」）

- **delta 按帧合并（真缺陷，卡顿根因）**：一条 provider chunk = 一条 WS 帧 = 一次全表面重渲（App→flowRows→全行重渲→流式行全文重解析 markdown），无任何节流。修法在 socket 入口（`stream-coalesce.ts`）：缓冲 delta、每个绘制帧至多释放一次（rAF；后台标签页零渲染），**相邻同 kind** 才合并（`text_delta` 另要求同 messageId——两段文本绝不能拼成一条；`reasoning_delta` 无 messageId，core 的形状如此，按 kind 断），**非流帧到达前先 flush** 保序。10 条单测钉边界/顺序/幂等。
- **行级 memo 补齐（对齐 dsh 的 memo 密度）**：dsh `ui-chat` 的每个 node view 都是 `memo`（`ChatNodeSeat`/`AssistantNodeView`/`AssistantMarkdown`/`ChatNodeList`…），本仓移植时漏了大半——ReasoningRow / TurnHeader / UserMessageRow / MessageIconActions / TurnUsagePill / ContextInjectionRow / JobRow / CommandRow / SubagentRow / ChatHintRow 全部补上；`TurnHeader` 的回调从内联闭包改为传 `turnKey` 的稳定引用（内联闭包会让 memo 永远失效）。`App` 的 `flowRows`/`runningStatus` 提 `useMemo`。一次 delta 只重渲它自己那一行。
- **发送不自动滚动（真缺陷）**：判据写成「**尾行**是新 user 行」，而 `flowRows` 在 user 行后必然推 turn header——尾行永远是 process，判据**从未成立过**。对齐 dsh `use-chat-scroll.ts` 的 `ownInput` 规则：追踪**最后一条 user 行的 key**（`scroll-follow.ts` 的 `lastUserKey`，扫描而非看尾行），到达即 `toBottom`，**压倒读者的阅读位**（`reading.pending && !ownInput` 才不动——读者的滚动不能拦下自己的发送）；翻页 prepend 不改变 key，故不误触。4 条纯函数断言。
- **未移植（明记）**：dsh 的 MarkdownText 流式臂把**已定型的块冻结为缓存元素、只重解析尾段**；本仓仍是「按文本 memo + 整段重解析」，靠帧率合并把频率压下来。若将来出现超长单条消息（>50KB）仍卡，这条是下一个优化点。

### 视觉细节对齐（第 12 轮：用户点名「对照 dsh 桌面端仍有廉价感」）

方法：把我们的每张 sheet 与 vendored dsh master 的对应件**机械化对照**（按选择器抽取 radius/背景/描边/投影声明逐条比）。结论先行：**绝大多数表面是逐字一致的**（composer 胶囊、统计条、DisclosureRow、ReasoningRow/ContextInjectionRow/TodoPanel/TurnProcessNodeView/ApprovalPanel、MessageItem 气泡、ChatView、newSession 按钮、会话行、CodeBlock、MenuSurface 材质、AppFrame、scrollbar），偏差集中在下面这些点。

- **目标条（结构级偏差，前提过期）**：目标此前是自造的两层卡，其样式表头注释写着「dsh 没有目标面板（其目标 UI 是 composer bar），所以这张卡是我们自己的」——dsh **有** `ui-goal/GoalBar`，注释的前提是错的。已整体移植为 **36px 单行条**：目标字形 + 阶段词（进行中的目标/已暂停的目标/受阻的目标，`phase.*` 文案）+ 截断的目标文本 + 悬停动作（暂停/恢复/编辑/清除，`action.*` 文案与 Tooltip 一并照搬）；材质是队列面板同款 `::before` 菜单层（menu 填充 + `backdrop-filter`），inline 编辑表单拆在 `GoalEditRow.tsx`。**两条记档偏离**：动作发送与输入框**同一条 `/goal` 命令帧**（参照直呼宿主动词，本仓只有命令缝）；失败原因落在转录的命令行而非条内错误行（答案的单一所有者）。
- **队列面板材质（真偏差）**：`--dsw-specific-tip`（不透明中性色）→ 菜单材质（`--dsw-specific-menu` + `backdrop-filter: var(--dsw-menu-backdrop-filter)` + `isolation: isolate`）；参照的 `.panel::before` 层一并照搬，否则面板是块没有景深的灰板。
- **手工圆角值（一类，全仓清扫）**：`ioCard` 12px→`--dsw-radius-lg`；工具卡/详情板内滚条 6px→`--dsw-radius-sm`；详情板 `.pre` 12px→`--dsw-radius-lg`；轨迹行 8px→`--dsw-radius-md`、动作钮→`--dsw-radius-sm`；任务行停止钮 10px→`--dsw-radius-sm`。
- **未配对的「圆形」半径（corner-shape 陷阱）**：面板展开钮与详情板图标钮写 `28px`（28px 盒子上=正圆），但在全局 `corner-shape: superellipse(1.5)` 下**会被画成方块圆角**——参照的图标钮一律 `999px + corner-shape: round`，已照改；hero 版本徽章 `24px`→`999px + corner-shape: round`，字色改 `--dsw-alias-label-primary-bluish`（参照值）。
- **上下文环弹窗**补 `min(264px, calc(100vw - 24px))`（参照的钳制）。
- **未跟（明记）**：`context/ContextView.module.css` 的字面量半径保留——那一组对齐的是第三方 dsh-context 插件（Tailwind：`rounded-lg`/`rounded-md`），不是 master 的桌面端 sheet；截图里 dsh 桌面端工具/步骤行的灰底未能在此版 master 中找到对应规则（master 为透明底），**以 vendored master 为准**，不按截图猜。

### 上下文趋势图（第 13 轮：用户三次点名——「高度不应该动态变化吗」→「明细臃肿/右半留白/自适应冗余」→「效果太差太丑，去对齐 dsh 插件」）

终态 = **全面对齐 dsh 插件**（`components/trendChart.tsx` + `styles/trendChart.css` + `components/requestDetail.tsx`）。中途按操作者意见做过的三条自创规则（柱子 `space-between` 铺满、明细悬停才现、自适应开关删除）实测更差，已全部回退并记档于此，**勿再改回**。

- **轴 = 数据峰值**（参照 `maxTotal`），不是模型窗口：1,050,000 的窗口曾把约 22K 的会话压成 2%（用户第一张截图的贴地线）。窗口只写在卡头。killing test：SSR 直测钉「轴标 4K 而非传入窗口 10K」，把 scale 改回窗口即红。
- **柱子固定 14px / 2px 节奏 / 左堆叠**（参照 `.lc-bar` + `.chart`，无 `justify-content`）：密了横向滚动，稀疏时右侧留白——这是参照件本身的行为。真机量测：首列 x=2、列距 16、相邻间隙恒 2px。
- **气泡 = 参照的 `syncTip` 解析定位**：柱心由索引解析（`PLOT_PAD + i*16 + 7`），`left: 0` + transform 在每次提交与滚动时重写，随滚动黏住柱子。曾用 `getBoundingClientRect` 相对宿主算 x（用户截图：气泡脱在左上角）。真机量测：气泡中心与柱心偏差 **0px**。
- **明细 = 参照的分类行**（8px 色点 + 标签 + 5px 轨道条 + `≈N` + 占比，两列自适应网格）。**身份行按操作者裁定删除**：`第 N 次请求 / 输入 / 输出 / 缓存命中`（参照在明细头部常驻这些药丸）与悬浮气泡、转录用量药丸重复，卡里不再出现——**本仓记名偏离**。行跟随「悬停 → 钉住 → 最新一条」（参照 `activeIdx` 的回落），所以卡片高度不随指针变化。
- **自适应开关 = 参照的 `.lc-gran` chip**（默认关）：开启后轴按可视柱峰值重算并随滚动（`trend-visible` 纯函数 `visibleMax` + `use-visible-max.ts` 绑定）。中途曾按「冗余」意见删除，随「全面对齐」恢复。
- **字号收进面板基级**：明细行曾未声明 font-size、继承浏览器默认 16px（用户点名「比其他 UI 大一圈」）。面板根补 `.root { font-size: 13px }`（参照 `.lc-root` 的基级）。真机量测：明细行/图例行/尾注 13px、卡题 14px、轴刻度 11px。
- **参照未跟（数据面不在本仓，明记）**：轮次条与步/轮粒度（会话日志无 turn/step 坐标）、步旗与 ✂ 事件标记（无 per-request 事件）、总量/变化模式、明细里的第二条 stacked bar（卡头「当前上下文」已有构成条，不重复）。**DNA 模式已落地**（2026-10-01，第 15 轮——见上）；同轮的上下文浏览器后按操作者裁定删除（第 17 轮）。几何取值逐项对回参照：130px 画布 + 18px 头、40px 轴栏、14px 柱宽、2px 节奏与内边距、5 档刻度（1/¾/½/¼/0）。

### 上下文「Token 统计」环 + 插件中心搬回侧边栏顶层（第 21 轮，2026-10-06：操作者两次点名——「差距太大了…对齐 dsh」→「不是插件中心的位置就不对，你应该对齐 dsh」）

两条报障的**性质不同**，处置也不同：上下文面板是**缺一块**（补），插件中心是**放错地方**（搬）。第二轮点名纠正的正是我第一轮的理解偏差——我把「插件中心没做好」读成了行内细节，操作者说的是**位置**：dsh 的插件中心是侧边栏的一个顶层页、占主栏，而本仓把它埋在「设置」弹窗里当第三节。**参照实现是权威，单点意见不是**（同一教训见 `ui-align-to-reference-first`）。

**① 上下文面板补「Token 统计」环（对齐第三方 dsh-context）**

- **几何逐值移植** `dsh-context` 的 `components/donut.tsx`：`viewBox 0 0 42 42`、`r = 15.9155`（周长恰 100，故 dasharray 单位 = 1%）、`stroke-width 4`、`offset = 100 − consumed + 25`（+25 把起点转到 12 点）、段间 `SEG_GAP = 0.5` **两端各切一半**（短段按 `len/4` 钳制，否则细段会被切成负长）、入场是**只写 `from` 的关键帧**（`from { stroke-dasharray: 0 100 }`，终态即属性值）。纯几何收在 `context/donut-model.ts`（`donutArcs`），环组件 `context/Donut.tsx` 只画不算。
- **口径 = 计费口径**：环中心的总量取 `SessionTotals` 的 `promptTokens + completionTokens`——**与 composer 用量药丸同一个对象**（`state.totals`），所以两处数字不可能打架；类别的 token 数按 `live.cats` 的比例**分摊**并按 dsh 的写法标 `≈`（分摊是估算，不是读数），占比是真读数。没计费（无 `run/stats`）时环心画 `—` 而不是画 0。
- **头部改双列**：`ContextView` 的统计条与新的 `TokenStatsCard` 进同一个 `headRow`（`auto-fit minmax(min(360px,100%),1fr)`），窄窗自动落成上下两行。
- **记名偏离**：① dsh 的输出段用**粉色**，本仓 token 层没有粉色 ramp（只有 indigo/amber/purple/green/blue/teal/red/deepseek + 中性），取 `--dsw-static-red-500`——**色号不同，语义位次相同**；② dsh 在输出旁注「含思考」，**本仓内核不单列推理 token**，写了就是编造，故不写（同「不装成已对齐」纪律）。

**② 插件中心从「设置弹窗第三节」搬到「侧边栏顶层页」（对齐 dsh `ui-plugin-manager`）**

- **依据**：dsh 的 `ui-plugin-manager/src/client/index.ts` 声明 `PANEL_ID = 'plugins'` 并注册进 `sidebar.panellist`——**页占主栏、侧边栏不消失**。本仓原来只有「设置」弹窗一条路（弹窗会盖住侧边栏），两次点击才到，位置与参照相反。
- **实现**：侧边栏在「新会话」下方加一枚顶层入口 `sidebar/PluginsEntryButton.tsx`（36px 行 / 收起态 36×36 轨道钮；`aria-current="page"` 只在打开时给；标签走 `SIDEBAR_COPY['plugins.entry']`），主栏由 `settings/PluginCenterPage.tsx` 承接——**它渲染的还是同一个 `PluginsSection`**（一个实现一个门，不复制行渲染），`App` 只持 `pluginsOpen` 一个布尔。**任何「离开插件中心」的手势都要先关它**：`new_session` 与 `resume` 两条路径都在 `Sidebar` 的包装里先调 `onLeavePlugins()`——否则点会话行会因 `file === currentFile` 的早退而**看起来毫无反应**（页面没变、会话也没变）。
- **删掉设置里的 `plugins` section** 及 `App` 对 `PluginsSection` 的导入；设置弹窗注释同步改写（`插件管理 is NOT one of them`）。
- **行形态对齐**（第一轮做的，保留）：40px 图标座 + **内联描述**——描述从展开区移到收起行（展开区只剩 加载失败 / 依赖 / 不可关闭）。**顺带删掉 `PluginsSection` 的 `onClose` prop**：App 不再传它之后，它就是**声明了却永远没人传**的死参数（本仓第一缺陷族「声明与实现相反」），删掉比留着好。
- **记名偏离**：dsh 每个插件有自己的图标，本仓插件清单没有 artwork，统一用 `PluginIcon` 图标座。

**证据**：`web/ui` 车道 **96 文件 / 1041 测试**全绿；本轮新增 `token-stats.test.tsx`（8 条：弧长/缝隙/零值、计费锚点、`≈` 标记、无计费时回落最新点、无计费时画 `—`）与 `plugin-center.test.tsx`（4 条：页画出行与描述、加载态、`aria-current` 只在活动时给、收起态丢标签但保留 `aria-label`）；两条**变异验证**（把环心总量改回「分类求和」、把行内描述改成只在展开时渲染 → 各自立刻变红）。`pnpm gates` 走**路径限定**的 `gates:update`（只命名本轮 8 个文件；同期另一会话有 5 个文件超限，**刻意不碰**）。前端产物已 `pnpm --filter nova-web-ui build` 重建。

> **Windows 大小写不敏感的一课**：纯模型文件最初叫 `context/donut.ts`，与组件 `Donut.tsx` 只差大小写——Windows 上 `import './Donut.js'` 解析到了**纯模型文件**，报错是 `Element type is invalid … got: undefined`（一个和 import 毫无关系的运行时错误）。已改名 `donut-model.ts`。**同一目录里两个文件只差大小写，在 Windows 上就是同一个文件。**

## 差异清单（既有条目）
- **`ui-user-questions` 的草稿查表崩溃（真 bug，`?? fallback` 缺陷类的第 10 处）**：`decisions.ts` 的四处 `drafts[question.id] ?? EMPTY_DRAFT` 都**挡不住原型链**——问题 id 是**模型给的**（`parseQuestions` 只限长度、不排除 `constructor`），而草稿表是对象字面量，于是 `drafts['constructor']` 取到继承来的 `Object` 函数、`??` 回退**永远不触发**，`isComplete` 拿函数去读 `.length` 抛 `TypeError`，**整张问题卡崩掉**。实测四个函数（`allComplete` / `firstIncomplete` / `buildAnswer` / `isComplete`）全部抛错。修法：`decisions.ts` 新增**唯一**的安全查表 `draftOf(drafts, id)`（`Object.hasOwn`），四处调用点全部改走它；`QuestionPanel.tsx` 的同名写法也一并收口。回归测试用五个继承成员名（`constructor`/`toString`/`valueOf`/`__proto__`/`hasOwnProperty`）钉住，并做变异验证（恢复 `??` 写法后 2 条测试立刻变红）。
- **`ui-user-questions` 的 Skip 死路（真 bug）**：`Skip` 只移动分页游标、**不记录跳过**，于是 (a) 单题批次的 Skip 是**彻底的空操作**，(b) 多题批次跳过的题永远 `isAnswered === false`，`allAnswered` 恒假，**提交按钮永久禁用**——用户走进死胡同。参照实现用 `completed = answered || skipped` 收口，Nova 缺的就是 `skipped` 这一位。已按 `isComplete` / `allComplete` / `firstIncomplete` / `skipQuestion` 收口，并把「提交被拒时跳到卡住的那一题」也补上。
- **`ui-user-questions` 的 detail 渲染**：Nova 用 `<pre>`，dsh 用 markdown（`MarkdownText`）——计划正文里的标题与列表会**按源码字面显示**。已改走 `MarkdownText`（`variant="compact"`），并同步修正 `.detail` 的等宽字体与 `white-space: pre-wrap`（对文档是错的）。
- **`ui-user-questions` 的选项语义**：单选项列表缺 `role="radiogroup"`/`role="radio"`（屏幕阅读器只念「按钮」，**不念这是单选还是多选、第几个**）。已补 `role` / `aria-checked`；同时补上参照实现的两条交互：**单选即自动前进**（选完不必再按「下一题」）、**单选的自由文本会替换已选选项**（否则同一题会同时带着选项与「其他」两个矛盾答案上路）。
- **`ui-user-questions` 的卡片头部（用户反馈「UI 效果简陋」后对齐）**：提问卡此前**借用了审批卡的彩色顶部条**（`等待确认` + dot + 序号 badge），而 dsh 的 `QuestionComposer` 是**干净的 header**——问题文本本身是卡片标题（16px/500 的 `h2`，可选 `header` 作为 eyebrow），右上角是折叠 / 放弃两个 24px 图标按钮，**没有彩色条**。已按 dsh 逐行对齐：`QstionPanel.header` 承载标题与折叠/关闭，`strip` 移除；选项前加**序号（单选）/ 勾选框（多选）**指示器（20×20）、选项选中态改为轻浮层背景 + 细边；自定义答案改为**选项形状的一行**（`customRow`，带指示器；无选项时才是独立 `customBlock`）；底部翻页器（`‹ n / m ›`）独立成 `pager`，进度不再挤在 badge 里。**有意保留**：审批卡的彩色条**不能再共用**——dsh 的审批卡本身就是 warn strip（`ApprovalPanel.tsx` 的 `StateDot + waiting`），所以审批卡是对的、别把它当「简陋」改回去。

## TUI 移植（终端面，`dsh-TUI-main` 参照）

> **状态（2026-09-30）：TUI 已再次整体删除**——`packages/tui` / `packages/tui-app` 不复存在。本节保留为历史记录（当初的移植判定与未对齐清单），**勿据此恢复**。真机验收无法自动化（下文第 3 条）始终未解，是本次删除的直接原因之一；浏览器界面已是富界面，终端保留 readline REPL。若未来重做终端全屏界面，作为第三方 surface 插件另立包（`surfaces` 配置行即可加载）。

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

## 工作步骤展示（转录过程折叠，`ui-chat` 参照，2026-10-01）

参照件：dsh `ui-chat` 的 `chat-settings.ts`（`TRANSCRIPT_VIEW_MODES`）、`presentation-policy.ts`（`ChatPresentationPolicy` 与四档表）、`ChatGroupSeat.tsx`（组框与闭标题）、`process-activity.ts`（分类/排名/live 细节）、`step-process.ts`（闭标题组词）、`TranscriptViewRow.tsx` + `PreferenceRow.tsx`（设置行）。**只读**。

### 已对齐

- **四档模式与 policy 表逐字段一致**：`compact`/`standard`/`detailed`/`verbose` → `{foldCompletedTurns, stepGrouping, liveProcessDetail, settledReasoningPreview}`，默认 `standard`（`web/ui/src/chat/transcript-view.ts` 是唯一定义处；`flow.tsx` 只读 policy，不自己判断档位）。
- **组框语义**：`stepGrouping: 'collapsed'` 每个回合都带可折叠组框（**运行中也设上限**，与参照 `ChatGroupSeat` 一致）；`'history'` 只有已完成的回合带（运行中的平铺）；`'none'` 从不成组。组框默认**闭合**（参照 `useDisclosure` 默认关），闭标题即概况。
- **闭标题组词**：类别计数降序（同数按首次出现）取前三；一个直呼、两个「并」、三个及以上逗号、**超过三个类别才补「等」**；**只有两个标签都以「已」开头才削第二个的「已」**（参照 `sharedPrefix` 的两侧判定，此前实现只判第二个，已按参照修正）；空活动读「已完成分析」。
- **live 标题**：`RUNNING_LABEL` + `liveProcessDetail` 门控的任务细节（`DETAIL_KEYS` 优先级、160 码点截断、畸形参数回落工具名）；无在途调用时回落思考的**最后一段已完成段落**（去 `**`），此时类别留空、渲染读作「正在分析请求」（参照 `?? 'thinking'`）。
- **上限与遮罩**：`min(400px, 50vh)` + 组内自滚 + 两端 24px 渐变（`use-capped-edges.ts` 的滚动/内容增长双信号），「被裁掉」与「到头了」可区分。
- **设置行**：标题「工作步骤展示」+ 描述「选择希望看到多少工具调用细节」，四项文案与参照的 `transcript.*` 同义。

### 记名偏离（不装成已对齐）

1. **组头不带每类活动图标**：参照 `ChatGroupSeat` 的 `.leading` 按活动类别给图标，本仓组头只有 chevron + 标题（`ProcessGroupHead.tsx` 头注释记档）。若后续对齐，落点是 `ProcessGroupHead` 的 leading 位。
2. **无 shimmer 最短展示时长守卫**：参照对 `TextShimmer` 有最短展示时长以免闪烁；本仓直接复用现有 shimmer 组件，不另加计时。
3. **偏好落 localStorage**（`nova.transcriptView`）而非宿主设置文档：四档是纯前端呈现偏好，与 `nova.theme` / 列表视图偏好同档——**宿主确实有 per-plugin 设置通道**（`manifest.page` + `PluginPageDescriptor` + `plugin_request` / `plugin_response`，见 AGENTS.md §5 插件设置页），但那条通道属于**插件自己的设置**；界面观感偏好不是任何插件的设置，所以仍留在浏览器侧。
4. **live 细节的来源不同**：参照从自己的 step 事件流取「当前调用」，本仓从 flow 块投影（`chat/process-span.ts`）——**工具块结果未落地即在途**，因为 nova reducer 的工具块没有 `running` 标志。语义等价，取值路径不同。

## 真实侧边栏（better-sidebar 融入主程序，2026-10-01；2026-10-02 整体重写）

参照件：`DSH-better-sidebar-main` 与 deepseek-harness `ui-sidebar-right`（changes-review / files / terminal 三个页面）。**只读**。本轨不作为插件，**直接并入主程序**——此前 nova 的右栏只有「变更 / 文件 / 终端」三页且文件页不能编辑/不能新建/不能改 git，距离 dsh 的真实侧边栏差一整圈。

**2026-10-02 整体重写（第 18 轮）**：操作者报障五条——「工作区改动 正在读取 git 状态…性能不佳」「视觉效果不好，没有对齐 dsh」「文件页面我已经在当前会话工作区了为什么还有在选择一遍选择工作区文件夹」「文件预览是在工作区文件目录点击文件后开启而不是直接和文件目录并排显示」「终端和任务面板的 ui 设计全是一坨」。裁定是**重写而不是打补丁**（前后端都是），旧实现整体删除（`FilesWindow` / `FilesPanel` / `TreePanel` / `TreeMenu` / `ChangesPanel` / `GitLens` / `EditorPanel` / `TerminalPanel` / `TasksPanel` / `terminal-model` / `tree-menu-model` / `tree-rows` / `session-files` / `web/src/terminal-frames.ts`）。两条报障的根因都是**归约纪律**问题，各配 killing test：①选择器每次开面板都弹，是因为文件页自己问的 `list_directory` 答案被工作区选择器当成了自己的答案——现在 `directory` 槽位只在手势（`directory_open`）之后存在；②预览点开没反应，是因为 `editor_open` 动作**全仓没有派发者**——现在「打开」由请求出发处拥有（`read_entry` 一发出，`sent` 归约就把文档放进编辑器）。git 卡顿的根因是每次开页冷启一次 `git status`，现在走 `GitStatusCache`（TTL 2s + 单飞去重 + 写动作 `invalidate`）。终端从「一次性 `run_terminal`」换成**持久 shell**（`cd` 保留、游标式输出流、退出后可被下一条命令替换）。

**第 18 轮追加（2026-10-02，操作者再报两条）**：「经常报错宿主提示：unknown frame type: git_status / shell_read」「如果工作区没有git就显示类似图中vscode的功能啊（附 VSCode 源代码管理空态截图）」。①`unknown frame type` 的根因是**界面比正在运行的 nova 进程新**（server.ts 每请求重读静态产物，旧进程照常服务新 bundle，旧进程内存里的帧校验器不认识新帧名）——宿主提示经 `host-messages.ts` 的 `hostErrorText` 转写成「请停止当前 nova 进程并重新启动」，killing test 钉住「裸帧名不再直出、其余错误保持原话」。②无 git 空态对齐 VSCode 的源代码管理卡：`GitSetup.tsx`（源代码管理 + 说明 + 打开文件夹 / 克隆仓库两钮），打开文件夹复用 hero 的原生对话框选择器；克隆仓库展开 URL 表单发**新客户端帧 `git_clone`**（上限 `MAX_GIT_CLONE_URL_CHARS = 2048`）。**`git_clone` 走 session-target 族而不是 git-frames**：它改变「打开的是什么」，答复是重述的 `ready`（克隆进当前工作区的父目录成兄弟目录 → `setWorkspace` → 广播基线，面板落在新仓库上不需第二次手势）；core 侧克隆独立成 `git-clone.ts`（`gitClone` / `repoNameOf`——「弄来一个仓库」与「操作一个仓库」分居，argv-only + `--` 分隔 + `isSafeDirectoryName` 目录名门 + 10 分钟墙钟）。

**第 18 轮追加二（2026-10-02，操作者贴 dsh 编辑器截图对比变更页点文件效果：「这也达不到预期效果啊」）**：对照参照 `dsh-better-sidebar` 的 `changes/DiffPane.tsx` 与 `diff/highlight.ts`（只读）逐条对齐三件事——①**未跟踪文件按「全部新增」渲染**（参照的 untracked full-addition fallback）：`git diff` 对未跟踪路径什么都不打，宿主的 `git_diff` 现在换成 core `gitUntrackedDiff` 的合成 hunk（`@@ -0,0 +1,N @@` + 全 `+` 行；有界读 1 MiB、二进制/超限答空文本，面板仅在那时才显示「用文件页打开」的说明——不再把内容一推了之）；②**diff 行语法高亮**：`rightbar/diff-highlight.ts`（纯函数）复用聊天代码块的零依赖扫描器 `chat/markdown/highlight.ts`——整文件内容**一次扫描**再按行 zip 回 diff 行（块注释跨行状态不断，逐行扫描会丢），未知语言与结构性行（hunk/表头/折叠标记）照旧纯文本；③**行悬停「打开编辑器」动词**（参照右键菜单的 openEditor 提到悬停位）：发 `read_entry` + 切到文件页编辑器，打开仍由请求出发处拥有。**编辑器本身保持记名偏离**：参照是 CodeMirror 6，本仓不引编辑器依赖（纯 textarea、无高亮编辑），这是有意的边界而不是待办。

**第 19 轮（2026-10-02，操作者三条报障 + 三张 dsh 截图）**：①文件页「会出现这里被遮挡，左边这一大块白色空着，整体设计就不合理浪费」——悬停动词压住文件名，且无文档时仍画一个空编辑器；②任务页「任务板块 ui 简陋落后」；③终端「你看看这是人话吗，我要的是真实的命令执行环境，不是让你给我造个假的」——第 18 轮的管道 + 哨兵标记被判定不可接受，**换真 PTY**（`node-pty` + xterm.js，本仓第一次引入第三方运行时依赖，服务端仍按缺席降级）；④随后贴 dsh 右栏三张截图：「我希望侧边栏做成 dsh 一样的开屏页面和标签页视觉 ui 效果」——按参照的 tab bar 与 `GuideBody` 逐值重画（见下「标签条 + 开始页」）。四条的根因分类：①②是纯观感（照抄参照取值），③是能力造假（协议与实现一起换），④是**结构早已对齐、差在视觉细节**——本仓的 strip 早就是「已开页 + `+` 菜单 + 空标签回落开始页」，这轮补的是几何与墨色，不是新形状。

**第 20 轮（2026-10-03，右栏对齐 dsh 第二轮——照 `ui-dockkit` / `ui-jobs` / `ui-deliverables` / `ui-sidebar-terminal` 逐值移植）**：①**工具详情列整体删除**（操作者拍板：工具行的行内展开是唯一读法）——右栏居住者只剩 `RightbarPanel` 一个，`ToolPanel` / `chrome-view` 的 `detail` 派生 / `ToolRow` 的 `InspectPill` 全链删除；②**strip 逐值收紧**：34px → **28px 芯片行**（芯片 `min 80 / max 170 / 13px`、关闭钮 20px 圆钮仅活动/悬停可见）；③**文件页 → 纯树页 + 只读文件标签页**（`FileTabView`：高亮 + 行号 + 换行 + 复制 + 重新读取；点同一文件是幂等 reveal）；④**终端对齐参照**（开始页终端卡的 shell 下拉、页脚状态条、xterm 逐值配置、win32 shell 探测补 MSI 标准安装位）；⑤**任务页对齐 `ui-jobs`**（StateDot 行 / `detail ?? 状态词` / 两段式停止 / `finishedAt` 倒序 / 元数据面板）；⑥**变更页 diff 对齐 `ReviewTab`/`FileDiff`**（38px 工具行、统一/并排、换行开关、22px 行高与 gutter 色标、`MAX_RENDERED_LINES = 5000`）。**六条全部真机复测**（2026-10-03：strip 芯片 28px / 总高 38px ✓、首开 guide ✓、任务 live 行 → armed → 结算行（warning 点 + 「已取消」+ 时长冻结）✓、diff 统一/并排/换行三态与 localStorage 偏好 ✓、文件 tab 幂等 ✓）；其中一条修复有 before/after 成对真机读数：被杀任务的结算行从 **`exit code: null`**（bash 生产者把刻意置空的退出码写进 detail）改为回落**本地化的状态词「已取消」**（生产者不再为 killed 写 detail，killing test 钉住）。

### 已对齐

- **标签条 + 开始页（第 19 轮，2026-10-02）**：`rightbar/tabs.ts` 定义**可开的四页**（变更 / 文件 / 任务 / 终端，顺序与 dsh `guide` 一致），`RightbarStrip.tsx` 画**已开的页**——一页一枚标签（图标 + 标题 + ×），几何照抄参照 `dsh-better-sidebar` 的 tab bar：**28px 芯片行**（第 20 轮按 `dockkit.module.css` 收紧，34px → 28px；芯片 `min 80 / max 170`、`padding 0 10px`、13px、`--dsw-radius-sm`，关闭钮 20px 圆钮仅活动/悬停可见）、标签上限 160px 走省略号、右邻 hairline、活动标签用 `--dsw-alias-interactive-bg-active` **填充**而不是下划线、`+` 菜单 sticky 在滚动口右缘（只列未打开的页）。**标签条就是面板的上边缘**，不再另画标题行。标签全关时正文是 `StartView.tsx`：56px 罗盘水印（`--dsw-static-neutral-200` / 暗档 `-700`，纯灰阶——label 别名都带蓝调，在这个尺寸上会显出来）+ 四张 380px 入口胶囊（26px 图标盒 / 14px 标题 / 11px 说明 / `--dsw-radius-xl` / 0.5px `border-l3`），逐条照抄参照 `ui-sidebar-right/tabs/guide/GuideBody.module.css`，含 `.guide::after { flex: 0 1 10% }` 的「上移 5%」。**状态面**：`App.tsx` 持 `rightbarTabs`（已开集合）+ `rightbarTab`（在前的一枚，`null` = 开始页），`openRightbarTab` 一个入口保证「已开则置前、未开则加入并记住」。**编辑器页并入文件页（第 19 轮），第 20 轮再定形为「纯树页 + 只读文件 tab」**：点树里的文件开一枚**以路径为身份的只读标签页**（`FileTabView`——语法高亮（复用聊天扫描器）+ 行号 + 换行开关 + 复制 + 重新读取；`.md` 走聊天同一条元素树 markdown 渲染器；超 `MAX_EDITOR_BYTES` 截断说明），重复点同一文件是**幂等 reveal**（已开即置前，不重发 `read_entry`）；**编辑能力整体删除**——textarea / Ctrl+S / dirty 概念连同 `write_entry` 帧与 `entry_saved` 一起删（树操作 `rename` / `remove` / `new` 保留），树不再有页内停靠/拖宽。「找文件」与「读文件」不再分居两个页签、每开一个文件都付一次切换。
- **文件页不遮挡、不空转（第 19 轮）**：树行的悬停动词不再压住文件名——`TreeDock` 的动词轨 `display:none`，hover / focus-within / 菜单展开才显现并 `margin-left:auto` 顶到右端（参照 `.explorerRef` 的同一条规则）；**没有文档打开时树占满整页**（`data-tree-full`），`PreviewPane` 无文档返回 `null`，不再画一个空编辑器占住左半页。
- **任务页（第 20 轮定形，对齐参照 `ui-jobs`）**：第 19 轮的「两行卡片」由逐值对齐取代——行 = **StateDot**（唯一实现 `tool/StateDot.tsx`，本页曾自带第二份已删）+ kind + 标签 + `detail ?? 状态词` + 时长（最多两级单位），live 行按开始正序、是填充卡片且带**两段式停止**（arm 3s 自动解除，`data-kill-state`，pending 期按键惰性），结算行按 `finishedAt` 倒序（core `JobSnapshot.finishedAt` 为此新增、wire 透传）、时长冻结；chevron 展开元数据面板（进度 / 开始 / 结束 / 任务 ID）。**被杀的任务不写 detail**：退出码被刻意置空，写出来只会是「exit code: null」——行回落本地化的状态词（真机 before/after：`exit code: null` → 「已取消」）。空态仍是一张居中的说明卡（`data-tasks-empty`）。
- **内核侧**：core 新增 `file-io.ts`（绝对路径规范化、realpath 规范化后的越界检查、原子写 tmp+rename、符号链接跟穿拦截）与 `git.ts`（仓库探测 / porcelain -z 含 R/C 重命名 / 分支探测 / stage / unstage / commit / log）。`plugins/src/builtin/fs.ts` 改为从 core 引入这些原语（消除两份实现）。
- **wire 协议**：客户端帧 12 条（第 19 轮新增，第 20 轮随文件页只读化**删除 `write_entry`**：`read_entry` / `rename_entry` / `remove_entry` / `new_entry` / `open_entry` / `git_status` / `git_diff` / `git_stage` / `git_unstage` / `git_commit` / `git_log` / `list_jobs`），终端 4 条（`term_open` / `term_input` / `term_resize` / `term_kill`，第 19 轮随真 PTY 重做替换了此前的 `shell_run` / `shell_read` / `shell_stop`）。第 18 轮追加 `git_clone`（无 git 空态卡的克隆入口）。新增 wire 上限：`MAX_EDITOR_BYTES = 192 KiB`（**线上预算**而非磁盘上限——大文件用本地编辑器编辑）、`MAX_GIT_PATHS = 200`、`MAX_COMMIT_MESSAGE_CHARS = 2000`、`MAX_GIT_LOG = 100`、`MAX_GIT_CLONE_URL_CHARS = 2048`、`MAX_TERM_INPUT_CHARS = 16384`、`MAX_TERM_COLS = 500`、`MAX_TERM_ROWS = 500`。
- **服务端**：`entry-frames.ts` / `git-frames.ts` / `job-frames.ts` / `term-frames.ts` 各自收一类帧；任何写动作都用一条新的 `git_status`（或 `entry_changed`）作答——**答复即状态**（不存在 `notice` 帧）。删除/重命名会把打开在编辑器里的同路径文档一起关掉；目录被改后工作区树按「该层需要重读」标记（`treeAsk`），下次 effect 自动补问。`list_jobs` 直接读内核 `host.jobs.list(sessionId)`，行里只带状态/进度——输出是模型的 `jobs` 工具的消费游标，第二个消费者会和它竞争。`git_status` 的读取走 `GitStatusCache`（TTL 2000ms、并发单飞、写后失效），因为 git 是子进程、每次开页都冷启一次正是「正在读取 git 状态…」的来源。`git_clone` 不在 `git-frames.ts`：它改变「打开的是什么」，与 `set_workspace` / `delete_session` 同族走 `session-frames.ts`，答复即新基线。
- **终端是真 PTY（第 19 轮，2026-10-02 替换此前的管道模拟）**：`term-session.ts` 经 `node-pty`（**惰性 import**——原生插件缺席时 `term-frames.ts` 答 `unavailable` 而不崩服务器）spawn `sessionEnv().shell` 的**交互 shell**，与模型命令共用同一份 shell 解析（`resolveShellName`），Windows 上带 `.exe`（ConPTY 不解析裸名）。stdin 是真键盘、stdout 是真 ANSI 字节流，**vim / top / Ctrl-C 全部真实工作**；`cd` 与后台 job 因进程常驻而保留。**宿主不解析终端序列**：输出按 chunk 原样广播（`term` 帧的 `data`），只在字节间拆散了 UTF-8 代理对时由 `holdSplitSurrogate` 收尾；256 KiB ring 保留 scrollback，`term_open` 以应答重放（`reset:true`）让重挂/重载整屏重建。**退出的 pty 绝不静默替换**——那份 scrollback 是「为什么死」的最后读数，重启是显式的 `term_kill` + `term_open`。
- **前端**：`rightbar/kit.tsx` 原语（28px IconButton / 22px chip / 28px 段头 / 文本 Notice；StateDot 的唯一实现在 `tool/StateDot.tsx`）之上，一页一文件：`FilesView`（**纯树页**：过滤框 + 刷新 + 树工具；行悬停给 `@` 引用 / 复制路径，新建/重命名走内联输入、删除走 `window.confirm`；树不再拖宽/停靠）、`FileTabView`（只读查看器，见上）、`ChangesView`（未暂存/已暂存双树 + diff 面板 + 提交条 + 最近提交 + 「本会话」透镜；无 git 工作区时是 `GitSetup` 的源代码管理空态卡——VSCode 同款两钮，克隆的进行中态挂 `clonePending`；**diff 工具行第 20 轮对齐参照 `ReviewTab`/`FileDiff`**：38px 头带 = 文件选择菜单 + `+N −N` 计数 + 统一/并排切换（`[aria-pressed]`）+ 换行切换 + 打开文件标签页，22px 行高、统一视图 grid `3.5em 3.5em 1.2em 1fr`、gutter 填充 + `inset 3px` 色标（文字保持阅读墨色）、并排是 `splitRows` 纯函数（删除段配对随后新增段、短边留空）、偏好落 localStorage（`nova.diff.layout.v1` / `nova.diff.wrap.v1`）、行帽 `MAX_RENDERED_LINES = 5000`）、`TasksView`（见上「任务页」）、`TerminalView`（xterm.js 屏 + 状态条 + kill-then-open；**第 20 轮补**：开始页终端卡的 shell 下拉（打开菜单才发 `discover_shells`，选中=记偏好+重开）、页脚状态相（连接中/运行中/已退出(码)/失败/不可用 + 重开/重试主按钮，去掉 `<select>`）、xterm 逐值（`minimumContrastRatio 4.5` / `cursorBlink` / `fontSize 13` / 同款字体栈 / 调色板随主题 computed style 同步）；`@xterm/xterm` + addon-fit 走**动态 import** 进懒加载 chunk，SSR 测试车道零 DOM 不受累。纯折模型 `terminal-model.ts` 只管 bytes 进 `feed` 槽按 `seq` 递增与 status/exitCode/error 三读数，**不再渲染文本**——模拟器才是屏）。
- **右栏是真三分，不是悬浮层（2026-10-01 修正，操作者报告「为什么悬浮在主页面之上」）**：参照件 `ui-layout` 的规则是 `track = shown && !autoFullscreen`——正常打开的右栏**必占自己的网格轨道**，中间列让位。nova 从 WebUI 首版起恒定上报 `openRightbar(false, false)`（`track` 从未为真），于是 `cols.rightbar` 恒为 0、面板以 `position:absolute` 悬在会话之上。修法：`layout-store.ts` 的 `openRightbar(state, fullscreen)` 自己把 `rightbarTrack` 置真——**`track` 参数整个删掉**（shown ⇒ 必占轨；全屏保留轨道，退出落回同一会话宽度），调用方没有传错的地方；`App.tsx` 的打开路径与全屏切换都走这一个入口。killing test 在 `layout-store.test.ts`（`openRightbar(wide(), false).rightbarTrack === true`，改回假即红）。面板宽度与轨道同源求解，拖拽手柄正落在轨道边界；窄到轨道放不下时由 `computeColumns` 解出 0 轨、面板转 `takeover` 占满——不需要参照件的 `autoFullscreen` 标志。**投影也去掉了**：两块面板（`RightbarPanel` / `ToolPanel`）曾带 `box-shadow: var(--dsw-shadow-lv3)`，而参照件把阴影只给浮动窗口（dockkit `.float`）、停靠列是平的——去掉后悬浮感才真正消失；`style-guard.test.ts` 新增「停靠列不得声明投影」的护栏（加回即红）。

### 记名偏离（不装成已对齐）

1. **docking kit 只搬了外观、没搬机器**：dsh 的 `ui-sidebar-right` 是一个可拖动、可浮动、可分裂的对接树；本仓第 19 轮搬的是它的**标签条长相**（第 20 轮收紧为 28px 芯片行 / 160px 上限 / hairline / 填充式活动标签 / sticky `+`），机器仍是固定顺序的单行 strip——**无拖拽换序、无中键关闭、无右键菜单、无多 pane 分裂**。理由不变：那套机器服务于十几页可插拔的 tab 类型，本仓只有四个固定页。
2. **文件 tab 是只读查看器，不是编辑器**（第 20 轮定形）：有语法高亮（复用聊天扫描器的自有实现）+ 行号 + 换行开关 + 复制 + 重新读取，但**没有编辑能力**——textarea / Ctrl+S / dirty 概念随本轮整体删除，无 LSP、无 CodeMirror/Monaco（都不在 deps）。读文件是面板的职责，写文件由模型工具与本机编辑器负责。
3. **每会话单一终端，且没有宿主侧屏幕恢复**（第 19 轮：真 PTY 落地后，原记名偏离「终端无 PTY」作废——vim / top / Ctrl-C 现在都是真的）。仍偏离的两点：参照件与 dsh 宿主都是**多标签**终端，本仓 `term-session.ts` 的 registry 按会话键，一个会话一个 pty；dsh 宿主侧的 headless 屏幕恢复（把终端状态序列化在宿主）未移植——**屏幕归浏览器侧的 xterm.js 持有**，重挂靠 `term_open` 重放保留的 scrollback 整屏重建。
4. **文件页无 watch**：工作区按需重读，不监听文件系统变更——内核未暴露目录 watch，轮询会在线上空耗 socket。
5. **任务页签的行不带输出**：和 dsh 不同（dsh 任务面板展示最近一段输出），本仓刻意不展示——`list_jobs` 的答复只带状态/进度，输出交给模型的 `jobs` 工具消费，避免与模型争游标。
6. **diff 并排用单个滚动容器**（第 20 轮起统一/并排/换行三态都有了）：参照同步滚动两个独立列，本仓一个滚动口装两侧——配对永不漂移、机器更少；仍无面板内拖拽手柄，**文件选择菜单只列路径、不带每文件 `+N −N`**（参照菜单行带计数），**布局/换行偏好落 localStorage**（`nova.diff.layout.v1` / `nova.diff.wrap.v1`；nova 无 per-tab store）。
7. **提交框单行文本**：不带 dsh 的多行 + 模板选择；保持 `MAX_COMMIT_MESSAGE_CHARS = 2000` 上限内的单行输入。
8. **开始页胶囊不挂快捷键 chip**（第 19 轮）：参照 `GuideBody` 的每枚胶囊右侧画一个 `ShortcutKeys`（截图里的 Ctrl+P / Ctrl+\` / Ctrl+T），本 surface **没有全局快捷键系统**——画一枚按了没反应的药丸比不画更糟，所以胶囊止于文字。若日后接进键位系统，落点是 `StartView` 的 `entry` 行尾 + `RIGHTBAR_COPY` 的键位文案。

## dsh-genui 内核缺口（六条缝，2026-10-01）

参照件：dsh 的 `gen-ui` 主示例插件与 deepseek-harness `ui-chat` 的 markdown / hook / asset 三条接入面。**只读**。本轨是「把为 genui 风格第三方插件开的内核缝接齐」——之前 nova 的内核没有一条缝能把第三方插件的用户界面能力拉进同一个面板，而 dsh 的 genui 示范了六条互补的接入位（spec、校验态、typed payload、提示词 section、将停注入、资产路由 + 浏览器装载）。**六条落地**（`.changeset/genui-kernel-seams.md`，core/plugins/web 三包 minor）。缝 6 收口用了**两轮**：第一轮补消费端（`App` 读 roster 上的 `clientBundle`），第二轮才发现**生产者那半从未存在**（见「闭环」一节）——这正是本仓「假闭环」缺陷族在同一处连栽两次的样本。

### 已对齐

- **工具结果 `meta`**（核心类型，缝 1）：`ToolResultMessage` 增可选 `meta?: Record<string, unknown>`，由 `ToolDefinition.resultMeta?(args, content)` 在 `completeToolCall` 末尾（`afterToolResult` 钩子与截断**之后**）填入——把一份只给 surface 看的结构化数据（genui spec、校验态、typed payload）挂在结果消息上。**绝不进模型可见面**：它不改 prompt 前缀、不沾缓存键。传输上它**随 `tool_call_result` 事件对象整体到达浏览器**（`wireFrame` 只附 `view`/`resultView`，不剥 `result`），所以这不是「只下发到某个接收方」，而是「**到得了、但仓内今天没人读**」——**没有任何消费者**（`web/ui/src` 零 `result.meta` 读取，repl / exec 也没有），读取方是**第三方的 client bundle**；声明 `resultMeta` 的工具在仓内同样是**零个**。两个内置工具今天都不声明，行为零变。直测钉「meta 进日志、content 不动」（撤掉 meta 写就会红）。
- **per-plugin 系统提示 section**（缝 2）：`buildSystemPrompt(sections)` 把插件 section 追加在 persona 之后、各自 `## <name>` 小标题；同名后写覆盖**正文**但**保留首次出现的位置**；空正文/空列表退化为裸 persona。section 在**装配时**一次性解析（`createEnvironment` 喂 `opts.systemPromptSections`），不是每请求重算——否则前缀字节能被一次钩子改写、命中缓存契约当场作废。`CreateKernelOptions.systemPromptSections` 是新的可选注入点。实现按职责分文件：`system-prompt.ts` 拥有 persona，`prompt-sections.ts` 拥有 section 注册表。直测四条。
- **fence 渲染注册表**（前端，缝 3）：`chat/markdown/fence-renderers.ts` 是 `Map<lang, FenceRenderer>`——markdown parser 已经把 info string 小写化，注册表对小写键查找，未注册的语言回落到 `<pre><code>`（注册零个 = 逐字节复现之前的页面）。`blocks.tsx` 的 `renderCode` 在 CodeBlock 之前先问注册表；返回 `null` 表示放弃（renderer 自己判定 spec 不能用），同样回落。**这是插件 UI 能力的接口**：把插件组件拉进 markdown 叶子会倒置包依赖方向，registry 让叶层插件无关、插件从自己的模块注册自己。直测四条。
- **turn-stopping 钩子**（事件 `turn/before-end`，缝 4）：`agent/loop.ts` 在「无 toolCalls、即将 `done`」前先跑 `ctx.serial(beforeTurnEnd, …)`；插件返回 `{ action: 'steer', message }` 即追加一条 user/assistant 消息继续回合（受 `turn < maxTurns` 配额保护，配额耗尽仍按 `done` 收尾）。返回 `void` 即弃权，旧路径逐字不变。`AgentSession.prompt()` 之外有了「**回合将停**」的注入位，不依赖 surface 配合——服务端钩子在装配点接线，无人值守 surface 也吃得到。**机制五端齐备**（键 `capabilities.ts:549`、派发 `loop.ts:129`、组合 `hooks.ts:77` 的 `ctx.serial`、类型 `types.ts:389`、`test/agent.test.ts` 两条直测），但**仓内今天零生产者**：`ctx.on(beforeTurnEnd, …)` 在全部 `packages/*/src` 里一次也没有，那两条直测是**直接注入 `AgentHooks` 对象**、绕过容器与 `ctx.serial` 的。所以它是**为第三方插件留的缝**，**不是**任何内置实现的现役路径——**`goal` 的跨轮续做走的是 `beforeLlmCall`**（`builtin/goal.ts:261`；`beforeTurnEnd` 在该文件零命中）。
- **插件资产路由**（`routes` 服务键 + Web `RouteRegistry`，缝 5）：`capabilities.ts` 增 `routes: ServiceKey<RouteRegistry>` + `PluginRoute`/`PluginRouteHandler`/`RouteRegistry` 接口；`plugins/services.ts` 的 `routeRegistryProvider(registry)` 把宿主建好的实例 provide 进容器；`web/route-registry.ts` 的 `WebRouteRegistry` 实现 register/routes/handlerFor（前缀精确与嵌套都匹配、**反向注册序**派发——同前缀后注册的胜，与容器 replace-by-key 同语义）。`web-mode.ts` 在 boot 时实例化并经 `routeRegistryProvider` 进 `extraPlugins`、同时随 `launchWeb({ routes })` 透传给 server。`server.ts` 的 `handleHttp` 在认证门**之后**、图片/静态**之前**问 `registry.handlerFor(relPath)`——**插件路由仍然是私有读**（与品牌资产例外不同），命中即交由 handler、未命中回落静态。headless（exec / qqbot）不 provide 这个键，插件 UI 能力按「读不到就降级」收场。直测五条（注册表单元）+ 一条 HTTP 端到端。
- **浏览器侧插件装载器**（boot graph + script injection，缝 6）：**声明点是插件自己的 manifest**——`PluginManifest.clientBundle?`（core `plugin/types.ts`，形状 `PluginClientBundle`）→ `describePlugins` 逐字段照抄到 `PluginRosterEntry.clientBundle?`（缺席即纯服务端插件，键**不出现**而非 `null`）→ `roster-wire.ts` 透传到 `WireRosterEntry.clientBundle?`；`web/ui/plugins/client-loader.ts` 是浏览器侧装载器：`buildBundleUrl`（编码名字、默认 `client.js`、`rev` 转 `?rev=` 缓存击穿）+ `loadClientPlugin`（每个 `<name>` 一条 `<script>` 注入，记入 `window.__NovaPlugins__[name]`、按页记忆化、失败一次即终态不再重试）+ `loadBootGraph`（并行装载所有声明了 `clientBundle` 的启用插件，单个失败不阻塞其他）+ `registerClientPlugin`（host 内置插件短路）。**纯逻辑与 DOM 分层**：DOM 触碰只落在 `injectScript` 一处，其余全是纯函数/UI 测试车道（node 环境、无 jsdom）直测——装载器有 15 条直测覆盖 URL 构建、记忆化、失败终态、boot graph 走查；DOM 注入器经 `setScriptInjector` 可换。

### 闭环

**六条缝的机制都已落地，但今天仓内没有一条被插件真的用起来。** 逐条核对，宿主侧 / 机制侧确实都在（工具结果带 meta 到得了浏览器、section 在装配点进 persona、fence 注册表被 `renderCode` 查询、`turn/before-end` 由 `agent/loop.ts` 派发、`server.ts` 的 `handleHttp` 真的问 `registry.handlerFor()`、`describePlugins` 真的投影 `clientBundle`）——**但这些只证明「管道通了」，不证明「有插件用过」**。按本节自己的判据「它在真实路径上被用了一次」，逐条的**插件侧那一端今天都是空的**：

1. **`meta`（缝 1）**：传输完整（随 `tool_call_result` 事件对象到浏览器），**零消费者**——`web/ui/src` 零 `result.meta` 读取；声明 `resultMeta` 的工具也是**零个**。
2. **`prompt-section`（缝 2）**：`buildSystemPrompt` 在装配点折叠 section（`runtime-env.ts:170` 读 `opts.systemPromptSections`），**零生产者**——全仓没有任何调用点传 `systemPromptSections`（直测只直调纯函数 `buildSystemPrompt`，不经过装配点）。
3. **`fence`（缝 3）**：注册表与查询都在（`blocks.tsx:22` 问 `fenceRendererFor`），**零生产者**——`registerFenceRenderer` 只被它自己的直测调用。
4. **`turn-stopper`（缝 4）**：五端齐备（键 / 派发 / 组合 / 类型 / 直测），**零生产者**——`ctx.on(beforeTurnEnd, …)` 全仓零命中。
5. **`asset-route`（缝 5）**：宿主 provide + server 查询（`web-mode.ts:133`、`server.ts:153`），**零生产者**——`ctx.must(routes).register(…)` 只出现在注释与直测里；且它是**宿主可选缝**（headless 不 provide，读到 undefined 即降级）。
6. **`clientBundle`（缝 6）**：投影 + 透传 + 浏览器装载都完整（`runtime-roster.ts:170`、`roster-wire.ts:59`、`App.tsx:184`），**零声明者**——没有任何插件在自己的 manifest 里写 `clientBundle`。

所以「六条缝全部闭环」这句话只在**机制**这一层成立，在**使用**这一层**一条也不成立**——六条都是为第三方 genui 风格插件留的缝；缝 6 的真机验收用的是**临时写的**声明方，不是仓内任何插件。这正是本仓「判据是『真实路径上被用了一次』，不是『类型/字段齐了』」那句纪律的**仓库级样本**。

缝 6 的收口分了两轮，而**第二轮证明第一轮的「已闭环」是假的**：

1. 第一轮补**消费端**：`App.tsx` 在 `[connection, rosterEntries]` 上单飞调一次 `loadBootGraph(rosterEntries)`。此前 `loadBootGraph` / `entriesToLoad` 全仓只被 `web/ui/test/client-loader.test.ts` 调用。
2. 第二轮才发现**生产者那一半从未存在**：`describePlugins` 只写 `title/description/tier/page` 四个键，`PluginManifest` 也没有 `clientBundle` 可声明。于是 `roster-wire.ts` 的透传永远拿到 `undefined`、`entriesToLoad` **恒为空**、`loadBootGraph` 恒为空转——「机制齐、接线缺」只是换了缺的那一头。补法是给插件一个**声明点**（`PluginManifest.clientBundle?`）并让 `describePlugins` 照传，**不是**在宿主里按插件名硬编码。

教训写在这里，因为它是本仓高频缺陷族的**双踩**样本：「只写不读 / 假闭环」在第一轮以「没人调装载器」现形，在第二轮以「没人写字段」再次现形；两轮的静态证据（类型齐全、`grep clientBundle` 有 15 处、直测全绿、`pnpm gates` 绿）**长得一模一样**。两轮的真判据都只有一条：**一个有浏览器半的插件真的被浏览器取了一次**。第二轮的真机验收（临时 home + `NOVA_WEB_PORT` 固定 + headless Edge/CDP）：roster 行带 `{"path":"client.js","rev":"rev-r1"}` → `ready` 帧原样带出 → 浏览器自己发出 `GET /plugins/<name>/client.js?rev=rev-r1`（HTTP 200，插件自己的 handler 记到 hit）→ `window.__NovaPlugins__["<name>"]` 被填；没声明的对照插件（`todo`）键缺席、路径 404。

### 记名偏离（不装成已对齐）

1. **路由是 host-owned**：只有跑着 HTTP 服务器的宿主（web surface）才 provide `routes`；headless（exec / qqbot）不 provide，插件读到 undefined 即降级。`surfaces` 是装配即存在，`routes` 是宿主可选——刻意不同。
2. **boot graph 而非 dsh 的运行时发现**：dsh 的装载走组件挂载时的运行时 import；本仓用声明式 `clientBundle`（写在插件自己的 manifest 里）作为 boot graph，挂载时一次性装载所有启用插件、单个失败不阻塞其他。**管道已闭合且真机验过**（见上面「闭环」）——但要读准这句话的范围：验的是**机制链**（`manifest.clientBundle` → `describePlugins` 投影 → `roster-wire` 透传 → `App` 装载 → 浏览器取回），**声明方是验收时临时写的**，不是仓内任何插件；仓内今天仍然**零个插件声明 `clientBundle`**。
3. **client-loader 是单向注入**：bundle 写到 `window.__NovaPlugins__[name]` 后由 host 读取；不支持热替换、不支持回滚——重启浏览器是新装载的唯一路径。
4. **fence renderer 不带运行时降级链**：一个语言键只能注册一个 renderer，后注册的覆盖先注册的（与容器 replace-by-key 同语义）；没有 dsh 的「主 renderer 失败回落备用 renderer」链。

## 全局动效体系（styles/motion.css，2026-10-06，操作者点名要求）

**操作者明确要求「优化 WebUI 动画、加 SVG 动画」，这是对 dsh 参照的记名偏离，勿修回**（dsh 参照件没有这套全局动效层；fish 待机游动、消息入场、勾画线都是本仓新增）。

- `web/ui/src/styles/motion.css`：共享动效 token（`--nova-ease-out/spring/inout`、`--nova-dur-fast/base/slow`）+ 全局关键帧（`nova-fade-up` / `nova-pop-in` / `nova-draw`）+ 全局 `prefers-reduced-motion: reduce` 兜底钳制。关键帧是**全局名**：CSS module 只哈希自己文件里定义的关键帧，跨文件引用按原名解析。不引第三方动效库（framer-motion 等）——合成器驱动的 CSS（opacity/transform/stroke-dashoffset only）零包体且更流畅。
- 消息入场：`chat/MessageItem.module.css` `.userRow` 与 `chat/AssistantMessage.module.css` `.root` 挂 `nova-fade-up`（220ms）。
- SVG 动画：`HeroShell.module.css` 的鱼从「仅悬停游动」扩为**待机 5.2s 缓摆 + 悬停 1.6s 快摆**（原 hover 行为保留）；`tool/StateDot.module.css` 的完成态勾改为**画线入场**（`nova-draw` + 药丸 `nova-pop-in`）。
- 守卫：`web/ui/test/motion-guard.test.ts` 钉挂载点、token、关键帧与引用（变异验证过：改关键帧名测试变红）。
