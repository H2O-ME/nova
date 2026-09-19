# TUI 设计决策史（M7.0 从源码搬运）

本文件收录 TUI 演进中的决策背景与事故复盘。源码注释只留不变量与红线（≤3 行），
想知道"为什么这样"时来这里查。UI 观感约定：布局、配色语义、降级顺序保持稳定，
只做结构重组（M8.3 起措辞更新：语义不重排的约束不变，但配色允许经**主题层**换绑——
默认 dark 主题 = 原配色原样平移（逐字节一致），light/plain 与 truecolor 变体经
`ui.theme`/`--theme`/`/theme` 显式选择；`resolvePalette` 是唯一解析点）。

## 缓存可见性：会话累计 + 粘住

provider 可能随机分流到不报缓存的后端，单轮 `stats` 每轮从零重算，某轮
`cachedTokens=0` 会让 cache 段"闪现"消失。状态栏因此看会话累计命中率，并粘住
可见性：本会话见过一次上报就常驻，不再随单轮忽有忽无；从未上报的 provider
整段隐藏。`/new` 与会话切换重置，compact 不重置（同一会话）。

## tps：无新增不推 0，只推时钟

轮内思考停顿 / 工具等待不推采样，否则连续几个 500ms 空窗会把 10 格窗口排空成
"▁▁… 0"（用户看到的"偶尔清零"）。tps 是会话级连续滚动速度表：新一轮不清空
ring、不归零累计，只把基线锚到本轮起点并重置时钟（排除空闲间隔压出的假 0）。

## 推理窗口：定高 + 空行不进窗

旧形态把 240 字符活尾交给 wrapBlock 折成数行、定格行原样入块：每个 delta 整块
重折，窗口以流速度抖动。现每行裁到单一显示行，块高恒定，每个 delta 只重写活尾
一行。模型思考里的空行（段落间隔）绝不进窗口：空行挤占定格位，屏幕上就是忽隐
忽现的空隙。思考全文仅存会话内存（不落盘），resume 后摘要不可展开。

## 轮内空行：摘要即引言

「已思考」摘要就是答案的引言：思考段不占空行，`assistantSeparator` 只在「本轮
没有刚折出摘要」时推。问题→已思考→答案三行紧挨成组，空行只存在于轮与轮之间。
前导纯空白 delta 不锚定空白答案块（模型常在工具前发空行）；空白答案按身份删除
块与分隔符（工具块可能已插在后面，不能删末块）。

## 状态栏：整字段降级 + 右缘定宽

旧版 `审批 自动编辑` 被字符裁剪剩 `审批 自`、模型名剩 `c`——纯字符裁剪的结果。
现按优先级整字段降级（T0 全量 → T1 去标签 → T2 最简 → 弃模型），绝不词中截断。
同一档位内先丢瞬时提示（中断/退出只是锦上添花）。右缘 tps+cache 定宽：sparkline
恒 10 格、数值 padStart、百分比定宽，tick 不改行宽；百分比亦 padStart，位数跳变
不挪分隔符。上滚不进状态栏：滚动位置画面自明，状态栏样式恒定。

## 上下文条：严格按整窗比例，不借位

每段格子 ≈ tokens/capacity × cells，空闲容量参与同一轮 largest-remainder。不做
"非零段至少 1 格"借位：1.2k 工具在 1M 窗口里按真实比例就是 0 格，强行画一格会
让条的已用填充与旁边的 used/capacity 数字打架。超窗时最后一段变红（消息永远是
先膨胀的那一段）。微量非零用量显示 `<1%`（与 ` 0` 同宽），杜绝"0% + 空轨道像
仪表坏了"。有 usage 锚点时总量用真实 prompt tokens，段按校准因子对齐（残差并入
提示词段）；无锚点时纯估算。

## 工具行：gutter 预算一致性 + 尾巴恒留本行

行构建器曾按 `cols-1` 裁、折行按 `cols-1-6` 折，行恒宽 6 列，` · N 行 · T.Ts`
尾巴被顶成孤儿续行。现 `toolBudget() = cols-1-6` 与 wrapBlock 同预算，尾巴恒留
本行。截断按显示列数（CJK 计 2 列）：命令在参数边界切，路径切头保文件名。
只读分组行逐级收紧（折叠公共前缀 → 收窄前缀 → 保留最近名字），计数由 `N 次`
后缀承载。`truncateStyled`（tui 末道 ANSI 截断）与 `clipToWidth`（语义裁剪）
职责分离，二者都保留。

