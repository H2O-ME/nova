# NOVA 设计系统规范

> **文档状态**：Normative（Batch 1 已落地 token 层与守卫；**视觉迁移仍待操作者复核**）
> **本文件回答**：Nova 的视觉决策有哪些、token 怎么命名、动效允许什么、哪些字面值可以留。
> 结构规范见 `NOVA-UI-ARCHITECTURE.md`；依赖边界见 `NOVA-BOUNDARIES.md`。

---

## 0. 为什么需要这份文件

Nova WebUI 的视觉问题不是"不好看"，而是**没有单一决策来源**。

债务由 `scripts/ui-token-guard.mjs` 机械量测（只计组件 `*.module.css` 的字面量声明；token 层不计）：

| 规则 | 基线（2026-10-07） | 说明 |
| --- | --- | --- |
| spacing | **767** | padding / margin / gap 的 px 字面量 |
| radius | **82** | `border-radius` 的 px 字面量 |
| shadow | **12** | `box-shadow` 非 `var()` 值（其余已走 `--dsw-shadow-lv*`） |
| duration | **129** | `transition` / `animation` 的 ms/s 字面量 |
| ease | **111** | 同上声明里的字面缓动词 |

覆盖面：**83 个组件 sheet**。另有 `--ds-transition-duration`、`--dsw-shadow-lv*`、在途的 `--nova-dur-*` **三套动效词汇并存**，以及一个 4/8/12/16/20/28 的圆角阶梯（`--dsw-radius-*`）——正是要收敛的漂移。

> **目标不是禁止 CSS，而是禁止每个业务组件自行发明设计规则。**

## 1. 与 dsh 参照的关系（已拍板并执行完毕）

现有调色板与排版**曾**移植自 `deepseek-harness`（MIT 授权）。**自 0.5.0 起 Nova 另起自己的设计语言**：

- `docs/dsh-parity-inventory.md` 降级为**历史参照**，不再是验收口径；
- ~~`--dsw-*` 只作为过渡底座存在~~ → **2026-10-11 调色板换代后已全部删除**：`design/tokens/` 直接持值，移植层 `styles/`（含 `design-platform.css`）整体删除，`style-guard` 禁止任何 `--dsw-*`/`--ds-*`/`--dsh-*` 出现；
- 从 Batch 1 起，**`--dsw-*` 不再是任何新代码的契约**——这条现在是机器禁令而非约定。

## 2. Visual Direction v1

规范要求的气质：**Quiet / Dense / Precise / Technical / Neutral / Fast / Professional**。

避免：大量 glassmorphism、大量渐变、巨大圆角卡片、装饰性动画、无意义阴影、高频 layout animation。

### 2.1 Density（密度优先，IDE 语义）

基准单位 **4px**。**值命名**（`--nova-space-8` 就是 8px），读的人不必回查阶梯。

```text
--nova-space-0    0
--nova-space-2    2px
--nova-space-4    4px
--nova-space-6    6px
--nova-space-8    8px
--nova-space-10   10px    ← 非 4 倍数，见下
--nova-space-12   12px
--nova-space-14   14px    ← 非 4 倍数，见下
--nova-space-16   16px
--nova-space-24   24px
--nova-space-32   32px
```

> **为什么阶梯上有两个非 4 倍数**：`space-10` / `space-14` 是**实测承认**，不是随手放宽。
> 加入时全仓已有 63 处用 10px、39 处用 14px，而相邻台阶是 8 和 12——阶梯上够不到这两个值，
> 作者只能在「改视觉」和「写字面量」之间选，结果 102 次都选了字面量，正是阶梯要消灭的那件事。
> 一个**有名字的固定值**仍然是设计决策，写成字面量才不是。

行高：

```text
--nova-row-sm    24px
--nova-row-md    28px
--nova-row-lg    32px
```

#### 2.1.1 对话节奏阶梯（transcript rhythm）

对话流**不用** `space-16` 当默认间距。轮内是一条思路的三个部分（思考行 → 回答 → 用量尾行），
用 16px 会把它们撕成三个无关区块。阶梯按**语义层级**取值，不按视觉松紧：

```text
6px     轮内默认（思考行、连续行）           ← --nova-chat-flow-gap 的兜底值
8px     过程块折叠后紧接回答
12px    回答跟在过程摘要之后（不同类别，仍属同一轮）
16px    轮次边界：user 行，且只有它
```

> **为什么默认是 6 而不是 16**：16px 会让「一个 turn」读起来像三个并列的记录。
> 段落感必须由**轮次边界**承担，而不是由每一行平均分摊。
> 这与 §2.6「去框容器」是同一条原则的另一面：分隔靠邻近性，不靠墨色。

> **守卫**：`palette-guard.test.ts` 的 `the transcript rhythm stays inside the reference ladder`
> 钉住兜底值必须是 6、且 user 行必须是 16。改成 16 兜底会被截获。

#### 2.1.2 输入卡尺寸稳定（composer floor）

hero（首页空态）与 dock（会话内）两个 seat 的文本底线**必须是同一个数**（当前 44px）。

> **为什么**：两处曾分别是 68 和 36。发送第一条消息时卡片从 hero 重定位到 dock，
> 一帧内缩掉 32px——这就是操作者报的「尺寸忽大忽小」。
> hero 的落地态存在感应由 wrapper 的外边距提供，**不能**用更高的文本底线去买，
> 否则重定位必然改变卡片盒子大小。
> **守卫**：`the composer keeps ONE text floor across the hero and docked seats` 禁止出现
> 第二个 `min-height` 或任何 `.hero .input` 覆盖。

### 2.2 Radius（按角色分档，不按「小就是安静」）

