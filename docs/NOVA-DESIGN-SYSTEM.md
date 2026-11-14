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
4. **Composer 卡配方**（`palette-guard` 钉住）：16px 圆角（`--nova-radius-lg`）+ 0.5px token 边框 + 白卡底 + `--nova-elevation-composer`（`0 1px 3px rgb(0 0 0/4%), 0 6px 18px rgb(0 0 0/4%)`；暗色为 0 阴影、随共享槽位联动）。**这一档是「避免无意义阴影」的记名例外**——阴影来自参照原样，不是自创装饰。
5. **Hero 几何**：顶锚 `max(52px, 29dvh)`、内容列 672px（参照 max-w-2xl）、问候语 30px 基线 / 20px 下限（参照同带）、文案逐字取参照六档；品牌线框（`HeroBackdrop`）为背景静态装饰，不抄 Z 字形（品牌是 Nova）。
6. **侧栏**：默认宽 264px；默认视图「按时间」（今天/昨天/N 天前/本周/上周/本月/更早，日历日语义）；条目两行化（标题 / 工作区·相对时间）。

**有意偏离（记名，勿当 bug 修回）**：不做建议词条 chips（无服务端 scenes 链路，本期不立项）；不做「自动化」导航项与 composer 的 agent 下拉 / git 分支 / worktree / 麦克风（Nova 无对应功能，造出来是死 UI）；深色主题不逐值抄 ZCode dark（只随共享槽位联动，待拍板）。

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