## 弹窗/面板：行恒单行 + 滑动窗口

弹窗行折行会把整体顶出视口：头部与 diff 预览都按剩余列数裁剪。长列表（模型/
会话/命令）在弹窗内滑动而非灌进转录区。审批 `allow/always/deny` 结果码与中文
标签曾靠下标隐式对齐，现为 `{code,label}` 对。`always` 对 execute 类按命令程序
前缀记忆（`git status` 放行后续 `git …`，不波及 `rm`），弹窗与 REPL 提示都写明
该粒度。点击命中测试含展开正文整块；弹窗/面板打开时点击吞掉不漏进 composer。

## 按键：责任链 + 互斥语义

审批 → 模型面板 → 会话面板 → 全局键 → composer。层顺序即互斥语义：弹窗打开时
任何键都进弹窗。孤 Esc 需 200ms 消歧（可能是跨 chunk 序列头；ConPTY 拆包稍慢，32ms 曾误判出幻影中断）。粘贴走 bracketed
paste，清洗控制字符与 Tab，超限截断并提示。`Tab` 只在新会话未开始时切模式
（会话跑起来再换 host 会造成工具集不一致）；芯片用不含 modeSwitching 的判据，
否则切换瞬间三枚塌成一枚再弹回、整行闪烁。

## 开屏：首块 + 顶部对齐

转录首块 + 短转录顶部对齐垫空实现首屏置顶。技能与会话警告在面板外以 plain 行
追加（可很长，会撑宽面板）。窄屏钳制 `min(max(内容宽+2,14), cols-2）`，否则边框
错位。`banner()`（REPL）与 TUI 面板曾是两套开屏逻辑，现收敛为 `buildSplash`
纯函数 + REPL 共享头。

## 渲染：差分 + 帧预算 + 按键抢占

`LineScreen` 行级差分，末列为 no-write 安全边距；SGR 在擦除前复位（半截颜色不
污染擦除）。16ms 合并帧（上限约 60fps），按键走 preemptRender 取消 pending 帧
同步直绘。spinner 90ms tick 只重写脏工具块（帧/后缀/tail 任一变化），否则只推
tps 时钟。`wrapBlock` 缓存随 resize/替换/删除失效；`/clear` 后流持有的孤儿块引用
重建而非写入孤儿。


## Grok Build 观感对齐：四层差距与批次计划（M10 批13+）

批12 之后用户拿 Nova 实拍与 Grok Build 实拍并排比对，结论是"完全不是一个设计水平"。
差距不在某个间距没调对，在**四层根本没有对应物**。以下逐层列 Grok 事实（`文件:行号`
为 `D:\下载\grok-build-main\grok-build-main\crates\codegen\` 下真实源码，路径缩写：

**落地状态**：层 1（批13 配色 + 探测）已实施；批14 追加实施了**条目留白节奏**（属层 3 的垂直部分——条目间恒 1 行、工具 dense run、提问 vpad）；
批15 追加实施了**活体行**（属层 4 的 turn_status）。层 2（画布色带）与层 3 的其余部分、层 4 的顶栏与 caption 搬迁仍未动。
`A=xai-grok-pager\src`、`R=xai-grok-pager-render\src`、`M=xai-grok-markdown\src`）与
Nova 现状（本仓 `文件:行号`），并给出批次切分。**本节只是方案，动一行代码都要重开
commit。**

### 层 1 · 颜色系统（批13，最小风险 / 最大观感收益）

- **Grok 事实**：调色板以 RGB 为规范形态（`R\theme\groknight.rs:16-50`），启动时
  `Theme::quantized` 按终端能力降到 256 / 16 色（同文件头注释 1-3 行）。关键值：
  正文 `#e1e1e1`、次级 `#c8c8c8`、muted `#6c6c6c`、gray_bright `#787878`、dim `#585858`、
  h1 青 `#1abc9c`、h2 蓝 `#7aa2f7`、h3 紫 `#9d7cd8`、行内码 `#3A95AB`、代码底 `#1c1c1c`、
  主底 `#141414`、高亮底 `#242424`、输入框边 `#323237`（聚焦 `#505058`）、
  模型名 `#1abc9c`、用户标记 `#c8c8c8`（**不是青色**）、assistant/thinking accent 紫 `#bb9af7`。