```text
--nova-radius-sm     4px
--nova-radius-md     6px
--nova-radius-lg     8px
--nova-radius-xl     14px     ← 独立表面：输入卡、设置弹窗
--nova-radius-full   9999px   ← 只给天然是圆形的形状（状态点、头像），不是做胶囊的途径
```

**~~比移植来的阶梯刻意小一档~~ → 2026-10-18 修正。** 原先这条写的是「28px 行上放 12–16px 圆角就读成卡片，所以三档就够」。**判断错在落点**：全线压小之后，每个密集表面（供应商行、编辑器分组、添加按钮）只能改用**边框**来分隔自己，而一页 8px 圆角的带框盒子不是「安静」，是一张表格般的框套框。

现在的规则是**按角色分**，不是「小即是好」：

- **列表里重复的行**用 `sm`/`md`，永不 `xl`；
- **独立站立在页面上的一两个表面**（输入卡、设置弹窗）用 `xl`，它们同时换用无描边的 `--nova-elevation-float`。

`xl` 配带描边的 `elevation-*` 是无效组合：0.5px 描边会沿着 14px 曲线拉出一道可见的接缝，把大圆角的意义抹掉。这条由 `ui/test/palette-guard.test.ts` 的 `standalone surfaces pair the large corner with the stroke-free float` 钉住。

### 2.3 Elevation（三级 + 一个浮起档）

```text
--nova-shadow-1 / 2 / 3
--nova-elevation-stroke / panel / prominent / soft   ← 带 0.5px 发丝描边
--nova-elevation-float                               ← 无描边，大范围柔光
```

**停靠列（右侧 Inspector）不画阴影**——它是一页的列，不是浮起来的卡。这条 `ui/test/style-guard.test.ts` 已钉住，保留。需要第四级阴影说明是层级设计有问题，不是高度不够。

`--nova-elevation-stroke / panel / prominent / soft` 是 0.5px 发丝描边（画在 box-shadow 里，不占布局）+ 一到两层极淡柔光，浮层/面板/面型按钮的既有配方（`--nova-elevation-stroke-color` 可被组件重绑，因此复合值逐元素声明而非 body 继承——机制注释见 `design/tokens/shadow.css`）。

**`--nova-elevation-float` 是给「读起来是浮起来、不是被描出来」的表面用的**（输入卡、设置弹窗）。两处与上面几档不同，都是刻意的：**不含发丝描边**（大圆角下描边就是接缝），**用真实的柔光衰减**（24→48px 模糊、低透明度）。暗色下透明度约翻倍并改用纯黑——同样的 alpha 在白纸上是「轻轻浮起」，在 `rgb(24,24,26)` 上是「根本没有阴影」。

### 2.4 Typography

```text
--nova-font-family / --nova-font-mono     家族轴（正文栈 / 代码栈）
--nova-text-size-2xs/xs/sm/md/lg          11 / 12 / 13 / 14 / 16
--nova-text-weight-normal/medium/strong   400 / 500 / 600
```

**不引入可变字重中间值。** 移植层的注释记录了原因：Figma 的 510 是 SF Pro 可变字体值，非可变 webfont 上会跨平台不可预测地吸附。

> 移植来的 `--dsw-font-*` 是 `font:` **简写**（`16px/24px <family>`），不是尺寸。拿它当 `font-size` 是静默 bug——所以 Nova 把轴分开命名，不做别名。7A 迁移时整条配方以 `--nova-font-*` 原形态迁入 `tokens/typography.css`（只迁有消费者的），拆解随组件重构批进行。

`2xs`（11px）是调色板换代时记名补入的密集档：代码块与紧凑标签的既有消费（约 24 处）需要它，非凑数。用户内容字号轴 `--nova-content-font-size`（12–17，主题 presenter 写在 body 上）及派生的 `-delta` / `-size-secondary` 也定义在 token 层。

### 2.5 Color（中性优先 + 单一强调色）

```text
--nova-color-accent    单一强调色（动作与选中）
--nova-color-success / warn / danger / idle
--nova-color-link
```

**无品牌渐变、无 glassmorphism。**

移植层记了一条必须继承的教训：`--dsw-alias-brand-primary` 在亮色下解析为**墨黑**，所有蓝色强调（发送键、选中页签、运行态、光标）都得改走 state-business 语义位。把强调色命名为 `--nova-color-accent` 并**只指向一次**，这个坑就从每个调用点上消失了——一个看起来像品牌色、实际是前景墨黑的 token，本身就是缺陷源。

**选中态必须与 hover 态可区分**（2026-10-18 补）。侧栏会话行原先两者共用同一个 `--nova-interactive-hover` 洗色，于是「我正在读的会话」和「指针恰好停住的那一行」是同一批像素：指针停在哪里都像一个第二选中项，而真正的当前会话没有任何标记。现在选中态走 `--nova-color-accent-soft` 填充 + 前缘 2px 强调色竖条，**这是侧栏里唯一出现强调色的地方**——正因为唯一，它才读得出「你在这里」。hover 保持中性洗色，天生低一档。

### 2.6 Surface / Border / Text

```text
--nova-surface-sunken / base / raised / panel / overlay
--nova-border-subtle / strong
--nova-text-primary / secondary / muted / faint / disabled / inverse
```

**~~已记名的事实~~ 已作废（2026-10-18 视觉重做）**：原先这里记的是「亮色下 `sunken`/`base`/`raised` 全是同一个近白色，所以三级平面在亮色里是退化的，靠描边而非填充分隔平面」。**这个判断看过成品后被推翻**——侧栏与正文渲染成同一张白纸，唯一的平面提示是一条 12% 透明度的 0.5px 发丝线；那不是 Quiet，是没做完。更坏的后果是每个组件为了自我区分各自去发明局部背景，正是 token 层要阻止的漂移。

现在的规则：

