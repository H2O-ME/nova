---
'nova-web-ui': minor
---

WebUI 接入 shadcn/ui：项目上下文、token 桥与官方 skill

## 为什么改

此前组件层是手写的：`src/kit/`（Button / IconButton / Dialog）、`src/ui/`
（Aceternity）与 137 个 tsx / 89 份 CSS Module 各自维护形状。操作者要求
**全面换用 shadcn/ui 的 skill 与组件体系**，本批只做接线，不迁移存量界面。

## 改了什么

- `.agents/skills/shadcn` 与 `.agents/skills/migrate-radix-to-base`：按
  `ui.shadcn.com/docs/skills` 的 `pnpm dlx skills add shadcn/ui` 安装，
  该 CLI 同时为 Claude Code / ZCode 建了软链（`.claude/` 已忽略，skill 本体入库）。
  `skills-lock.json` 沿用既有忽略规则。
- `components.json`：Radix base、`nova` 预设、Tailwind v4、`@/*` → `src/*`；
  `src/lib/utils.ts` 导出 `cn`，`src/ui/cn.ts` 改为转发（不再维护第二份合并实现）。
- `src/tailwind.css`：
  - 新增 shadcn 语义色，但**全部指向 `--nova-*`**（`background`/`card`/`muted`/
    `accent`/`border`/`input`/`ring`/`sidebar*`）。`bg-background` 与一份未迁移
    的 CSS Module 写 `var(--nova-surface-base)` 解析到同一个颜色。
  - shadcn 的 `accent` 是"悬停浅洗色"，不是 Nova 的品牌蓝；品牌蓝改由
    `--color-brand` 承载，`GlowButton` 随之从 `bg-accent` 改为 `bg-brand`。
  - `dark:` 变体重绑到 `body[data-nova-dark]`，shadcn 源码里的 `dark:` 类
    不改一个字就能跟随 Nova 的主题机制。
  - 移除 init 写入的 `:root` / `.dark` 调色板与 Geist 字体注入：前者会绕开
    Nova 的 token 层（且在 `:root` 上展开 `var()` 会把亮色值冻死），后者改变
    了已冻结的字体栈。
- `src/components/ui/`：已接入 `button`、`message`、`bubble`、`marker`、
  `attachment`、`message-scroller` 六枚原语（Radix base）。其中 `bubble` 增加
  了一个 `nova` 变体：半透明交互洗色 + 发丝边，与迁移前的发送气泡同一配方，
  避免 stock 的 `muted`/`secondary` 实底把气泡画成比回答更重的一块脏斑。
- 对话页先迁行级原语：
  - `UserMessageRow` → `Message align="end"` + `MessageContent` + `Bubble variant="nova"`
    + `BubbleContent`；
  - `AssistantMessage` → `Message align="start"` + `Bubble variant="ghost"`
    （全宽正文，不画气泡底）；
  - 回到底部控制 → shadcn `Button`（`variant="ghost" size="icon-sm"`），几何仍由
    `ChatView.module.css` 的 `.toBottom` 决定。
  - 视觉口径保持 `--nova-*`：气泡仍是 `--nova-interactive-hover` 洗色 + 发丝边，
    字号仍走 `--nova-content-font-size` 轴。

## 未做（有阻塞，需单独立项）

`ChatView` 的滚动壳**没有**换成 `MessageScroller`。本仓的滚动所有权在
`ConversationRoot` 的 `[data-conversation-scroll]` 主体上（`ChatView` 的 `.scroll`
在该宿主下显式 `overflow: visible`，宽度手柄与 composer seat 都依赖这个结构）；
`MessageScroller` 要求自己持有 viewport 的高度与滚动。直接替换会让 viewport 落在一个
自动高度父级里，且 composer seat 与宽度手柄要重新归属。这是一次结构性迁移，需要
真机量测，不在本批夹带。

## 对话流控件换库（同日，按操作者「对话过程全部使用新组件库重构」）

- `TurnHeader` 的整行 disclosure → shadcn `Button`（ghost / sm），并补上
  `justify-content: flex-start`、`gap: 0`、`font-weight: 400`：Button 默认居中、
  6px gap、500 字重，任一项不覆盖都会让这一行偏移或变粗。
- `MessageIconActions` 的复制 / 分支 → `Button`（ghost / icon-sm），28px 盒与
  12px 圆角仍由 sheet 决定。
- `TurnUsagePill` 的触发按钮 → `Button`（ghost / sm），字号与 400 字重保留。
- `ChatHintRow` → shadcn `Marker`。
- 非折叠的 `TurnHeader` 会命中 Button 的 `disabled:opacity-50`；sheet 里显式
  `opacity: 1`（它不是一个disabled 控件，是一个没有可折叠内容的表头）。
