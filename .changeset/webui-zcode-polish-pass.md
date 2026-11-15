---
'@nova-agent/web': minor
---

WebUI 精致度批：菜单、composer 工具行、设置页、新建会话动画逐值对齐 ZCode 桌面端（承接 2026-11-14「完全一致优先」，参照值全部取自 ZCode UI 克隆仓源码而非截图推测）。

**菜单与下拉**（`shell/MenuSurface`、`shell/MenuCard`、`shell/Menu`）：模型菜单卡固定 288px（参照 `w-72`）、外壳 8px 圆角、条目 32px / 6px 圆角（新增 `--nova-radius-xs` 档）/ `4px 8px` 内距 / 14px 400 标签、勾选 16px；入场改为参照的 `fade-in-0 zoom-in-95 slide-in-from-bottom-2`（8px 低 + 95% 缩放，120ms）。两处菜单表同值，`menu-surface.test.tsx` 的旧度量（34px / R12 / 13px）随之改约。

**composer 工具行**：左侧组 4px、右侧组 6px 间距（参照 `gap-1` / `gap-1.5`，旧值 12px 让整行读成「散开的工具条」）；模型芯片 28px / 8px 圆角 / `0 6px 0 8px` / 14px 主墨（参照 ghost Button `size=default` + `pl-2 pr-1.5`），权限芯片 32px / 8px / `0 8px 0 12px` / 14px / 400（参照 `ConfigSelect` ghost `size=lg`），hover 与展开同填充并只过渡颜色。

**设置页**：内容列加 24px/600 节标题；分节改为卡片组（1px 边、12px 圆角、白底）；行改 `grid 1fr/192px` + `12px 16px` 内距 + 行首分隔线 + 14/500 标签 + 14/24 说明；各节页头/搜索/横幅补齐卡片内距；导航行 32px、当前行与 hover 同填充、取消强调色轨与强调色图标；面板改参照 dialog 配方（16px 圆角、1px 边、`zoom-in-95` 120ms 入场），遮罩 `rgba(0,0,0,.6)` + 2px 模糊，导轨分界改 1px 实线。

**新建会话动画**：hero/settling → active 时 composer 以 260ms 从 `translate3d(0,32px,0) scale(0.96)` 落位（参照 `ConversationBottomDockTransition` 的 32 / 0.96 / 260ms）；直接打开既有会话不动（参照 `AnimatePresence initial={false}`）。

**侧栏**：去掉列间 0.5px 右边框，仅靠 `sunken` 与 `base` 底色差分界；「任务列表」标题 14/500；条目第二行（工作区 · 时间）14/20（参照 `text-ui-base text-foreground-subtle`，旧 12/16）；当前行与 hover 改为同一 5% wash（参照 `--color-selected` 与 `--color-surface-hover` 同值，旧 12% 强档在参照旁读成填色卡片），`palette-guard` 断言同步改约。

**Hero 线框**：品牌线框改 1px 描边 + `text-muted` × 0.40（参照 `foreground-subtlest` 40% 墨 × `opacity-70`，有效 28%）；旧的 0.7 是参照的 2.5 倍浓度，视觉上从水印变成徽标徽章。

**Hero 建议 chips**（新增，参照 `ConversationDraftSuggestedPrompts`）：卡片下方 24px 居中四枚芯片（周报总结 / 报错修复 / PPT 制作 / 闲时任务），32px 高 / 8px 圆角 / `0 12px` 内距 / 14px 400 / gap 16；图标与文字 70% 不透明、hover 全亮；入场按 index × 65ms 阶梯做 260ms 顶部裁切擦除（`nova-chip-waterfall`，全仓唯一 `clip-path` 动画，记名例外）。点击只替换草稿并把光标放到末尾、从不发送（参照 `replacePlainPrompt`），通道是 `composer/external-input.ts` 的 `useDraftRequest`（`seq` 键支持同一枚芯片连点）；四项文案为本地常量（catalog 链路未移植）。同批把 composer 的 24px 底内距归零——它与 chips 的 `mt-6` 曾叠成 48px，参照只有 24px。

**主区「最近工作」退役**：参照的空态只有线框 / 问候 / 卡 / chips，而侧栏已承载全量任务列表；同屏两套会话索引把 hero 挤离中心。`RecentSessions` 组件与其测试一并删除（无其他消费者）。

**窗口框架**：窗口底改 `sunken`，侧栏不再画自己的底色，工作区列成为一张 `base` 底 + 1px 边 + 12px 圆角的面板（左缘 6px 窗口底），右栏同一配方（四边 6px inset）——参照的侧栏与页面是「同一层地面 + 一块浮起面板」，不是两块平铺色块。

**无边框窗口**：桌面壳 `decorations: false`；窗口控件（最小化 / 最大化·还原 / 关闭）由 `shell/WindowControls` 画在右上角，只在 Tauri 环境渲染（`plugin:window|*` + capabilities 的 `remote.urls` 授权）；侧栏顶行与设置页顶条承担窗口拖拽。内容因此从窗口 y=0 开始，与参照同样的比例。

**插件页**：列表改双列卡片网格（≥40rem 起两列、列距 24 / 行距 4），单卡 12px 圆角 / `12px 8px` 内距 / 无边框 / hover 才上底色，40px 图标块、名称 14/500、描述 13px；分组标题 16/500 + 1px 底线（参照 `text-ui-lg font-medium` + `h-px`）。

**设置页改整页视图**：撤掉遮罩与 800px 居中对话框，改为 `sunken` 底上浮一张 `base` 面板（6px inset / 1px 边 / 12px 圆角），左导航 268px + 1px 分界、内容列 `max-w-896` 居中；导航顶部「← 返回工作区」灰底行取代右上角 ×；内容列按语义分卡、卡间距 16。

**对话流**：`standard` 档不再折叠完成的回合（工作行铺在提问与回答之间，参照的转录没有「用时 X」横条），无工作步骤的回合不渲染 header；工作行字号 13 → 14；思考行改「正在思考」/「思考 持续了 N 秒」+ 240px 内滚动 + 左侧竖线，流式结束自动收起；`transcript-view` / `flow-rows` / `chat-markdown-dom` 三处测试同步改约。

**侧栏顶部与字体**：logo 行 60 → 48px；导航区与任务列表之间加 1px 分隔 + 12px 间距；字体栈在 `Microsoft YaHei` 前插入 `Microsoft YaHei UI`（Windows Chromium 为参照 `system-ui` 解析到的正是一支）。

**有意偏离（记名）**：菜单材料仍是半透明 + 40px 模糊（参照为不透明 `bg-menu`）；chips 文案为本地常量而非服务端 catalog。详见 `docs/NOVA-DESIGN-SYSTEM.md` §2.8。