1. **平面阶梯在两套调色板里都单调**：`sunken < base < raised`（暗色同理，且 `sunken` 是**最暗**的一档——它原先比 `base` 还亮，名字和像素相反，是暗色读起来发平的单点根因）。档间约 3–5 个亮度点：够看见边缘，又不足以让面板读成卡片。
2. **平面是冷灰，不是暖灰**：中性色坐在 215 色相附近、饱和度只有几个点。**方向是蓝白，不是纸黄**——2026-10-18 有一版把中性色调暖（「纸」与「背光里的纸」），被操作者否决并要求改回。冷灰让白页读起来是白的而不是奶油色，同时平面之间仍有真实落差。阈值刻意压在人不会称之为「彩色」的下面——**强调色仍是全站唯一饱和的东西**。
3. **对比度有下限**：`secondary` / `muted` 承载 12–13px 描述文本，对自身平面必须 ≥ 4.5:1（旧亮色 `muted` 只有 **3.58:1**，在白底上看着完全正常）；`faint` 是注释档，守 ≥ 3:1 的大字门槛，否则它会塌进 `muted` 丢掉这一台阶。

这三条由 `ui/test/palette-guard.test.ts` 作为**关系型不变量**钉住（只断顺序、比值、互异性，不断具体色值——刻意重调调色板不该让它变红，只有顺序反转或跌破门槛才会）。

调色板换代（2026-10-11）后 `--nova-surface-*` 直接持值，并新增第五档 `--nova-surface-panel`：内容面板自持的底（侧栏行、模块面板），亮暗两套都有真实差异、16 处既有消费背书——它是收敛既有语义，不是凑数。文本色同理从三档扩到五档（`faint` 为更淡的注释文本、`disabled` 为禁用态），各有 40+ / 12 次既有消费背书。

### 2.7 Interactive（交互填充）

```text
--nova-interactive-hover           普通悬停洗色
--nova-interactive-hover-strong    强调悬停（更重的洗色）
--nova-interactive-active          按下 / 选中
--nova-interactive-hover-danger    危险操作的悬停洗色
```

全部是半透明值，叠加在所在 surface 上合成。四档均有移植层既有消费背书（99 / 13 / 13 / 3 次），从 dsw 的 `interactive-bg-*` 收敛而来。

### 2.8 ZCode 桌面端对齐（2026-11-14 拍板：完全一致优先）

操作者拍板「首页与 ZCode 桌面端代码层完全一致」，与 §2 开头「避免无意义阴影 / 小圆角」的旧表述冲突处以**完全一致优先**。参照值来自 ZCode UI 学习克隆仓（只读）的 `styles.css`（zai-light）与其首页实现，全部经 `--nova-*` token 落地：