- **Nova 现状**：`packages\tui-view\src\palette.ts:37-52` 的 dark 调色板是纯 ANSI-16
  转义码（`36`/`32`/`33`/`90`…），**一个 RGB 值都没有**；truecolor 通道已经铺好但只有
  light 主题在用（`theme.ts:26-27` 的 `rgb()` 助手、`theme.ts:34` `createLightPalette`、
  `packages\tui\src\caps.ts:20` 探测 `COLORTERM`）。语义槽只有 10 个
  （dim/cyan/green/yellow/red/blue/magenta/bold/inverse/border），表达不出 Grok 的
  "正文/次级/muted/h1/h2/h3/代码底/画布底"这层角色。
- **色彩模型也是事实的一部分**（决定降级表怎么写）：Grok 全部槽以 `Color::Rgb` 为规范形态，
  启动时 `Theme::quantized(level)` 逐槽降级——TrueColor 原样 / Ansi256 取最近索引 /
  Basic 走 `rgb_to_ansi16`（xterm 16 色硬编码表 + **平方欧氏最近邻**，
  `R\theme\color_support.rs:220-336`）。探测三处与 Nova 不同：`NO_COLOR` → **全 Reset**
  （不是退到 16 色，`:99-101`）；非 TTY → TrueColor（`:116`）；只报 256 色的终端按品牌名
  **升回 TrueColor**（iterm2/ghostty/kitty/wezterm/vscode/windows_terminal…，
  **Windows 无条件为真**，`:121`→`:250-269`）。Nova 的 `caps.ts:20` 只认
  `COLORTERM=truecolor|24bit`，缺这个环境变量就整屏落回 ANSI-16——批13 要么补品牌表，
  要么至少补 Windows 分支。
- **要改的**：`palette.ts` 新增 GrokNight 常量与 `createDarkPalette(truecolor)`；
  `theme.ts:80` 的 `darkTheme.palette` 改成按 caps 选后端；`Palette` 接口加
  `text` / `muted` / `canvas` / `band` / `code` 五个语义槽（`blue`/`magenta` 现在 src 里
  零直调、只被 `contextGaugeForms` 的 `p[color]` 动态索引用到，可复用为 h2/h3）。
  ANSI-16 降级表逐槽给"最近邻"值（`#6c6c6c`→`90`、`#c8c8c8`→`37`、`#1abc9c`→`36`…）。
- **破坏面**：`Palette` 是 tui-view 公共导出（AGENTS.md §10 公共 API 面第 5 条），
  加必需方法 = 第三方自实现的 Palette 编译不过。0.y.z 期记次版本即可，但 `plainPalette`
  必须同步补齐（否则单测全炸）。
- **真机验证点**：Windows Terminal 里逐槽肉眼比对（ANSI-16 与 truecolor 各一张截图）；
  `NO_COLOR=1` 与 `TERM=dumb` 回落 plain；`COLORTERM` 缺失时降级表不出"灰底灰字"。
- **风险**：`dim` 槽被 108 处直调，是全屏次要文本的总闸——它一旦从 SGR 2（faint）改成
  具体灰值，所有"暗一档"的相对关系要重新校一遍（`border` 与 `dim` 分槽是批6 立的，
  别合）。

### 层 2 · 画布与色带（批14，依赖层 1）

- **Grok 事实**：整屏刷 `bg_base #141414`（`R\theme\groknight.rs:71`），用户消息是
  **block 级整区填充** `BlockBackground::Light` → `bg_light #242424`，accent 列、左内衬、
  正文、右内衬、连右侧 10 列时间戳槽一起刷
  （`A\scrollback\wrappers\entry_renderer.rs:581`、`:586-627`、`:756-759`）。
- **Nova 现状**：谁都不刷底，终端自身的背景/字体直接透上来——实拍里"乱"的一半来自这里。
  `packages\tui\src\screen.ts:105-125` 的行级差分把每行裁到 `cols-1`（`:110` 的
  `safeCols` 注释写明了为什么绝不写末列：末列落一个超宽字形就折行、差分缓存永久失同步）。
