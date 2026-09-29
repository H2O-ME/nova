---
'@nova-agent/web': patch
---

**WebUI 全模块与参照实现（deepseek-harness）逐项比对后的对齐轮。** 四条并行审计各自把 dsh 源文件与 `packages/web/ui/src` 的对应模块逐行对照，修掉的是「移植时放宽、丢弃或自造」的地方——每一条都能在 dsh 的某个具体行找到出处。

**转录与 markdown（chat）**

- **推理正文按纯文本渲染**：展开体是 `{text}` 直出，于是推理里的 `**粗体**`、列表、围栏全部以字面 markdown 显示。改为走 `MarkdownText variant="compact"`（dsh `ReasoningRow` 的做法），并补齐**整份 `.compact` 规则集**（次要字号档、标题统一 `font:inherit; font-weight:600`、块级 `4px` 节奏、行内 code 的内边距与圆角、代码块去 sticky）——此前这个 variant 根本不存在。
- **代码块工具栏整体缺失**：只有一个裸文本复制按钮，**没有可访问名**、没有图标切换、没有换行开关。按 dsh `CodeToolbar` 补齐语言标签（不支持高亮时回落「代码块」）与 `aria-pressed` 换行开关；`supportsHighlighting()` 与 `highlightLines()` 现在**共用同一张语言表**，所以「标签声称某语言但正文是纯文本」在构造上不可能。
- **消息时钟跨午夜不刷新**：`formatClock(time)` 用了冻结的 `Date.now()` 且**没有任何重渲染触发源**，昨夜挂到次日的会话时间戳永远只显示 `HH:mm`。补上 dsh 的 `useCalendarDay` 座位。
- **文案对齐**（自造词 → dsh 字典原句）：`复制成功`、`在新对话中分支`、`仅可从已完成轮次的最后一条消息分支`、`上下文已压缩` / `已压缩 N 条历史记录（约 N tokens）` / `点击查看压缩摘要` / `压缩摘要不可用`。
- **像素级 token 偏离**：行内 code 圆角 `6px`→`--dsw-radius-sm`、图片 `8px`→`--dsw-radius-md`、表格 hover `overflow-x: auto`→`scroll`、滚动条回落值 `8px`→`5px`、焦点环补 `--dsw-focus-ring-color` 回落链、`MessageIconActions` 补 `min-width: 0` 且 hover 圆角 `28px`→`--dsw-radius-sm`（28px 让 hover 底色呈胶囊形，与 24px 图标行不符）。
- **本轮用量面板对齐 `stat-dialog`**：`z-index` / `min-width` / 圆角 / 材质（`--dsw-specific-menu` + `--dsw-menu-backdrop-filter`）此前都是替代方案，而这两个 token **本仓已经定义**，替代理由已不成立；`.details` 由手写 flex 行改为原生 `<dt>/<dd>` 网格。

**工具卡与轨迹（tool / flow）**

- **bash 行标题是英文**：`'Bash'` 取自 dsh 的 **en** 字典（`:680`），而本仓界面只有中文一份文案，zh 字典（`:310`）是「运行命令」。
- **后台 job 状态点语义错**：`stopping` 被画成「还在转」、`killed` 被画成中性 idle；按 dsh `JobListAction` 逐条对齐（两者同为「按要求结束」，共用警示色），状态词也对齐（`正在停止` / `已取消` / `已失败`）。
- **subagent 行是扁平 24px 单行**：重写为 dsh 的两行目录形态（14×17 活动槽 + 堆叠的 label/clause + 右侧两行等宽 metrics 网格）。
- **Diff 卡缺行底色与左侧色条**——这是 dsh diff 最主要的视觉（`.del`/`.add` 用 `inset 3px 0 0` + 对应的 diff 底色 token）。同时 `.path` 权重 600→500、`.ctx` 色调回归，行上限 `8`→`9`。
- **行高亮与打断态**：补 `.stoppedSummary` 警示色、`.row:hover` 的文字提亮与 `.title` 的 `transition`——样式表头部注释声称有 `.stoppedSummary` 而代码里没有，这条同时修掉了注释与实现的漂移。

**侧栏与设置（sidebar / settings）**

- **行尾时间戳改相对时间**（`刚刚` / `5分钟` / `3小时` / `2天`），此前同一列表里混着 `HH:MM`、`M月D日`、`YYYY-MM-DD` 三种粒度；时间戳单元格字号 `12/20`→`10/16`。
- **标题 hover 走马灯整体缺失**：长标题（分叉递增名等）恰恰在指针落上去、最想知道「这是哪个会话」时只能看到被省略号截掉的前半截。补上 dsh 的逐帧匀速爬行 + 三条渐隐遮罩 + `prefers-reduced-motion` 直接跳到末端。
- **会话行 hover 动作**：删除键的 hover 色用错（`state-error` → `label-primary`）——破坏性语义交给点击后的确认框承担，16px 字形本身不报警。
- **空态三分**：空列表与「搜索无果」此前共用同一个左对齐 `.empty`，现在按 dsh 分开（后者居中 + `margin-top: 80px`）。
- **动画门**：message 行在 DOM 上补 `data-row-key`（`rowKeysOf()` 把它们交给了 FLIP 动画，而 DOM 里找不到对应节点），`resetKey` 补上「展开其余 n 个会话」的状态——dsh 把这算作**视图替换**而非重排。
- **插件清单**：内核原始状态名（`pending`/`loading`/`active`/`failed`/`disposed`）此前直接渲染给读者，现本地化且**未命中回落原值**（一个本构建不认识的相位名仍是事实，留空会把它藏起来）；补搜索框与「空清单 / 无匹配」两种读法（匹配插件名**与它注入的服务名**——「谁提供 `tools`」是抵达同一行的另一条路）。
- **设置分区页头**：模型与插件两个分区此前直接开始列行，补 `<h2>` + `<p>`（插件分区说明取 dsh zh 原句）。

**验证**：`pnpm verify` 全绿（build + 7 包 typecheck + 108 文件 / 1238 测试 + 依赖方向 + 行数预算）；`style-guard` 五项全绿。新增测试钉住的是**契约**（`data-actions-reveal` 的判定、hover 交换与 marquee 的 CSS 配对、状态点映射、`not.toContain` 英文标题、结构化计数与降级文案），不是完整文案串。

**已知未对齐项**（需要别处开工，故只记录）：dsh 的**呈现策略层**（`compact` / `standard` / `detailed` / `verbose` 四档，控制落定推理是否带预览、是否折叠已完成轮）在 Nova 全仓不存在，本次把 `settledReasoningPreview` 的档位做成了与 dsh `standard` 一致的**默认行为**；轨迹表（dsh 39 文件的虚拟化表格）依赖 snapshot service 投影，Nova 的持久真相是 JSONL 本身、缺这些派生字段，需先有生产者；`preparing` 工具态需要新的协议帧。