1. **平面**：亮色 `base` = `rgb(248,248,248)`、`sunken`（侧栏）= `rgb(240,240,240)`、`raised`/输入卡 = 白；中性族色相从 16,24,40 移到 13,13,13。
2. **边框**：`subtle` = 5% / `strong` = 10% 的黑；composer 卡专用 `--nova-input-border`（10%）/ `hover`·`focused`（15%）。
3. **交互填充**：`hover` = 5% 黑（对齐 zai-light 的 `hover`/`selected`/`surface-hover` 同值档）。
4. **Composer 卡配方**（`palette-guard` 钉住，2026-11-14 二次修正为参照的两层结构）：**灰卡壳**（`--nova-surface-card` = 3% 黑，16px 圆角，**无边框**）背**大柔影** `--nova-elevation-card`（参照 `shadow-xl/5`）；**白芯**（`.sheet`，`--nova-surface-input`，16px 圆角）带 0.5px token 边框（hover/focus-within 加深）与紧双层阴影 `--nova-elevation-composer`（参照 `--shadow-composer-soft`），内距/行距 12px（参照 `p-3 gap-3`）。卡壳 6px 内距承载 header 灰条（参照 `p-1.5`）。发送钮 28px（参照 `icon-md` size-7）圆、ink 填充（参照 `bg-brand`=黑）、disabled 0.5、hover ink-hover（参照 `bg-brand/80`）。**这一档是「避免无意义阴影」的记名例外**——阴影来自参照原样，不是自创装饰。
5. **Hero 几何**：顶锚 `max(52px, 29dvh)`、内容列 672px（参照 max-w-2xl，卡 `w-full` 占满该列——hero 卡与列同宽 672，不接受任何内层克扣）、问候→卡间距 44px（参照 `sm:mb-8` 32 + dock `mt-3` 12）、问候语 30px 基线 / 20px 下限（参照同带）、文案逐字取参照六档；品牌线框（`HeroBackdrop`）400×320 锚在问候行中心、向上溢出（参照 `-mt-10` 结构），**1px 描边 + `text-muted` × 0.40**（参照 `text-foreground-subtlest` 即 40% 最强墨 × 自身 `opacity-70`，有效 28%；2026-11-15 定值，旧 0.7 是参照的 2.5 倍浓度，视觉上从水印变成徽标），为背景静态装饰，不抄 Z 字形（品牌是 Nova）。
6. **侧栏**：默认宽 264px；默认视图「按时间」（今天/昨天/N 天前/本周/上周/本月/更早，日历日语义）；条目两行化（标题 / 工作区·相对时间）；头部两控件（搜索 + 视图菜单，刷新收进视图菜单尾部）；折叠过渡 200ms `--nova-ease-panel`（参照 `duration-200 ease-out`）；底部稳态无连接状态文字（异常/重连态仍显示）。
7. **动画**（2026-11-14 核对参照源码）：hero 区自身**无出现动画**（参照同）；新建会话→会话态的 composer 落位入场见第 11 条；组件动画一律走 §4 既有 token。
8. **菜单与下拉**（同上批，逐值取自参照 `DropdownMenuContent` / `DropdownMenuItem` / `ModelConfigSelect`）：模型菜单卡固定 288px（参照 `w-72`），外壳 8px 圆角（参照 `rounded-lg`），条目 `min-height 32px` / 6px 圆角（参照 `min-h-8` + `rounded-md`，新增 `--nova-radius-xs` 档）/ `padding 4px 8px` / gap 8 / 标签 14px 400，勾选 16px 走 `text-muted`；分组标题 12px。入场 `--nova-dur-fast`：淡入 + `translateY(8px)` + `scale(0.95)`（参照 `fade-in-0 zoom-in-95 slide-in-from-bottom-2` / `duration-100`）。`Menu.module.css` 与 `MenuCard.module.css` 同值（守卫 `menu-surface.test.tsx` 同步改约，两处菜单不得漂移）。
9. **composer 工具行**：行 `items-end`，左侧组 4px、右侧组 6px 间距（参照 `gap-1` / `gap-1.5`，旧值 12px 是「散开的工具条」主因）；模型芯片 28px / 8px 圆角 / `padding 0 6px 0 8px` / 14px 主墨（参照 ghost Button `size=default` 覆盖为 `pl-2 pr-1.5`）；权限芯片 32px / 8px / `padding 0 8px 0 12px` / 14px / 400（参照 `ConfigSelect` ghost `size=lg`：`h-8 rounded-lg pl-3 pr-2`），前导图标 16px、chevron 14px；两者 hover 与展开同填充、`transition: background-color 120ms`（参照 `transition-colors` + `aria-expanded:bg-hover`）。
10. **设置页**：内容列首块为节标题 24px/600（参照 `text-ui-settings-title`，行高 32、负字距）；分节改**卡片组**（1px `border-strong`、12px 圆角、白底、`overflow: hidden`）；行 `grid minmax(0,1fr)/192px`、`padding 12px 16px`、分隔线在行**上**边且首行不画、标签 14/500、说明 14/24 `text-secondary`（旧为 12/18 `muted`）；各节页头/搜索/横幅补 16px 卡片内距（原先按「贴面板」设计）。导航行 32px、当前行与 hover 同一 5% 填充、**取消**强调色轨与强调色图标（参照 `SettingsSidebarButton` 无强调色）。面板改参照 dialog 配方：16px 圆角 + 1px 边 + `--nova-elevation-prominent` + `zoom-in-95` 120ms 入场，遮罩 `rgba(0,0,0,.6)` + 2px 模糊（`--nova-material-mask` 同批改值），导轨与内容之间 1px 实线（原为渐变）。
11. **新建会话→会话态**：composer 落位入场 260ms `--nova-ease-out`，`translate3d(0,32px,0) scale(0.96)` → 归一（参照 `ConversationBottomDockTransition` 的 32 / 0.96 / 260ms 与 `cubic-bezier(0.23,1,0.32,1)`，用 `--nova-ease-out` 承载）；**只**在 hero/settling → active 时触发（参照 `AnimatePresence initial={false}`：直接打开既有会话不动），由 `docs` 外的 `ConversationRoot` `data-dock-entering` 标记。
12. **侧栏分界**：去掉侧栏列 0.5px 右边框，只靠 `sunken` 与 `base` 的底色差（参照两侧栏无分隔线）。
13. **Hero 建议 chips**（2026-11-15，逐值取自参照 `ConversationDraftSuggestedPrompts` + `.zcode-draft-prompt-waterfall`）：卡片下方 24px（参照 `mt-6`）居中四枚芯片；chip 32px 高 / 8px 圆角 / `padding 0 12px` / 14px 400 / 1px `border-strong` / gap 16；图标与文字 `opacity .7`，hover 升到 1 并换 `--nova-input-border-hover`；入场 `nova-chip-waterfall` 260ms `--nova-ease-out`，按 index × 65ms 阶梯，从 12px 上方 + 顶部裁切擦除落位（参照 `clip-path: inset(0 0 100% 0)` → `0`，**这是全仓唯一触碰 `clip-path` 的动画，记名例外**：擦除是「贴上去」的手感来源，只留淡入会丢参照的质感）。点击语义 = 参照 `replacePlainPrompt`：**只替换草稿、把光标放到末尾，从不发送**（`composer/external-input.ts` 的 `useDraftRequest`，`seq` 键让同一枚芯片可连点）。catalog 链路未移植，四项文案/提示词是本地常量（周报总结 / 报错修复 / PPT 制作 / 闲时任务）。
14. **侧栏会话行与分组**（2026-11-15）：当前行与 hover **同一 5% wash**（参照 `--color-selected` 与 `--color-surface-hover` 同值；旧的 12% 强档在参照旁读成「填色卡片」，`palette-guard` 同步改约）；「任务列表」标题 14/500（参照 `text-ui-base font-medium`，旧继承 400 比其下的日期分组还轻）；条目第二行（工作区 · 时间）14px/20（参照 `text-ui-base text-foreground-subtle`，旧值 12/16 是缩小版）。**主区「最近工作」列表退役**：参照的空态只有线框 / 问候 / 卡 / chips，而侧栏已承载全量任务列表，第二份同源列表让一屏出现两套会话索引并把 hero 挤离中心。
15. **窗口框架与面板层次**（2026-11-15，参照 `DesktopWindowFrame` + `WorkspaceShellLayout`）：窗口底 = `sunken`，侧栏**不画自己的底色**（骑在窗口底上），工作区列是一张 `base` 底 + 1px `border-strong` + 12px 圆角的**面板**，左缘留 6px 窗口底——这就是「侧边栏和主页面分离」的修复：参照的侧栏与页面是同一层地面 + 一块浮起的面板，不是两块平铺色块。右栏同一配方（四边 6px inset、12px 圆角、1px 边）。
16. **无边框窗口**（2026-11-15）：桌面壳 `decorations: false`，窗口控件（最小化 / 最大化·还原 / 关闭）由 WebUI 画在窗口右上角（`shell/WindowControls`，仅 Tauri 环境渲染，走 `plugin:window|*` 命令；capabilities 的 `remote.urls` 授予 127.0.0.1 源这些命令）。侧栏顶行与设置页顶条带 `data-tauri-drag-region` 承担拖拽。参照同理：它的标题栏控件画在内容区右上（`y≈33`），内容从窗口 `y=0` 开始——Nova 原先的系统 caption 让整页比例比参照矮 30px。
17. **插件页**（2026-11-15，参照 `PluginStoreListView` / `PluginStoreCard`）：列表改**双列卡片网格**（容器 ≥40rem 起两列、列距 24、行距 4）；单卡 12px 圆角 / `padding 12px 8px` / 无边框 / hover 才上底色；40px 图标块（12px 圆角）、名称 14/500、描述 13px 单行截断；分组标题 16/500 + 1px 底线（参照 `text-ui-lg font-medium` + `h-px`）。
18. **设置页**（2026-11-15 二次修正，参照 `WorkspaceSettingsLayer` / `SettingsPage`）：**整页视图，不是模态**——无遮罩、无居中 800px 面板；窗口底 `sunken` 上浮一张 `base` 面板（6px inset、1px 边、12px 圆角），左导航 268px（1px 分界）+ 内容列 `max-w-896` 居中（用左右 padding 居中，滚动条留在列边）；导航顶部「← 返回工作区」灰底行取代对话框右上角的 ×；内容列改为**按语义分卡**（参照「常规」页每卡一组），卡间距 16。
19. **对话流**（2026-11-15，参照 `ConversationRowView` / `Reasoning`）：**默认不再把完成的回合折成一行摘要**——`standard` 档 `foldCompletedTurns: false`、`stepGrouping: none`，工作行直接铺在提问与回答之间（参照的转录没有「用时 X」横条）；没有工作步骤的回合**不渲染 header**（运行中仍显示进度）。工作行字号 13 → **14**（参照 `text-ui-base`）。思考行文案取参照：运行中「正在思考」+ 流光，完成「思考 持续了 N 秒」（时长从首帧流式起算）；内容区 240px 上限内滚动、左侧 1px 竖线 + 14px 内距（参照 `max-h-60 ml-2 border-l pl-3.5`）；流式结束自动收起（用户手动展开过则不收）。
20. **侧栏顶部与字体**：logo 行 60 → **48px**（参照 `h-12`）并补 12px 下边距；导航区与任务列表之间加 1px `border-subtle` + 12px 上边距（参照 `border-t border-border/50 pt-3`）；字体栈在 `Microsoft YaHei` 前插入 **`Microsoft YaHei UI`**——Windows Chromium 为参照的 `system-ui` 解析到的正是这一支，字面更紧、行内更轻。
21. **右栏「新标签页」**（2026-11-15，参照 `AnimatedSidePanePanel` 的 open-tab launcher + `SidePaneLauncherRow`）：旧的居中罗盘 + 380px 药丸列退役；改为**顶部对齐滚动、`px-7 py-6`（28/24）内距、`max-w-3xl` 列、24px 列间距**，页头 18px/600 左缩进 8px；条目为整行按钮 `gap-12 rounded-12 padding 10/8`，**48px 图标块**（`--nova-surface-base` 底 + 24px 图标）、标题 14/600、描述 12 muted、行尾「打开」胶囊（28px 高、full 圆角、`surface-sunken`；深色用 10% 白）。终端行保留 chevron 开 shell 菜单（参照无 shell 选择，此为 Nova 功能，记录偏差）。
22. **外观独立成页**（同日，参照设置页的 `appearance` 分区）：主题与界面字号从「常规」移入独立「外观」nav 分区；常规只剩权限与工作步骤展示。
23. **轮次头与上下文环**（同日，参照 `AssistantHistoryStatus` / `ChatContextUsage`）：轮次头字号 13 → **14px**，chevron 14 → 16px 且改**右向 + 展开 rotate-90**；settled 文案改「已工作 X」（无时长「已处理」），时长格式取参照 `formatConversationWorkDuration`——**最多两个单位、单位间空格、四舍五入从 1 秒起**（`1 时 2 分`，不再 `1小时02分05秒`）。上下文环从**卡片下方 dock 行移入 composer 右侧动作区首位**（模型座位左侧），去掉环旁百分比文本，只保留 28px ghost 按钮 + 14px 环；环的门控与参照一致：**分子或窗口未知都不渲染**（不再出现「0%」）。
24. **composer 行高与控件**（同日）：输入行 24 → **20px** 行高（`text-ui-base leading-5`），输入区最小高 44 → **40px**（`min-h-10`）；权限 chip 32 → **28px**、两端 8px 内距、gap 4（`V4ComposerModeControls` 的 `h-7 px-2`）；工作区 chip 改 **full 圆角 pill**、14px/400、padding `0 8 0 12`、folder 引用 muted 档、chevron 12 → 14px；chips hover 底从实心白改 **`bg-input/50`**。
25. **变更页行几何**（同日，参照 `GitPaneChangeRow`）：文件行 28 → **32px**（`h-8`），文件名与目录名 12 → **14px**（目录 600），文件名不着 git 色——状态色属于行尾增删统计（Nova 的字母徽标保留）。
26. **会话页头部**：标题字重 500 → **600**（`font-semibold`）；头部动作区 gap 8 → **2px**（`gap-0.5`）；草稿/首页态头部**不再画底边线**——参照的 draft 变体是 `border-transparent`（此前注释自称「同款 hairline」与源码相反，本批修正）。
27. **侧栏与深色梯子**（同日，参照 `timelineDates` / `TaskListItem` / `WorkspaceSidebarFooter`）：时间线补 **「上月」桶**（today→yesterday→天前→本周→上周→本月→上月→更早）；侧栏会话行的前置槽高度 20 → **16px**（`size-4`）；导航激活行改用 **selected 洗色**（`--nova-interactive-active`，深色 10%）而非 hover 5%；身份头像补 1px 内嵌描边。深色 token 两处按参照校准：`--nova-interactive-hover` 5% → **10% 白**（参照深色 hover 与 selected 同值）、`--nova-border-subtle` 8% → **5% 白**（`border-border/50` 在两主题同值）。
28. **设置列表几何**（同日，参照插件市场 / Skill / Switch）：插件卡、图标块、折叠钮、空态圆角 16 → **12px**（`rounded-xl`）；搜索框左内距 32 → **36px**（`pl-9`）、动作钮去边框改填充（secondary 无边框）；插件页节间距 24 → **20px**（`space-y-5`）、Skill 页 16 → **24px**（`space-y-6`）、组头高度 **28px**；Skill 行分隔线与行内分隔改为 50% 边；Switch 补 **`::after` 命中区扩展**（左右 12 / 上下 8，参照 `after:-inset`）。
29. **对话排版**（同日，参照 `message.tsx` / `code-block.css` / `ToolSummaryRow` / `reasoning`）：助手正文行高 1.5 → **1.75** 并加 `0.025em` 字距（参照 `leading-[1.75] tracking-wide`）；inline code 圆角 16 → **6px**、去边框、padding **6/2**、2px 行内边距；围栏代码块圆角 16 → **12px** 并补 1px 边，代码字号 11/19 → **12/20**、头行 11 → **14px**；工具摘要行字号 13 → **14px**（`text-ui-base`）；思考体 13 → **14px** 且改用最浅墨（`text-foreground-subtlest`）；过程分组最大高 400/50vh → **504px**（`16lh + 120px`）。

