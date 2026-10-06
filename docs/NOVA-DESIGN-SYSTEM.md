# NOVA 设计系统规范（Design RFC 草案）

> **文档状态**：**DRAFT / RFC——待审批，非契约**
> 本文件当前是**提案**。Batch 1 定稿并**经用户批准后**才成为约束；批准前不得据此迁移任何业务 UI。
> 结构规范见 `NOVA-UI-ARCHITECTURE.md`。

---

## 0. 为什么需要这份文件

Nova WebUI 的视觉问题不是"不好看"，而是**没有单一决策来源**：

| 指标 | 现状 | 证据 |
| --- | --- | --- |
| token 层只有颜色 | 94 个 alias 全为色，**零** spacing / radius / shadow / duration | `ui/src/styles/design-platform.css` |
| 硬编码间距 | **829 处** px 字面量，散在 98 张 module.css | grep 统计 |
| 硬编码圆角 | **58 处** `border-radius: NNpx`（另有 168 处守约用 token——一半守约一半破约） | grep 统计 |
| 硬编码阴影 | **64 处** `box-shadow` 字面量 | grep 统计 |
| 硬编码时长 | **43 处** ms 字面量 + 19 处秒级 | grep 统计 |
| 动效词汇漂移 | **222 处**字面缓动词 vs **5 处** `var(--nova-ease-*)`；`styles/motion.css:12-20` 定义的时长 token 几乎无人消费 | grep 统计 |
| keyframes 分散 | **38 个**局部 keyframes 散在 26 个文件 vs 全局 3 个 | grep 统计 |

结果是：**同一个间距在这里是 12px、那里是 14px、另一个地方是 16px**。

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

基准单位 **4px**。

```text
--nova-space-0   0
--nova-space-1   2px
--nova-space-2   4px
--nova-space-3   8px
--nova-space-4   12px
--nova-space-6   16px
--nova-space-8   32px
```

行高：

```text
--nova-row-sm    24px
--nova-row-md    28px
--nova-row-lg    32px
```

### 2.2 Radius（小圆角）

```text
--nova-radius-sm   4px
--nova-radius-md   6px
--nova-radius-lg   8px
```

**禁止 12 / 16 的胶囊卡。** 圆角不是用来证明"这是一个组件"的。

### 2.3 Elevation（最多三级）

```text
--nova-shadow-1   最低一级
--nova-shadow-2
--nova-shadow-3
```

**停靠列（右侧 Inspector）不画阴影**——它是一页的列，不是浮起来的卡。这条现有 `style-guard.test.ts` 已钉住，保留。

### 2.4 Typography

```text
字体栈   系统 UI 字体栈；代码用等宽
字号     12 / 13 / 14 / 16
字重     400 / 500 / 600
```

**不引入可变字重中间值。** 现有实现有一条注释记录了"Figma 的 510 在非可变字体上会跨平台不可预测地吸附"，此约束保留。

### 2.5 Color（中性优先 + 单一强调色）

```text
表面      接近白 / 接近黑
强调色    单一 accent，承担动作与选中
语义色    success / warn / danger / info，统一降饱和
暗色      一等公民，不是亮色的反相
```

**无品牌渐变、无 glassmorphism。**

> 现有实现有一条重要教训必须保留：`--dsw-alias-brand-primary` 在亮色下解析为墨黑，所有蓝色强调必须走 state-business 语义位。Nova 层要用**语义命名**从根上避免这类"看起来像品牌色、实际是墨黑"的陷阱。

### 2.6 Surface / Border / Text

```text
--nova-surface-sunken / base / raised / overlay
--nova-border-subtle / strong
--nova-text-primary / secondary / muted / inverse
```

业务组件**不得**自行定义 surface / border / text 的颜色取值。

## 3. Token 命名规范

```text
--nova-<类别>-<语义>[-<变体>]
```

| 类别 | 例子 |
| --- | --- |
| `space` | `--nova-space-3` |
| `radius` | `--nova-radius-md` |
| `shadow` | `--nova-shadow-2` |
| `dur` | `--nova-dur-base` |
| `ease` | `--nova-ease-out` |
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

### 4.1 时长与缓动

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

Token 纪律由**机器守卫**执行，不靠 review。扩展现有 `ui/test/style-guard.test.ts` 与 `ui/test/motion-guard.test.ts`。

### 5.1 五条新规则

```text
① spacing 不得出现 px 字面量
② radius 不得出现 px 字面量
③ shadow 不得出现字面量
④ duration 不得出现 ms / s 字面量
⑤ ease 不得出现字面动词或 cubic-bezier()
```

### 5.2 Exception 清单（**封闭集合，不得随意扩充**）

**允许**保留字面值：

```text
border-width / outline-width      （1px 是视觉原子值，token 化无意义）
hairline 相关的 1px
icon size
SVG 绘制尺寸（stroke-width / stroke-dasharray / viewBox）
特殊图形几何（环、进度条、画布坐标等按几何算出的值）
```

**禁止**为了凑数而新增 token：

```text
✗ --nova-space-editor-inline-special-1
✗ --nova-radius-tool-mini
✗ --nova-gap-composer-command-x
```

> **Guard 的目标是减少无意义的设计决策，而不是减少字面量数量。**
> 一个为凑数而生的 token 比硬编码更糟。

### 5.3 基线棘轮

现有违规**入账为基线，只许减少**：

```text
spacing   829  →  …  → 0
radius     58  →  …  → 0
shadow     64  →  …  → 0
duration   43  →  …  → 0
ease      222  →  …  → 0
```

机制沿用 `scripts/structure-budget.mjs` 的棘轮哲学：**任何放宽都必须是一次显式、diff 可见的动作**，而不是随手绕过。

**禁止**让基线变成一张几千行的白名单——那等于把守卫变成新的技术债。Exception 只能来自 §5.2 的封闭集合。

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

| 阶段 | 做什么 |
| --- | --- |
| **Batch 1** | 定稿本文件 + 建立 token 层 + 扩守卫 + 删 Tailwind 死依赖。**不迁移业务 UI** |
| **Batch 2–6** | 只允许**新代码**使用 `--nova-*`；旧 CSS 原样存在，不改 |
| **Batch 7A** | 结构迁移，**不改视觉** |
| **Batch 7B / 8** | 大规模迁移到 `--nova-*`，基线逐批下降 |
| **Batch 10** | 删除 `--dsw-*` 与 `styles/design-platform.css` |

> **设计语言可以晚迁移，但不能晚定义。** 否则 Agent 会在"半套设计系统"上继续写 UI，最后形成新的过渡泥潭。

## 8. 待审批事项（Batch 1 定稿时确认）

- accent 的色相选择；
- 中性面的冷暖倾向；
- 语义色的具体取值；
- 三级阴影的具体数值。

方向（中性优先 + 单一 accent + 暗色一等公民 + 密度优先 + 小圆角 + opacity/transform-only 动效）**已冻结，不再回头讨论**。