- **要改的**：整屏刷底只能走"每行 `CSI 48;2;…m` + `EL(2)`"（擦除用当前背景色，不写
  字形 ⇒ 无折行风险），不能靠补空格到末列。这与现有"整行按字符串比较"的差分模型要合流：
  底色变更本身也算脏行，得进 diff key。用户行色带则要求 block 携带"整行刷底"的意图
  （现在 gutter/`MARK_LEAD` 只发前缀字符串，`packages\cli\src\tui\gutters.ts:12`）。
- **破坏面**：`LineScreen.render` 的行语义（"一行 = 一个字符串"）是 `tui` 包公共面
  （§10 第 5 条），加刷底通道要么扩 `render` 入参要么引入行内属性段。这是四层里唯一
  会动到终端原语的一层。
- **真机验证点**：SSH / tmux / ConHost 三种宿主下 `EL(2)` 的底色行为（ConHost 对
  `48;2` 干脆不支持）；色带行与相邻普通行之间不能出现"半行高亮"的残影；resize 时
  旧行底色不残留。

### 层 3 · 转录语义（批15，本层才是"设计水平"的主体）

- **Grok 事实**：
  - 用户行：标记 `❯ ` 恒定 2 列（`R\glyphs.rs:16-24`，旧 ConHost 退化 `"> "`），
    色 `accent_user`；文本粗体；行尾时间戳格式 `"  %-I:%M %p"`、fg `gray`、右端距窗缘
    = block_pad_right 2（`entry_renderer.rs:778-788`、测试 `:1025-1032`）；**折行宽度
    预留 10 列给时间戳**（`entry_renderer.rs:321-327`、`:341-343`）；只有
    UserPrompt / AgentMessage / Btw 三类块带时间戳（`:311-316`）。
  - 助手行：**没有 `•` 标记，也没有"标题子系统"**——块内容就是把模型文本当 markdown
    渲染（`A\scrollback\blocks\agent.rs:147-153`）。实拍里那行青色标题是模型自己写的
    `# H1`（h1=TEAL+BOLD、h2=BLUE+BOLD、h3=PURPLE+BOLD，`R\theme\groknight.rs:120-124`）。
  - thinking：`◆` + `Thought` + ` for {t}`，`{t}` = `{:.1}s`、≥60s 走 `{}m{:.0}s`
    （`A\scrollback\blocks\thinking.rs:240-247`、`:271-280`），折叠态尾附
    `"  (ctrl+e to expand)"`（`:18-20`、`:36-42`），默认 Truncated→Collapsed，
    **双击**才展开（`A\app\agent_view\selection.rs:1120-1150`）。
  - 垂直节奏：条目间恒 1 空行，用户块额外 `vpad`（净 2 行），助手/thinking/工具
    `vpad=false`（净 1 行）——`A\scrollback\state\layout.rs:1555-1563`、
    `entry_renderer.rs:405-412`。
  - 列网格：标记列与正文列各比 Nova 靠右一格（outer 2 + accent 1 + block_pad 2，
    `A\scrollback\layout.rs:41-43`），markdown 续行前缀按层级 `"│ "`（2 列/级，
    `A\scrollback\blocks\markdown_content.rs:411-427`）。
  - markdown 细则：`- ` → `•`(U+2022) 就地替换、色 `md_muted`（`M\parse.rs:1037-1043`）；
    `---` → **定宽 3 字符 `───` 左对齐**（`M\parse.rs:835-851`）；`>` → `│` muted+dim
    （`:924`）；`**`/`*`/反引号定界符 `HIDDEN` 被吞（`R\theme\md_style.rs:91`、`:142-143`）；
    代码块**只加背景 `#1c1c1c` 无边框无语言名** + syntect 高亮（`R\theme\md_style.rs:146`、
    `M\render.rs:555`、`:805-808`）；段落空行**来自源 `\n\n`，渲染器不合成**
    （唯一合成的是代码栅栏前那一行，`M\render.rs:663-671`）。
