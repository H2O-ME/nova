---
'@nova-agent/web': minor
---

# WebUI 视觉层全局重写：Aceternity 语言，零新依赖

## 起因

操作者连续三轮说「太难看」，最后明确要求「换成 ui.aceternity.com 的组件库」，
并强调「不是简单的替换，是全局重构重写」。

评估结论：**Aceternity 不是可安装的组件库**，它是 Tailwind + motion 的代码片段集，
且**不含任何对话页、设置页、输入框、消息列表**——恰好就是被指为难看的主体。
装它只会换掉装饰、留下主体。因此采纳它的**视觉语言**，不引入它的**依赖**：
它目录里的每个效果都是 `linear-gradient` + `blur` + `box-shadow`，全是原生 CSS。

这条取舍同时避开了本仓的一处历史教训：本文档 §5 记录，本仓曾装 Tailwind v4、
挂插件、0 使用、最终作为死依赖被删除。再装一次就是重蹈。

## 做法：重写 token 层，而不是逐 sheet 改

89 个组件 sheet / 15253 行 CSS，逐个手改不可行且必然漂移。**全部 sheet 只引用
`--nova-*` token**，所以重写 token 即可一次性整体换装，且不可能漏掉任何组件。
这是唯一真正「全局」的抓手。

## 数值对照

| 项 | 重写前 | 重写后 | 说明 |
| --- | --- | --- | --- |
| `radius-sm` | 4px | 6px | 行内标记 |
| `radius-md` | 6px | 10px | 密集重复行 |
| `radius-lg` | 8px | 12px | 控件：按钮、输入、胶囊 |
| `radius-xl` | 14px | 18px | 独立表面：弹窗、设置面板 |
| `radius-2xl` | —— | **24px** | 新增档：hero 输入卡 |
| 亮色平面阶 | 3–5 明度点 | 6–9 明度点 | 面板靠填充分离，可去边框 |
| 暗色 `raised` | rgb(34,37,43) | rgb(38,42,49) | 见下「实测修正」 |
| 浮起阴影 | 1 描边 + 2 层 | 3 层，无描边，负 spread 环境光 | 描边会把圆角描成缝 |
| accent | 单值 | 单值 + `light`/`deep`/`gradient` 三级 | 渐变控件有名字可用 |

## 新增 `design/tokens/glow.css`

`--nova-glow-*` 只含**颜色 / 渐变 / 阴影**，不含几何、间距、时长。这是刻意的：
它们因此不落在 `ui-token-guard` 五条规则的任何一条里，采纳这套词汇**不可能**
抬高字面量债务计数。

- `--nova-gradient-hairline` 渐变发丝（替代平描边）
- `--nova-aurora-wash` 极光洗色（空态背景）
- `--nova-grid-lines` 渐隐网格
- `--nova-glow-float` / `-interactive` / `-inner-highlight` 三级辉光
- `--nova-mask-keep` / `-drop` 遮罩停靠点（遮罩也是颜色值，组件不得写字面量）
- 暗色逐档上调：同一 alpha 在近黑底上「读作没有」

## 缺陷与自我修正（全部经真机实测）

1. **极光挂在了一个 34px 高的元素上**。`HeroShell.root` 实测只有 624×34——它只包
   标题行，工作区芯片与输入卡是它的**兄弟节点**。两层带遮罩的背景画进 34px 窄带，
   截图上就是「没有」。已改挂到全高的 `[data-phase='hero'] .scrollBody`（833×795）。
   这是「凭 CSS 推断」会漏掉、只有量了才知道的典型。
2. **首版极光太淡、网格太杂**。0.08 alpha 画在近白底上等于没画；0.045 alpha 的
   46px 网格在标题后面读作「屏幕脏了」。已拆分出专用于浅底的 `--nova-glow-wash`
   （0.16），网格降到 0.028 且改为 0.5px，遮罩收紧成只在标题外圈出现的暗角。
3. **暗色下输入卡浮不起来**。实测与侧栏几乎同色——暗色平面每像素携带的明度信息
   远少于白纸，5 点差等于没有。`raised` 加深到 rgb(38,42,49)。
4. **渐变填充会让 `background-color` 的 hover 规则静默失效**。发送按钮改渐变后，
   原 `background-color` hover 不再移动任何像素。改为 `filter: brightness()`，
   纯合成层。
5. **渐变字会让子孙文字透明**。`-webkit-text-fill-color: transparent` 会继承，
   `v0.4.0` 徽章会变成一块没有字的色块。已显式 `currentColor` 复位。
6. **渐变 hover 会连禁用态一起提亮**。已用 `:not(:disabled)` 保护。

## 守卫

- `palette-guard` 的 `standalone surfaces...` 原先硬编码 `radius-xl`。新增 `2xl`
  后它会把「hero 卡用了更大的档」判成违规——**恰好与本意相反**。已改为断言
  **档位类别**（`xl|2xl`），「必须无描边浮起」这条硬要求保持不变。
- 变异验证：把输入卡改回 `radius-lg` → 该守卫变红；恢复 → 绿回。
- `style-guard` 抓到 2 处字面色（`rgba(...)` 内高光、遮罩里的 `#000`，
  **含注释中的**）→ 全部改走 token 后绿回。

## 验证

- `packages/web/ui/test/`：**100 文件 / 1061 断言**全绿。
- `pnpm check`：**209 文件 / 2216 断言**全绿，lint 0 error（98 warning 为存量）。
- `pnpm gates` 四门全绿（spacing 126 · radius 33 · **shadow 15** · duration 91 · ease 85）。
  shadow 由 12 升至 15，来源是内高光与悬停辉光各一条，已显式承认。
- CDP 实测（1113×795，侧栏 280）：卡片 **592px = 主区 71%**（重写前 712px = 83%），
  `border-radius: 24px`，`min-height: 44px` 在 hero 与 dock 两个座位完全一致；
  发送按钮 `linear-gradient(to right bottom, rgb(96,149,255), rgb(43,84,196))`。
- 亮色 / 暗色均逐张截图核对，非仅读度量。

## 未做

- **没有装 Tailwind，没有装 motion/framer-motion**（理由见开头）。
- 89 个 sheet 的**逐处**圆角与间距没有手改——它们经由 token 自动继承。
  需要单独调整的（如 `.mention` 行内 chip 从 `lg` 降到 `sm`）已就地改并注明理由。
- 对话页 / 设置页 / 侧栏尚未逐页截图复核，本轮聚焦 token 层与首页 hero。