- `flow-rows.test.ts` 的「无 aria-expanded」断言改为断言**属性**
  （`aria-expanded=`）：Button 的类名里带 `aria-expanded:` 工具类，旧的子串断言
  会把类名当成属性。契约没变，断言更准。

## 对齐审计（真机 `getBoundingClientRect`，1280×720）

操作者指出的「工作区行与输入卡上下不对齐」不是孤例，实测同一屏内有 5 条不同的
左轴（439 / 441 / 449 / 455 / 457 / 459）。已修：

| 位置 | 修前 | 修后 | 说明 |
| --- | --- | --- | --- |
| 工作区行外层 | 行 pad 6 → 图标 439 | 行 pad 16 → 芯片盒 441 / 图标 449 | 芯片盒与输入卡左边缘同边，图标与卡内 `+` 盒同轴 |
| 输入框文本 | 左 pad 14 → 455 | 左 pad 16 → 457 | 与对话正文列（457）同轴 |
| 占位符 / 镜像层 | inset-left 14 → 455 | 16 → 457 | 与草稿层保持逐字重合 |
| 会话列表标题 | 项目 41 / 会话 39 | 两者 42 | 同一棵树两条 2px 的轴 |
| 发送按钮 | `translateY(-2px)` → 中心 431 | 移除 → 中心 433 | 与模型选择器、`+`、权限芯片同一水平中心 |

**判定为有意、未改**（写在这里防止下一个人当 bug 改回去）：

- 会话列表行比顶部按钮宽 2px：`SessionBrowser` 的
  `--nova-session-list-edge-inset` + 负 margin 是有意的 hover/选中出血。
- 尾部复制按钮的外框比正文左移 6px：6px 内距让**字形**落在 457，视觉对齐的是
  图标而不是按钮盒。
- 表头右上角按钮 `margin-right: -16px`：光学外扩，图标本身落在内容右缘。

## 验证

- `pnpm --filter nova-web-ui build` 通过（Next 编译 + TS + 静态导出 + sync）。
- `vitest run packages/web/ui/test --exclude style-guard`：99 文件 / 1049 断言全绿；
  `pnpm gates` 四门全绿；`pnpm lint` 0 error（98 warnings 为存量）。
- 真机实测（内置浏览器，1280×720）：工作区芯片盒 x=441 = 输入卡 x=441；图标
  x=449 = `+` 盒 x=449；占位符 x=457 = 对话正文 x=457；发送中心 433 = 模型 433；
  项目标题与会话标题同为 x=42。
- `TurnHeader` 换 Button 后实测：height 33、label x=457、字重 400、gap 0、
  opacity 1；`TurnUsagePill` 字重 400、中心 284 与尾部动作一致。
- `style-guard` 的 `no literal colors` 有一条**既有**红：未提交的
  `settings/SettingsPanel.module.css` 用 `linear-gradient(#000 0 0)` 做 mask 合成。
  这不是本批引入的，未在本批顺手改。

## 工具卡与审批/问答（同日，第二批）

- `DiffCard` / `ReadCard` / `TerminalCard` / `SearchCard` / `PlanCard` 里的复制、
  展开、文件头切换 → `Button`（ghost / xs）。这些是**文本链接形状**，不是按钮盒：
  Button 自带 `h-6`，所以每个 `.copyButton` / `.expand` / `.fileHeader` 显式加
  `height: auto`，让行高继续由字体决定（实测复制按钮仍为 26×20）。
- `ApprovalPanel` 的拒绝 / 总是允许 / 允许一次，`QuestionPanel` 的跳过 / 提交 →
  `Button`（ghost / sm）；两处 `.button` 补 `font-weight: 400`，否则 Button 的
  `font-medium` 会把胶囊按钮的字重抬到 500。
- `QuestionPanel` 的选项仍是 `role="radio"` 的自绘按钮——它语义上是单选/复选组，
  正确原语是 `ToggleGroup`，不是 Button；留到单独一批，避免把可访问性语义改坏。
- `question-panel.test.ts` 的「跳过未禁用」断言改为属性形式：Button 类名带
  `disabled:` 工具类，旧的子串断言会把类名当属性。

## 对齐 DSH 的真实几何（2026-11-05，来源：`deepseek-harness-master` 源码）

操作者指出「UI 很方、没有 DSH 优雅」，并给了 DSH 截图。这次不再凭感觉调，直接把
DSH 的 CSS 值取出来（只读参照，不改它）：

