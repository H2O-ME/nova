---
"@nova-agent/web": patch
---

全局视觉重做：平面阶梯、色温与对比度

## 为什么改

三处缺陷是**可量测的**，不是审美偏好：

1. **亮色平面阶梯是退化的**：`sunken` / `base` / `raised` 实测全是 `rgb(255,255,255)`。侧栏和正文渲染成同一张白纸，唯一的分隔是 12% 透明度的 0.5px 发丝线。
2. **暗色阶梯方向反了**：`sunken` 是 `rgb(35,35,36)`，`base` 是 `rgb(21,21,23)`——名为「下沉」的侧栏比它所在的页面**更亮**。名字和像素相反。
3. **正文对比度不达标**：亮色 `--nova-text-muted` = `rgb(129,133,140)`，在白底上 **3.58:1**；`faint` = **2.06:1**。设置页大量 12px 描述文字用这一档，WCAG AA 对小字要求 4.5:1。

外加两处结构与一处语义：

4. 设置弹窗写死 800×800，而「通用」分区只有约 300px 内容——三分之二的面板是空的灰。
5. 「外观」三选一被 figma 的 `20px 32px` 内距撑成 190×80 的大板，视觉重量超过它上面「权限」「工作步骤展示」两行之和。
6. 侧栏选中行与 hover 共用同一个 `--nova-interactive-hover`，于是「当前会话」和「指针停住的行」是同一批像素。

## 改了什么

- `design/tokens/surface.css`：两套调色板的 `sunken < base < raised` 都单调，档间 3–5 个亮度点；平面带极淡暖色温（220 色相近、饱和度几个点），读作纸面而非碰巧不同的灰。同步调整 code / bubble / menu / tooltip / 滚动条 / 遮罩等相关 token。
- `design/tokens/text.css`：`secondary` / `muted` 对自身平面 ≥ 4.5:1，`faint` ≥ 3:1。亮色 `muted` 由 3.58:1 提到 **5.08:1**；暗色改用同色温后仍为 6.55:1。
- `settings/SettingsPanel.module.css`：面板改为内容自适应（`height: auto` + `min-height: 420px` + 视口 `max-height`）。min-height 是刻意的——纯内容高度会让切换分区时面板在指针下跳。
- `settings/AppearanceRow.module.css`：三选一收成分段控件的比例（`12px 16px` 内距、13px 标签），选中项文字升到 primary。
- `sidebar/SessionRow.module.css`：选中态改用 `--nova-color-accent-soft` + 前缘 2px 强调色竖条，与 hover 明确区分。

## 第二轮：Codex 形状语言（同日，按操作者反馈）

操作者指出设置卡片页与输入框「太难看了，要 Codex 设计风格」。差距不在配色，在**形状语言**：Nova 全线 8px 圆角 + 边框分隔，一页下来是一堆带框盒子。

- `design/tokens/radius.css`：新增 `--nova-radius-xl: 14px`，并**推翻**原注释「三档就够、大圆角就是卡片」。判断错在落点——全线压小之后每个密集表面只能改用边框分隔自己，而框套框不是安静，是表格感。新规则按**角色**分：列表里重复的行用 `sm`/`md`，独立站立的表面用 `xl`。
- `design/tokens/shadow.css`：新增 `--nova-elevation-float`（无描边 + 24→48px 柔光）。`xl` 配带描边的档位是无效组合——0.5px 描边会沿 14px 曲线拉出可见接缝。暗色下 alpha 约翻倍并改用纯黑。
- `composer/InputBar.module.css`：输入卡去掉描边、`radius-lg` → `radius-xl`、`elevation-soft` → `elevation-float`；hero 输入区 `min-height` 52 → 68px（原先两行挤成一行）；右侧内距 8 → 16 与圆角对齐。
- `settings/SettingsPanel.module.css`：弹窗同样换 `xl` + `float`；导航选中态从 `interactive-hover-strong`（14% 黑）降到普通 hover 洗色，改由**字重 500 + 图标强调色**承载「当前分区」——原先那个深色块是弹窗里最重的物体，读作按下的按钮。
- `settings/ProviderSection.module.css`：供应商卡**去框**（`border: 0` + `transparent`），分隔改由列表 `.rows > li:not(:last-child)` 的发丝线承担，行间距归零；「添加模型提供商」从 44px 高的**全宽虚线大块**收成 32px 文字按钮（虚线框是拖放目标/空态占位的语言，不是次要动作的语言）。