**有意偏离（记名，勿当 bug 修回）**：不做「自动化」导航项与 composer 的 agent 下拉 / git 分支 / worktree / 麦克风（Nova 无对应功能，造出来是死 UI）；深色主题不逐值抄 ZCode dark（只随共享槽位联动，待拍板）；菜单材料仍是 Nova 的半透明 `--nova-surface-menu` + 40px 背景模糊（参照是**不透明白** `bg-menu`），是否转不透明待拍板。建议 chips 已于 2026-11-15 实现（见第 13 条），唯一偏离是文案/提示词为本地常量而非服务端 catalog；设置页已于同日改为整页视图（见第 18 条），不再作为模态偏离项。

## 3. Token 命名规范

```text
--nova-<类别>-<语义>[-<变体>]
```

| 类别 | 例子 |
| --- | --- |
| `space` | `--nova-space-8` |
| `radius` | `--nova-radius-md` |
| `shadow` | `--nova-shadow-2` |
| `elevation` | `--nova-elevation-panel`（描边+柔光复合，见 §2.3） |
| `dur` | `--nova-dur-base` |
| `ease` | `--nova-ease-out` |
| `surface` | `--nova-surface-raised` |
| `border` | `--nova-border-subtle` |
| `interactive` | `--nova-interactive-hover`（交互填充，见 §2.7） |
| `text` | `--nova-text-secondary` |
| `color` | `--nova-color-accent` |