- **Nova 现状**：`packages\cli\src\tui\gutters.ts:12-13` 里 USER/ASSISTANT 两个 gutter
  **硬编码 `\x1b[36m\x1b[1m❯` 与 `\x1b[2m•`**——绕过了调色板（批11 刚把 composer 的 `❯`
  收进 `composerLead`，这两个是漏网的），light/plain 主题下必然错色；全屏幕**没有任何
  时间戳**；markdown 只有一档标题色（`packages\cli\src\markdown.ts:23` 所有级别一律
  `bold(cyan)`）、列表圆点是 `·` 不是 `•`（`:27`）、行内码青色（`:44`）、围栏行直接
  丢弃后正文 `dim`（`:20-22`，无背景块）、无斜体/无引用/无 hr/无链接。
- **要改的**：`markdown.ts`（分级标题色、`•`、hr、blockquote、代码块背景段、斜体、链接）、
  `gutters.ts`（收进 Palette，去掉助手行的 `•`）、`turn-projector.ts`（时间戳字段与
  10 列折行预留——`wrapBlock` 的预算要接这个新参数）、`reasoning-view.ts`（`▸ 已思考`
  → `◆ Thought for` 同款三段）、`layout.ts`（`MARK_COL`/`CONTENT_COL` 各 +1）。
- **破坏面**：`MARK_COL`/`CONTENT_COL` 是公共常量（§10 第 5 条），改值会让所有断言宽度
  的测试重排；`wrapBlock` 预算签名变更波及 `frame.ts` 的 Flattener 缓存键。
- **真机验证点**：CJK 正文 + 时间戳同行不折行；`•`(U+2022) 在 Cascadia Mono 的存在性
  （批7b 探针已证 `•` 存在但**在反色段内会漂宽**，层 2 的色带是 bg 不是 inverse，
  要单独测）；代码块背景与色带叠加时的先后覆盖；无 usage/无时间戳的旧会话 resume 面。

### 层 4 · chrome 重排（批16）

- **顶栏 = `AgentStatusBar`，常驻 1 行 + 1 空行 gap，滚动不消失**（`A\views\agent.rs:228-230`、
  `:245`、`:301`；组装 `A\app\agent_view\render.rs:1255-1383`）。左半
  `display_location_path(cwd)` → `~/{}`（`R\util.rs:71`），前可插 branch/worktree/sandbox
  badge，色 `text_secondary`，有 session title 时降 `dim()`（`render.rs:1424-1457`）。
  右半 context 读数 `"{used} / {total}"`，两侧都过 `fmt_tokens`：&lt;1k 原样、&lt;10k
  `{:.1}K`、&lt;1M `{k}K`、&lt;10M `{:.1}M`、else `{M}M`，**恒 ≤4 字符**
  （`A\views\context_bar.rs:29-41`、`:166`）；色按用量百分比分段 lerp
  （`#e1e1e1`→50/65%`#c8c8c8`→75/85%`#e0af68`→95%`#f7768e`，`:53-80`）；**hover 才换成
  `████ 42.0%`**，与非 hover 等宽（`fmt_pct5` 恒 5 字符，`:16-24`、`:168-172`）。
  条目间 `" │ "`（3 列）+ `faint`，push 序 bg_tasks→plan→goal→mcp→workspace_mode→
  **context**→switcher（`A\views\agent_status.rs:131-139`）。
- **输入框 caption 画在底框线上**（先铺 `─` 再覆盖，`A\views\prompt_widget\mod.rs:3319-3333`、
  右对齐 `:3549-3552`），内容 `{model_id} ({eff}) · {mode_flags}`（`render.rs:2341-2344` +
  `mod.rs:303-325`），model 名色 = `blend(bg, text_secondary, 0.6/0.4)`、always-approve
  走 `muted`（`mod.rs:3436-3445`）。空输入恒 3 行 = `vpad_top(1)+text(1)+info_block(1)`，
  **顶框复用 vpad 那一行**（`:1589-1613`、`:3008-3010`）；侧 `│` 只覆盖文本行（`:3285-3293`）；
  行首标记是 `❯ `（U+276F，2 列），focused=`accent_user #c8c8c8`、失焦=`gray_dim`
  （`:281-287`、`R\glyphs.rs:16-22`）。
