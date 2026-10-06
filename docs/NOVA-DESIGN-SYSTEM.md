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

## 1. 与 dsh 参照的关系（已拍板）

现有调色板与排版移植自 `deepseek-harness`（MIT 授权，`design-platform.css` 文件头有署名）。**自 0.5.0 起 Nova 另起自己的设计语言**：

- `docs/dsh-parity-inventory.md` 降级为**历史参照**，不再是验收口径；
- `--dsw-*` 只作为**过渡底座**存在，最终在 Batch 10 删除；
- 从 Batch 1 起，**`--dsw-*` 不再是任何新代码的契约**。

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
--nova-space-12   12px
--nova-space-16   16px
--nova-space-24   24px
--nova-space-32   32px
```

行高：

```text
--nova-row-sm    24px
--nova-row-md    28px
--nova-row-lg    32px
```

### 2.2 Radius（小圆角）

```text
--nova-radius-sm     4px
--nova-radius-md     6px
--nova-radius-lg     8px
--nova-radius-full   9999px   ← 只给天然是圆形的形状（状态点、头像），不是做胶囊的途径
```

**比移植来的 `--dsw-radius-*`（4/8/12/16/20/28）刻意小一档。** 28px 行上放 12–16px 圆角就读成卡片，而卡片套卡片正是本系统要终止的视觉层级。

### 2.3 Elevation（最多三级）

```text
--nova-shadow-1 / 2 / 3
```

**停靠列（右侧 Inspector）不画阴影**——它是一页的列，不是浮起来的卡。这条 `ui/test/style-guard.test.ts` 已钉住，保留。需要第四级说明是层级设计有问题，不是高度不够。

### 2.4 Typography

```text
--nova-text-size-xs/sm/md/lg        12 / 13 / 14 / 16
--nova-text-weight-normal/medium/strong   400 / 500 / 600
```

**不引入可变字重中间值。** 移植层的注释记录了原因：Figma 的 510 是 SF Pro 可变字体值，非可变 webfont 上会跨平台不可预测地吸附。

> 移植来的 `--dsw-font-*` 是 `font:` **简写**（`16px/24px <family>`），不是尺寸。拿它当 `font-size` 是静默 bug——所以 Nova 把两个轴分开命名，不做别名。

### 2.5 Color（中性优先 + 单一强调色）

```text
--nova-color-accent    单一强调色（动作与选中）
--nova-color-success / warn / danger / idle
--nova-color-link
```

**无品牌渐变、无 glassmorphism。**

移植层记了一条必须继承的教训：`--dsw-alias-brand-primary` 在亮色下解析为**墨黑**，所有蓝色强调（发送键、选中页签、运行态、光标）都得改走 state-business 语义位。把强调色命名为 `--nova-color-accent` 并**只指向一次**，这个坑就从每个调用点上消失了——一个看起来像品牌色、实际是前景墨黑的 token，本身就是缺陷源。

### 2.6 Surface / Border / Text

```text
--nova-surface-sunken / base / raised / overlay
--nova-border-subtle / strong
--nova-text-primary / secondary / muted / inverse
```

**已记名的事实**：亮色下 `bg-layer-1/2/3` 全是同一个近白色，所以 `sunken` / `base` / `raised` 在亮色里**当前是退化的**——亮色靠描边而不是填充分隔平面（这恰好符合 Quiet / Neutral 方向）；暗色下才真有阶梯（875/850/800）。调色板换代时把亮色阶梯分开；在那之前，组件**不得靠填充差异承载语义**。

## 3. Token 命名规范

```text
--nova-<类别>-<语义>[-<变体>]
```

| 类别 | 例子 |
| --- | --- |
| `space` | `--nova-space-8` |
| `radius` | `--nova-radius-md` |
| `shadow` | `--nova-shadow-2` |
| `dur` | `--nova-dur-base`（见 §9，尚未落地） |
| `ease` | `--nova-ease-out`（见 §9，尚未落地） |
| `surface` | `--nova-surface-raised` |
| `border` | `--nova-border-subtle` |
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

### 4.1 时长与缓动（方向已定，值待 §9 调和后落地）

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

> **动画表达状态变化，而不是表达"这里用了 React"。**

Coding Agent UI 最忌讳的是同时存在：message fade + tool slide + card expand + layout transition + height animation + streaming animation + sidebar animation + modal animation。结果是**页面一直在动**。

### 4.4 reduced-motion

保留现有实现：`styles/motion.css` 底部的全局钳制是**唯一 off-switch**，单个模块不必重复守卫。

## 5. Guard 规则

Token 纪律由**机器守卫**执行，不靠 review。

| 守卫 | 位置 | 管什么 |
| --- | --- | --- |
| 字面颜色 / 死类 / svg 设计盒 / `--dsw-*` 必须已声明 | `ui/test/style-guard.test.ts` | 既有规则，保留 |
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

### 5.3 基线棘轮

`scripts/ui-token-baseline.json` 按 **文件 × 规则** 记当前计数，**只许减少**：

```text
spacing   767  →  …  → 0
radius     82  →  …  → 0
shadow     12  →  …  → 0
duration  129  →  …  → 0
ease      111  →  …  → 0
```

机制与 `scripts/structure-budget.mjs` 同哲学：**任何放宽都必须是一次显式、diff 可见的动作**（`--update` 逐条打印 `(RAISED)`），而不是随手绕过。低于基线的条目每次运行都会打印为"可收紧"——那是棘轮该往下走的提示，不是失败。

**禁止**让基线变成一张几千行的白名单——那等于把守卫变成新的技术债。

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
| **Batch 2–6** | 只允许**新代码**使用 `--nova-*`；旧 CSS 原样存在，不改 | 进行中 |
| **Batch 7A** | 结构迁移，**不改视觉** | 待 |
| **Batch 7B / 8** | 大规模迁移到 `--nova-*`，基线逐批下降 | 待 |
| **Batch 10** | 删除 `--dsw-*` 与 `styles/design-platform.css`，把色值内联进 `design/tokens` | 待 |

> **设计语言可以晚迁移，但不能晚定义。** 否则 Agent 会在"半套设计系统"上继续写 UI，最后形成新的过渡泥潭。

## 8. 落地位置

```text
packages/web/ui/src/design/
├── index.css              挂载表（由 main.tsx 在 index.css 之后挂载，Nova token 覆盖移植层）
└── tokens/
    ├── space.css          --nova-space-* / --nova-row-*
    ├── radius.css         --nova-radius-*
    ├── shadow.css         --nova-shadow-*
    ├── surface.css        --nova-surface-* / --nova-border-*
    ├── text.css           --nova-text-size/weight/* + 文本色
    └── color.css          --nova-color-*
```

**为什么从 `main.tsx` 挂载而不是追加进 `index.css`**：在途的 motion 批次正在改 `index.css`（一行 `@import`）并拥有 `styles/motion.css`，一个文件两个写手正是上一轮丢编辑的成因。`index.css` 是遗留挂载表，`design/index.css` 是它的继任者。

## 9. Motion 调和（**待办，明确记名**）

`--nova-dur-*` / `--nova-ease-*` **尚未进入 `design/`**，原因是命名冲突：在途批次已在 `styles/motion.css` 声明了这两个前缀，值是 `fast 140ms / base 220ms / slow 400ms`，而本文件批准的方向是 `120 / 180 / 260` 且多一个 `instant` 档。

两个 sheet 声明同一个自定义属性，正是本层存在的意义所要终止的漂移——所以**不叠上去**。

调和动作（在该批次落地后执行）：

```text
1. 把 styles/motion.css 的 ease/dur 与三个共享 keyframe 迁入 design/motion/；
2. 值按 §4.1 收敛（120/180/260 + instant 0ms），或经操作者裁定沿用 140/220/400；
3. styles/motion.css 只留 reduced-motion 钳制，或整表并入 design/motion/；
4. motion-guard.test.ts 的挂载断言改指 design/index.css。
```

## 10. 待操作者复核的事项

方向（中性优先 + 单一 accent + 暗色一等公民 + 密度优先 + 小圆角 + opacity/transform-only 动效）**已冻结**。以下具体值已按方向落地，复核时可改：

- accent 的色相（当前指向移植层的 state-business，即深蓝）；
- 中性面的冷暖倾向（当前沿用 bluish 系）；
- 语义色的具体取值（当前沿用移植层）；
- 三级阴影的具体数值（当前沿用 `--dsw-shadow-lv1/2/3`）；
- §9 的 motion 取值二选一。
