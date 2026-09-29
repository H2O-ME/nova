# @nova-agent/ai

## 0.4.0
### Minor Changes

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

### Patch Changes

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

### Patch Changes

- 42c1bfb: 治理换血与消重拆壳（M9.0–M9.K，行为保持不变重构）。
  
  - **公共面新增**：core 导出 `errMessage`（错误转消息字符串单源）与 `truncateUtf8Head` / `truncateUtf8Tail`（UTF-8 整字符边界字节裁剪，收编 agent 落盘 / jobs 读取 / AGENTS.md 裁剪三份同构循环）；plugins 导出 `resolveShellName`（bash/powershell 解析单源，收编 cli `declaredShell` 与 bash `invocation` 两份真相）；呈现层的 `Palette` 接口补 `reset` / `clearLine` / `clearRight` 开态原语（收编手滚 raw ANSI；无色调色板对控制码返回空串，保证 NO_COLOR 恒静默）。
  - **结构棘轮**：`pnpm gates`（依赖方向机检 + 逐文件行数硬上限，只降不升）、`pnpm check` 快环 / `pnpm verify` 全环分层、oxlint complexity/max-depth/长函数规则上线；决策笔记体系删除。
  - **消重**：四 runner 的用户消息提交/重试与空补全文案/回合失败归类/审批预览与 toast/hooks 重绑单源；repl 与 TUI 的 13 个斜杠命令下沉 command-core（M11 批5 进一步收为 `command-runner.ts` 一个 runner 两壳共用）；`repl.ts` 的瞬态进度行出壳 `ReplProgress`、`/session` `/model` `/plugins` 报告行下沉；core 的 989 行 `agent.ts` 拆为 `agent/{notices,request,stream,tools,loop,options}.ts` + 桶文件（40+ 条行为测试不动）；plugins 的 fs/bash/search/run-code 内联 execute 体提为顶层具名函数，工厂只留 schema+接线；各包 `test/helpers/` 收敛 `scriptedProvider`（5 拷贝）与 `withFakeHome`（2 拷贝）。
  - **声明的行为例外（漂移修复）**：repl 审批预览宽度统一走 `toolArgSummary`；exec/qqbot 调色板装配走 `resolvePalette`，开始尊重 `ui.theme` 与 `NO_COLOR`（此前恒暗色）；repl bash 输出尾行缓冲并入 TUI 同源的 `TOOL_TAIL_KEEP_CHARS`（显示行仍裁到单行，观感不变）。
  - **缺陷修复**：TUI 首装与 exec 路径的 `hooksRef` 从未赋值——嵌套 subagent 因此绕开父审批门（exec 的 never 策略形同虚设）；重绑单源后审批门对嵌套调用恢复生效。
  - **热路径微优化（行为不变）**：`request-trim` 的 snip+micro 共享一次 `groupMessages`（snip 未改动时同引用短路）；`estimateTextTokens` 的 CJK 判定由正则改为码点区间比较（消除每字符 regex.test）；`OpenAICompatClient` 的工具序列化按数组身份 `WeakMap` 缓存，`PluginHost.tools` 返回稳定引用跨轮失效仅在 registerTool——启动后稳定工具集下每请求免一次 sort+map。
- 494541f: Retry resilience fixes: `parseRetryAfterMs` now honors both server delay forms (delta-seconds and HTTP-date, capped at 60s) and fails loudly on present-but-unparseable values instead of silently guessing a delay; the client's own exponential backoff is capped at 32s (`RETRY_BACKOFF_MAX_MS`) so a generous base can no longer park a run for minutes on transient 429/5xx.
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

- Updated dependencies [f364394]
- Updated dependencies [f364394]
- Updated dependencies [f364394]
  - @nova-agent/core@0.2.1

## 0.2.0

### Patch Changes

- d69b9ba: Unified TokenGate (auto-compact.ts shared by all runners): preflight uses anchor-or-full-estimate so resume of a large session can no longer blow the context window on its first request; compactConversation/compactSession accept an optional AbortSignal forwarded to the summarizer. always-approval scope narrows compound commands to the whole normalized chain. TUI error path discards uncommitted partial assistant blocks (screen/log divergence fix); REPL gets an equivalent dim hint. agentTurn gets a catch guard so errors outside the event loop surface as blocks, not unhandled rejections.
- c9a8f61: P3 polish: jobs.ts comment drift fixed (completion injection channel exists since M6.4); dead code removed (extractReasoningHeader, reasoningRows, questionLines, isBlankAnswer + their tests); {env:NAME} throws naming the missing variable instead of silently expanding to empty; --version/-v/--help/-h only match as leading flags; interactive mode warns on stray positionals; runCompact no longer zeros cumulative session stats; PTC both-mode SDK slims bindings to name + one-line summary (native schemas carry full types); search_files in-process walk checks abort signal; spacing.ts contract comment aligned with frame.ts tight-pair implementation.
- 21dfe53: Structural refactor: extracted createSessionRuntime (packages/cli/src/session-runtime.ts) merging the ~60-line duplicated session/client/host/skills/fragment startup across all three runners (exec/repl/tui); runtime exposes reloadWorkspaceContext for workspace switches so fragment closures stay consistent. TuiStore convergence: removed all three `as any`/`as unknown as TuiStore` casts from tui-mode.ts by fixing structural compatibility (sessionPicker/approval types already matched; appendTail implemented inline; blocksVersion wired as getter; onChange made public on TuiStore). store.ts onChange promoted from private constructor param to public field for structural assignability.
- Updated dependencies [d69b9ba]
- Updated dependencies [c9a8f61]
- Updated dependencies [21dfe53]
  - @nova-agent/core@0.2.0