## 第三轮：改回蓝白配色 + 设置子页去框（同日，操作者要求）

操作者否掉了第二轮的暖色调（「改成原本的蓝白配色，现在太难看了」），并要求继续去框设置子页。

- `design/tokens/surface.css`：中性色由暖（色相~220 带黄）改回**冷灰**（色相 ~215）。亮色阶梯 `sunken rgb(243,245,248)` < `base rgb(250,251,253)` < `raised rgb(255,255,255)`；暗色 `rgb(17,18,22)` < `rgb(23,24,28)` < `rgb(36,38,43)`。阶梯单调性与顺序保留——那是上一轮修掉的真缺陷，与冷/暖无关。
- `design/tokens/text.css`：墨色同步转冷。亮色对 `base` 实测 18.4 / 7.4 / **4.95** / 3.49；暗色 17.0 / 11.4 / 7.1 / 5.2。`muted` 仍过 4.5 小字线，`faint` 仍过 3。
- `design/tokens/shadow.css`：`--nova-elevation-float` 的阴影色从暖近黑改为**冷近黑** `rgba(16,24,40,·)`——暖阴影压冷表面会读成脏而非深度。
- `settings/ModelConfigEditor.module.css`：`.card` 去框（与供应商行同一处理），`.notice` 去框只留填充。
- `settings/ProviderSection.module.css`：`.notice` 同样去框。

**保留边框的地方是有意的**：输入框、图标按钮、标签胶囊、`icon` 容器全部保留描边——边框在「可编辑字段」「可点击控件」「标签形状」上承载语义，在这些地方去掉才是错的。去框只针对**纯容器**。

## 第四轮：对话页（同日，操作者指出「显示非常难看」）

操作者截图指向**对话页**，不是设置页。用 CDP 实测后定位到三个结构性缺陷：

- `chat/TurnHeader.module.css`：`border-bottom: 0.5px solid var(--nova-border-strong)` 横贯整列。8–16px 的节奏里，一条 14% 不透明度的全宽实线是全屏最重的笔触，一屏几条就读成**横格纸**。全宽分隔线是设置列表的语言（行是并列记录），不是对话的语言（轮次不是并列记录，留白已经说明了边界）。改为**不画线**，靠全宽次级字体行 + 8px 下距建立层级。
- `chat/MessageItem.module.css`：用户气泡用 `--nova-surface-bubble` 实底灰。那是为旧的纯白页面调的，搬到冷蓝白页面上读成一块**脏斑**，且比旁边的回答更重。改为 `--nova-interactive-hover` 半透明洗色 + 发丝边（与 hover 行同一配方），圆角 8 → 14px 与输入卡对齐。
- `chat/ChatView.module.css`：滚动区顶部内距 16 → 24px。首行原先距标签栏只有一个 16px 档，第一轮的分隔线几乎贴着顶栏，读作 chrome 的一部分。

**实测排除的两个怀疑**（没有改）：
- 底部遮挡：滚到底后 `lastItemBottom 731 < composerTop 747`，`overlapPx: 0`，未遮挡。
- 顶部裁切：自动跟随到底时 `viewArea.y = -412` 是滚动结果，滚回顶部后 `y = 76` 正常。

顺带确认：`hero` 变体只在首页空态生效，第三轮把 `.hero .input` 改 68px **没有**影响对话页的输入卡。

## 第五轮：对齐 reference 对话语言（同日，操作者要求「参考 deepseek harness 的设计」）

不再靠感觉调，而是把运行中的 DSH 拆包后提取**真实数值**再对齐：