| 维度 | DSH 源码值 | 本仓修前 | 本仓修后 |
| --- | --- | --- | --- |
| 内容列 | `min(100% - 32px, 920px)` | `clamp(560, 64%, 920)` → 1000 列下 **640** | `min(100% - 32px, 920px)` → **898**（同列宽下） |
| 输入卡宽 | `min(100% - 16px, 952px)` | content+32 → **672** | **946** |
| 输入卡圆角 | `radius-panel` **28** | 24（上一批被砍到 12） | `radius-2xl` **24** |
| 输入卡描边 | `border: 0` + `elevation-soft`（首层 0.5px stroke） | 上一批改成 CSS 边框 + 无阴影 | `border: 0` + stroke + soft |
| 气泡 | 实底 `neutral-bluish-50`，`radius-xl` **20** | 洗色 + 0.5px 边、18 | 实底 `surface-sunken`、`radius-xl` 18 |
| 行距 | 默认 **16**，仅「闭合过程 → 答案」**8** | 6/8/12/16 + 表头 8 下距 | **16 / 8**（表头下距移除） |
| 发送按钮 | 纯色 accent 圆 | 渐变 + 内高光 + 外发光 | 纯色 |

同时去掉了空态极光层（`AuroraBackground` 不再挂载；组件文件保留未删）与
`GlowCard`/`GlowButton` 之外的蓝色装饰；surface 阶梯改为中性（`249/243/238`），
文字色不变。上一批把圆角砍到 12px 的判断是**错的**：DSH 的优雅来自宽列 + 大圆角 +
一条阴影描边，不是「小圆角」。

守卫同步改写（不是放宽，是换了被守护的方向）：
- composer：大圆角 + `elevation-soft` + `border: 0` + 无 accent 渐变；
- 气泡：实底 `surface-sunken` + 无边框 + `radius-xl`；
- 节奏：默认 16、答案 8。

真机实测（内置浏览器 1280×720）：内容列 **898** @ x=328（原 640 @ 457），输入卡
**946** @ x=304（原 672 @ 441），圆角 **24**，阴影首层 0.5px stroke；相邻行距
**16 / 16 / 16 / 16 / 8 / 8**。

## 静默对话流（2026-11-05，操作者给出 DSH 对照截图后）

对照截图后剩下的三处「我们在动、参考不动」的噪音：

- **消息动作行全部悬停显示**。旧规则放行两类：最新一条 user 消息（时间 + 复制）
  与最新完成轮次的尾行（复制 + 用量 + 时间）。参考的转录静止时**什么都不显示**
  （用量与速度在底部状态栏）。现在 user / steering 行与全部尾行统一
  `opacity: 0`，行自身 hover / focus-within 显现；布局高度不变，无 hover 设备
  恒显。`flow.tsx` 的 `endsWithResponse` 判定随之删除（无消费者），相关测试改为
  钉「所有尾行 hover 门控」。
- **侧栏选中行去 accent**。蓝底 + 前缘竖条是整个 chrome 里最重的一块颜色，参考
  的侧栏选中是中性灰。改为同中性系的强一档（hover 5.5% 墨色，选中 12%）——
  靠强度区分，不靠色相；竖条删除。
- 表头与正文之间不再有表头自带的 8px 下距（上一批已改，这里补记）。

守卫同步：`palette-guard` 的选中行断言从 accent 面 + 竖条改为「强中性档、
无竖条」；`flow-rows` 的尾行断言从「最新轮次 always」改为「全部 hover」。

## 滚动壳换 MessageScroller + DSH 圆角阶梯（2026-11-05 深夜批，操作者点名三件）

### 1. 圆角阶梯整体对齐 DSH（radius.css）

操作者「很方」报告的根因是**阶梯本身每档都小一档**。从 DSH
`ui-theme/src/styles/base.css` 逐档取出：sm 8 / md 12 / lg 16 / xl 20 / panel 28。
`--nova-radius-*` 五档全部改齐（此前是 6/8/12/18/24），89 份 sheet 一次性重穿。

### 2. 工具卡 sheet 对齐 DSH 的面配方

DSH 代码卡家族（`ToolRow.ioCard`、`GenericCommandCard.body`、`SearchBlock`）的
统一配方：`0.5px` 发丝边（border-l1 = rgba(0,0,0,.04)）+ `radius-lg` 16 +
`neutral-bluish-50` 实底。逐项对齐：

- `TerminalCard` / `DiffCard` / `SearchCard` 的 `--dsl-*-radius: 12px` 字面量 →
  `var(--nova-radius-lg)`（16）；`ReadCard` 上一批已改。
- `ReadCard` 补 `0.5px` 发丝边 + `overflow: hidden`（banner 圆角嵌套与终端卡
  同解法）——读取卡与终端卡是同族卡，族内一半有边一半没有正是「忽大忽小」。