**禁止**在业务组件里出现：

```text
padding / margin / gap 的 px 字面量
border-radius 的 px 字面量
box-shadow 字面量
animation / transition 的 ms 字面量
字面缓动词（ease / ease-out / linear / cubic-bezier(...)）
```

## 4. Motion Policy

### 4.1 时长与缓动（已落地，见 `design/tokens/motion.css`）

```text
--nova-dur-instant   0ms
--nova-dur-fast      120ms
--nova-dur-base      180ms
--nova-dur-slow      260ms

--nova-ease-out      （入场）
--nova-ease-inout    （环境循环）
--nova-ease-spring   （有节制的弹入）
```

### 4.2 允许动画的属性

```text
opacity
transform
```

**只有这两个。** 全部走合成器，不触发 layout / paint。

### 4.3 分场景规则

| 场景 | 允许 | 不允许 |
| --- | --- | --- |
| **Streaming** | opacity、cursor、小的状态过渡 | 整个 Message 高度持续动画；Conversation layout transition；Tool Card 每次 token 重新 animate |
| **Layout** | —— | **默认不动画** |
| **Sidebar** | 一次性展开/收起 | 持续跟随 |
| **Modal** | 进入/退出 | —— |
| **Tool** | 状态变化的极短过渡 | 每次输出增长都 animate |
| **消息落地** | `nova-fade-up`（挂 `.flowItem`，仅 mount 时一次） | 按 token 增长重播；对已挂载行重跑动画 |
| **节奏变化** | `margin-top` 过渡（`--nova-dur-fast`），折叠/落定时的重排 | 无过渡的瞬跳（读作渲染故障） |

#### 4.3.1 「有 60 处 animation 却感觉完全静止」的教训

本仓曾有 60+ 处 animation 引用，但**每一处都属于折叠体**（展开 turn、揭示 reasoning）。
消息真正落地时一个都没有——所以一条正在运行的对话读起来是静止的。

> **动效覆盖率不能按引用数衡量，要按「读者能看见的状态变化种类」衡量。**
> 折叠是读者**主动触发**的变化，落地是**系统推送**的变化，两类都要有，缺一类就有一半是静的。

`palette-guard.test.ts` 的 `a mounted transcript row animates in` 钉住这条。
该守卫首版**漏报**：它的断言匹配到了规则注释里提到的 keyframe 名，即使 `animation:` 声明已被删掉也能通过。
现在先剥离注释再断言**声明本身**——注释不是实现。

> **动画表达状态变化，而不是表达"这里用了 React"。**