| 维度 | 参照实测 | Nova 改前 | 改后 |
| --- | --- | --- | --- |
| 行间默认间距 | `--dsh-chat-flow-gap: 6px` | 8 / 16（压平） | **6px** |
| 回答行后 | 12px | 无此档 | **12px** |
| 过程块周围 | 16px | 16px | 8px（轮内） |
| 轮次边界（user） | 16px | 16px | **16px** |
| 输入文本高度上限 | 336px | 336px | 已一致 |
| 底部渐变遮罩 | 36px | 36px | 已一致 |
| 卡片堆叠间距 | 6px | 6px | 已一致 |

**三个真实缺陷（都有机械成因，不是审美分歧）**：

1. **「尺寸忽大忽小」** = hero 与 dock 两个 seat 的 `min-height` 分别是 68 和 36。发送第一条消息时卡片从 hero 重定位到 dock，**一帧内缩掉 32px**。改为全状态单一 44px 底线，CDP 实测 `cardHeightDelta: 0`（hero 106 / dock 106）。hero 落地态的存在感改由 wrapper 的 `padding-bottom` 提供，不再用更高的文本底线去买。
2. **「动画也没有」** = 表单有 60+ 处 animation 引用，但**全部属于折叠体**（展开 turn、揭示 reasoning），消息落地时**一个都没有**。给 `.flowItem` 挂上既有的全局 `nova-fade-up`（透明度 + 6px 上浮，纯合成层），不新增动效词汇；并补 `margin-top` 过渡，让折叠时下方行不再瞬跳。
3. **节奏过散** = 默认间距 16px 把「思考行 / 回答 / 用量尾行」这**一段话**撕成三个无关区块。6px 让一个 turn 内部抱团，段落感交给轮次边界的 16px——这正是被删掉的那条全宽分隔线原本用墨色承担的工作，现在用邻近性承担。

**第四轮判断的自我修正**：第四轮把参照系的变量名（`--dsh-` 前缀）写进了注释，被 `style-guard` 的「无移植词汇」守卫拦下——守卫是对的，Nova 源码不该出现参照系命名。已改写为「the reference」，结论与数值不变。

## 验证

- `ui/test/palette-guard.test.ts`（新增，3 个用例）钉住三条**关系型不变量**：阶梯顺序、对比度下限、选中/悬停互异。只断顺序与比值，不断具体色值——刻意重调调色板不该让它变红。
- 三条用例均跑过**变异验证**：把 `surface.css` 改回三档全白 → 截获（`expected 1 to be less than 1`）；把 `muted` 改回 `rgb(129,133,140)` → 截获（`3.58:1, needs ≥ 4.5`）；把选中态改回复用 hover 洗色 → 截获。
- `pnpm gates` 全绿，UI token 债务 spacing 126 · radius 33 · shadow 12 · duration **91** · ease **85**。
- 第二轮追加 2 条形状守卫（`standalone surfaces pair the large corner with the stroke-free float`、`provider rows carry no frame`），同样跑过变异验证：composer 改回 `elevation-prominent` → 截获；供应商卡改回带边框 → 截获；恢复后绿回。
- 第四轮追加 2 条对话页守卫（`the transcript separates turns with space, not a full-width rule`、`the user bubble is a light wash, not a filled slab`），同样变异验证：TurnHeader 加回 `border-bottom` → 截获；气泡改回 `--nova-surface-bubble` → 截获；恢复后绿回。
- 第五轮追加 3 条守卫（`the composer keeps ONE text floor across the hero and docked seats`、`the transcript rhythm stays inside the reference ladder`、`a mounted transcript row animates in`），全部变异验证：加回 `.hero .input` 覆盖 → 截获；默认间距改回 16 → 截获；删掉 `animation` 声明 → 截获（此条首版**漏报**，因为它匹配到了注释里提到的 keyframe 名；改为先剥离注释再断言 `animation:` 声明后正确捕获）。
- `packages/web/ui/test/` 全量：**100 文件 / 1061 断言**全绿。
- CDP 实测对话页节奏：`process 6 / assistant 8 / tail 8 / user 16`，每行 `animationName` 均命中 `nova-fade-up`。
- `pnpm gates` 四门全绿：spacing 126 · radius 33 · shadow 12 · duration 91 · ease 85。