- `--nova-surface-code` 亮色 `rgb(246,246,247)` → `rgb(249,250,251)`
  （= DSH `neutral-bluish-50`，冷调发丝灰）。markdown CodeBlock 与工具卡共用
  一个 alias，DSH 也是全局一个值。暗色不动。

真机量测（内置浏览器）：终端卡 radius **16px**、边 **0.5px**、底
**rgb(249,250,251)**——与 DSH 源码值逐项一致。

### 3. kit 换芯（`src/kit/` 的 Button / IconButton）

- `kit/Button.tsx` → 包装 shadcn `Button`（`variant="ghost" size="sm"`），
  kit 的 32px 几何、发丝边、墨块主按钮仍由 `Button.module.css` 决定
  （unlayered module 胜 layered utilities）；补 `font-weight: 400`
  （library 是 `font-medium`，胶囊按钮字重会抬到 500）。
- `kit/IconButton.tsx` → 同法包装（`size="icon-sm"`），28/24px 盒与
  active/danger 态保留。`Dialog` 未动（模态所有权在 `shell/modal-layer.ts`，
  需合并两套所有权，仍单独立项）。

### 4. ChatView 滚动壳 → shadcn MessageScroller（上一批记录的阻塞解除）

- `ChatView` 的 `.root/.scroll/.column` 三层换成 `MessageScroller` /
  `MessageScrollerViewport` / `MessageScrollerContent`。**不挂 `autoScroll`**：
  Provider 必须挂（Viewport 读它的 context），但缺省时引擎停在
  `free-scrolling`、从不写 scrollTop——追底规则仍是本仓 `scroll-follow.ts`
  （24px 阈值、observed-top 台账、own-input 追底、load-earlier 锚定）。
- **滚动所有权移交**：Viewport 挂 `[data-conversation-scroll]`（`scrollportOf`
  与 CSS 靠它定位滚动容器），`ConversationRoot` 的 scrollBody 摘掉滚动
  （换 `data-conversation-body` 锚点）、composer seat 从 sticky 改为 flex 兄弟
  （不再需要 `--nova-composer-height` 补偿定位，回到底部按钮的 sticky 规则随之
  删除）；scrollBody 的 2px 滚动条偏移与 track inset 跟随到 Viewport。
- 链路改道：`WidthHandle.onWheel` 与 `InputBar` 的草稿滚到边续滚（wheel 链）
  都改走 `data-conversation-body` 下钻 Viewport。
- `ChatView.module.css` 删掉三段 `:global([data-conversation-scroll])` 降级规则
  （`.frame/.root/.scroll` 在宿主下的 flex/overflow 让位）——viewport 现在自持。

真机量测（内置浏览器，1440×860）：Viewport 持
`[data-conversation-scroll]`（overflow-y auto、2px 边距、24px 顶距、追底时
`overflow-anchor: none`）；切会话与加载更早后 scrollTop 恰好贴底（1949.67 =
scrollHeight − clientHeight）；hook scrollTop setter 确认加载更早的写入路径
完整；宽度手柄 wheel 转发生效（510→390）。

**已知行为（非本批引入，如实记录）**：`load_earlier` 之后 flow rows 的 key
整体重编号（旧 `b1..b41` → 新窗口里 `b6..b46`），没有任何 key 跨页幸存，
`ChatView` 判定为「整卷替换」走追底分支，锚定补偿从未生效。这在换壳前
（scrollBody 持滚动）同样存在——锚定逻辑依赖 key 跨页稳定，而 key 是窗口内
序号。修复在数据层（key 用稳定 block id），不在滚动壳，单独立项。

**IAB 量测怪癖（写下来防止下一个人误判）**：在内置浏览器里用 evaluate 直改
`scrollTop` 不派发 scroll 事件（页面自挂的 probe 也收不到，`nativeFired: 0`）；
派发合成 `scroll` 事件后整条链路立即正常（按钮出现、`data-chat-following-tail`
移除）。cua 滚轮 / PageUp 真实输入路径在该环境全面超时。产品监听的是同一
`addEventListener('scroll')` 模式（与换壳前同构），真实输入不受影响。

### 5. 测试

- `style-guard` 的 dsw 词汇守卫扫到了 `InputBar.module.css` **注释里**的
  `--dsw-*` 变量名：注释改措辞（描述值而不是抄变量名）。
- 其余全绿（100 文件 / 1058 断言；唯一红是 `SettingsPanel` mask 的 `#000`
  既有红，与本批无关）。

## 仍未做

- `src/kit/Dialog` 未换（模态所有权合并，单独立项）。
- `QuestionPanel` 的选项组（radio / checkbox）未换 `ToggleGroup`。
- `load_earlier` 的 key 稳定性（锚定失效根因）在数据层，单独立项。