Coding Agent UI 最忌讳的是同时存在：message fade + tool slide + card expand + layout transition + height animation + streaming animation + sidebar animation + modal animation。结果是**页面一直在动**。

### 4.4 reduced-motion

保留现有实现：`design/motion.css` 底部的全局钳制是**唯一 off-switch**，单个模块不必重复守卫。

## 5. Guard 规则

Token 纪律由**机器守卫**执行，不靠 review。

| 守卫 | 位置 | 管什么 |
| --- | --- | --- |
| 字面颜色 / 死类 / svg 设计盒 / **禁止任何 `--dsw-*`/`--ds-*`/`--dsh-*` 出现** | `ui/test/style-guard.test.ts` | 翻转后规则（7A 收口） |
| 动效表挂载 / 共享 keyframe / reduced-motion 钳制 | `ui/test/motion-guard.test.ts` | 既有规则，保留 |
| spacing / radius / shadow / duration / ease 字面量棘轮 | `scripts/ui-token-guard.mjs`（在 `pnpm gates` 内） | **本批新增** |

### 5.1 五条规则

```text
① spacing    padding / margin / gap 不得出现非零 px 字面量
② radius     border-radius 不得出现 px 字面量
③ shadow     box-shadow 不得出现字面量（`none` 与纯 `var()` 不算）
④ duration   transition / animation 不得出现 ms / s 字面量
⑤ ease       同上声明不得出现字面动词或 cubic-bezier()
```

判据细节：`var(--name` 的**名字**先被剥掉（否则 `var(--nova-ease-out)` 里的 `ease-out` 会被误判为字面缓动），但 `var()` 的 **fallback 保留计数**——`var(--ds-ease-in-out, ease-in-out)` 的兜底值是会真生效的字面量。

### 5.2 Exception 清单（**封闭集合，不得随意扩充**）

**允许**保留字面值：

```text
border-width / outline-width      （1px 是视觉原子值，token 化无意义）
hairline 相关的 1px
icon size
SVG 绘制尺寸（stroke-width / stroke-dasharray / viewBox）
特殊图形几何（环、进度条、画布坐标等按几何算出的值）
```

五条规则的属性清单**刻意不含**这些，所以 `border: 1px solid …`、`stroke-width: 1.5`、`width: 16px` 都不会被计。

**禁止**为了凑数而新增 token：

```text
✗ --nova-space-editor-inline-special-1
✗ --nova-radius-tool-mini
✗ --nova-gap-composer-command-x
```

> **Guard 的目标是减少无意义的设计决策，而不是减少字面量数量。**
> 一个为凑数而生的 token 比硬编码更糟。

### 5.3 全仓上限

`scripts/ui-token-baseline.json` 只记 **每条规则的全仓总数上限**（5 个数字），不记逐文件账本：

```text
spacing 185 · radius 43 · shadow 18 · duration 105 · ease 99
```

上限 = 当前债务 + 余量（spacing 20、radius 10、shadow 6、duration 12、ease 12）。日常改动落在余量里，门禁不吭声；只有整仓债务系统性上涨才红。

**为什么不是逐文件计数**：上一版按「文件 × 规则」记 75 条，后果是**新建任何 sheet 只要写 1 个 px 就红**——那衡量的不是设计系统有没有被遵守，而是账本有没有跟上。作者只能靠 `--update` 记账，而记账与债务本身无关。

放宽仍是一次显式、diff 可见的动作（`--update` 逐条打印 `(RAISED)`）；余量快用完时会打印提示——那是提示，不是失败。

**禁止**把上限改成几千行的白名单——那等于把守卫变成新的技术债。

## 6. 视觉层级禁令

> **Component boundaries are code boundaries, not necessarily visual boundaries.**

代码可以拆组件，**视觉上不一定要拆成卡片**。

禁止：

```text
❌ Card
  ❌ Card
    ❌ Card
      ❌ Card
```

如果一个组件已经有 `surface` + `border` + `spacing`，就**不要**再套 `background` + `shadow` + `radius` + `padding` 来证明它是一个"组件"。

## 7. 迁移策略

```text
Freeze（Batch 1）  →  Migrate（Batch 7A / 7B / 8）  →  Delete（Batch 10）
```

| 阶段 | 做什么 | 状态 |
| --- | --- | --- |
| **Batch 1** | 定稿本文件 + 建立 token 层 + 扩守卫 + 删 Tailwind 死依赖。**不迁移业务 UI** | ✅ 已落地 |
| **Batch 2–6** | 只允许**新代码**使用 `--nova-*`；旧 CSS 原样存在，不改 | ✅ |
| **Batch 7A** | 结构迁移，**不改视觉** | ✅ 2026-10-11（radius/时长按冻结方向收敛，记名见纲领 G7a） |
| **Batch 7B / 8** | 大规模迁移到 `--nova-*`，基线逐批下降 | ✅ 2026-10-11（消费层清零；基线下降留组件重构批） |
| **Batch 10** | 删除 `--dsw-*` 与 `styles/design-platform.css`，把色值内联进 `design/tokens` | ✅ 2026-10-11（`styles/` 七文件全删） |
| **Batch 11** | 构建管线换 Next.js（`output: 'export'`），Tailwind v4 以 `@theme inline` 挂到 `--nova-*` | ✅ 2026-10-20 |

> **Batch 1 删掉的 Tailwind 与 Batch 11 重新引入的 Tailwind 不是同一件事。**
> 前者是 `v4 + 插件 + 0 使用` 的死依赖：装了、挂了、没有任何一处读它，因此删除。
> 后者有明确消费者——`src/ui/` 的 Aceternity 组件层——并且经 `@theme inline`
> 把工具类映射回既有 token，不携带第二套色值。判据始终是「有没有真实消费者」，
> 不是「Tailwind 本身好恶」。
>
> `@theme inline` 不可换成 `@theme`：非 inline 会把亮色值烤进生成的工具类，
> 于是 `body[data-nova-dark]` 对 Aceternity 层完全失效，暗色主题下这一层永远亮着。