- **跑动时输入框上方 = `turn_status`，一行 + 一行 gap，空闲且无 watcher 时整块消失**
  （`A\views\turn_status.rs:725-736`、`agent.rs:255-258`）。spinner 8 帧
  `⠋⠙⠹⠸⠼⠴⠦⠧`、`tick/4 % 8` ≈7.5fps（`R\glyphs.rs:148-159`、`turn_status.rs:31,370-375`）；
  左半文案 `Responding…`/`Thinking…`/`Compacting…`/`Cancelling…`/`Verifying…` 用
  `text_secondary`，工具态 `Run `/`Search `/`Fetch ` + 高亮，后跟 phase timer
  （`:457-486`、`:580-630`）；时长格式 &lt;10s `{:.1}s`、&lt;60s `{secs}s`、&lt;60m
  `{m}m{s}s`（`R\util.rs:90-105`）。右半 `{timer} ⇣{tokens}`——
  **`9.45k` 是累计 context token，不是 tok/s**（`turn_status.rs:168-169`、`:319-330`），
  `format_tokens_short` 1k-10k 走 `{:.2}k`（`:746-768`，与 context_bar 的大写 K **不一致**）；
  `[stop]` 静止 `gray`、**hover 才 `accent_error`**，无鼠标能力整块不渲染，
  `width<10` 不渲染（`:213-216`、`:298-306`、`:557-567`）。
- **底部键位条**：分隔符 `"  │  "`（5 列硬编码）+ `gray`+`DIM`（`A\views\shortcuts_bar.rs:251-264`）；
  键 `text_secondary`+**BOLD**、标签 `muted`、`:` 用标签样式（`:216-226`、`:278`）；顺序即数组序、
  bar 不排序（`:259-292`）；超宽**两层**——先 `compact(5, help_hint)`（pinned 先占坑、其余原序
  取满、help 永远尾追，`:338-366`），再绘制期逐 span 越界即 `break`（整条丢、不裁字，`:265-291`）；
  末尾恒 `Ctrl+.:shortcuts`（`A\actions\defaults.rs:805-816`），取消键印的是
  **`Ctrl+c:cancel`（小写 c）**（`:496-506`）；双击确认态整条换成 `press again to {label}`
  （`shortcuts_bar.rs:229-249`）。
- **Nova 现状与差距**：对应物全挤在**底部两行**（`packages\cli\src\tui\frame-assembler.ts:187-222`
  + `packages\tui-view\src\status-view.ts:383`），没有顶栏、没有 turn_status 行。好消息是
  **机制已经有了、内容放错了**：`cardBottom` 的 info 槽就是 Grok 的"底框线上右对齐 caption"
  （`packages\tui-view\src\layout.ts:90-101`），Nova 却往里塞 `第 1/3 行 · 12 字`
  （`composer-view.ts:74-80`），而把模型/审批塞进状态栏。批次内容因此是**搬迁而非新建**：
  顶栏（cwd + context 读数 + hover 换形）、输入框 caption（`model (eff) · 审批档`）、
  turn_status 行（现有 spinner/tps 的重新编排），以及状态栏从底部移到顶部后剩下的东西怎么放。
- **两处读图纠错**（先记下来，免得实施时照错的做）：`↓9.45k` 不是 tok/s 而是累计 context
  token；`9.5K / 500K` 不是"条形仪表"而是纯数字读数，条形只在 hover 时出现。
- **真机验证点**：顶栏在滚动/上滚时恒在（Nova 现在的红线是"上滚不改状态栏样式"，语义要
  重新对齐）；caption 与审批弹窗同时出现时不互相覆盖；`turn_status` 行的出现/消失不引起
  转录区一行跳动（Nova 的 `bottomStack` 是定长行，插入 2 行会挤动历史预算，要过
  `frame-assembler` 的 historyBudget 计算）。

### 依赖与建议顺序

层 1 → 层 2 → 层 3 是硬依赖（色带要 bg 槽、色带与时间戳要同一套列网格）；层 4 独立。
建议 **13 配色 → 15 转录语义 → 14 画布色带 → 16 chrome**：层 2 的 `EL(2)` 刷底要改
终端原语、风险最高，把它推到"已经明显像 Grok 了"之后再动，出问题好归因。
每批一张真机截图 + 一次离线帧差分，两样都对齐才算收口（批11 就是只看了离线帧才
让冷启动的半屏空洞过了关）。