> **设计语言可以晚迁移，但不能晚定义。** 否则 Agent 会在"半套设计系统"上继续写 UI，最后形成新的过渡泥潭。

## 8. 落地位置

```text
packages/web/ui/src/design/
├── index.css              唯一挂载表（token 层 + keyframes + 全局 paint 规则）
├── motion.css             共享 keyframes + reduced-motion 全局钳制
├── corner-shape.css       superellipse 圆角（@supports 守卫）
├── focus.css              focus-visible 环规则
├── scrollbar.css          滚动条皮肤（几何变量是重绑点）
└── tokens/
    ├── space.css          --nova-space-* / --nova-row-*
    ├── radius.css         --nova-radius-*
    ├── shadow.css         --nova-shadow-* / --nova-elevation-*
    ├── surface.css        --nova-surface-* / --nova-border-* / --nova-interactive-* / material / scrollbar / focus-ring
    ├── text.css           --nova-font-family/mono / --nova-text-* / --nova-content-font-*
    ├── color.css          --nova-color-*（含 ink / soft / chart）
    ├── motion.css         --nova-dur-* / --nova-ease-*
    ├── typography.css     --nova-font-*（font: 简写配方，非尺寸）
    ├── diff.css           --nova-diff-*（added/deleted 三层 + line 洗色）
    └── shiki.css          --shiki-*（语法高亮调色板）

packages/web/ui/src/kit/       标准可复用组件（消费上面的 token，自身零字面色）
├── Dialog.tsx/.module.css     弹窗骨架：overlay/mask/panel/title/body/footer + 入场动画单处声明
├── Button.tsx/.module.css     动作按钮：secondary / primary(墨填充) / dangerOutline 三档意图
└── IconButton.tsx/.module.css 图标按钮：28/24px 方形、radius-sm、inset 焦点环、active/danger

packages/web/ui/src/ui/        Aceternity 组件层（Batch 11；唯一允许写 Tailwind 工具类的地方）
├── cn.ts                      clsx + tailwind-merge 的类名合并
├── aurora-background.tsx      极光 + 网格场景层（定位由调用方决定，见文件内注释）
├── glow-card.tsx              1px 渐变发丝环卡片（RADIUS 表驱动，内外弧必须同档）
└── glow-button.tsx            accent / ghost / outline 三档按钮
```

**两层的分工不可混用**：`src/kit/` 是**结构**（弹窗骨架、按钮意图档位），写 CSS Modules、零字面色；`src/ui/` 是**材质**（极光、发丝环、辉光），写 Tailwind 工具类但全部经 `@theme inline` 映射回 `--nova-*`。一个组件需要新的结构时用 kit，需要新的表面质感时用 ui，不要把两者混成一个。`src/ui/` 之外的 `.tsx` 继续只用 CSS Modules。

**为什么从 `app/page.tsx` 挂载**:`main.tsx` 与 `index.html` 已在 Next.js 迁移中删除;`app/layout.tsx` 是挂载文档(`<head>` 元数据、boot 脚本、`#root`),`app/page.tsx` 是客户端入口。`src/index.css` 是移植层遗留挂载表,`design/index.css` 是它的继任者,`src/tailwind.css` 必须**最后**挂载——一个文件两个写手正是上一轮丢编辑的成因。

**主题挂点**：暗色面板 = `body[data-nova-dark]`，由 `theme.ts` 在挂载后写、由 `app/layout.tsx` 的 pre-paint 内联脚本在首帧前写（两者一致性由 `test/theme.test.ts` 钉住，且该脚本由 `boot-theme.ts` 的 `bootThemeScript()` 单一生成，布局只调用不抄写）。2026-10-11 起属性名与内容字号轴（`--nova-content-font-*`）均为 Nova 命名，不再是移植层的 `data-ds-dark-theme` / `--dsh-content-font-*`。

## 9. Motion 调和（已收口，2026-10-11）

`styles/motion.css` 已删除。收口动作按本文件既定方案执行：

```text
1. ease/dur token 迁入 design/tokens/motion.css，三个共享 keyframe 与 reduced-motion
   钳制迁入 design/motion.css；
2. 值按 §4.1 收敛（instant 0ms / fast 120ms / base 180ms / slow 260ms）——操作者未另行
   裁定，Normative 值生效；既有 140/220/400 的差异（20–60ms）在感知阈值内；
3. styles/motion.css 整表删除；
4. motion-guard.test.ts 的挂载断言改指 design/index.css 与两个新 sheet。
```

既有消费者（`nova-fade-up` / `nova-pop-in` / `nova-draw` 的引用点）带 fallback 字面量，不受影响；fallback 属于 token 债务，随批次 7A 的消费迁移一并清除。

## 10. 待操作者复核的事项

方向（中性优先 + 单一 accent + 暗色一等公民 + 密度优先 + 小圆角 + opacity/transform-only 动效）**已冻结**。以下具体值已按方向落地，复核时可改：

- accent 的色相（深蓝，亮色 rgb(65,118,230) / 暗色 rgb(122,170,255)，沿用移植层取值）；
- 中性面的冷暖倾向（沿用 bluish 系）；
- 语义色的具体取值（沿用移植层）；
- 三级阴影与 elevation 复合配方的具体数值（沿用移植层）；
- motion 时长按 §4.1 收敛为 120/180/260（如需回到 140/220/400 在此改）。

调色板换代（2026-10-11）**保持值不变、只换所有权**：`--nova-*` 直接持值，不再桥接 `--dsw-*`；移植层 `styles/` 七文件已全部删除，消费层零旧词残留（`style-guard` 翻转为禁令）。
