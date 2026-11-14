---
'@nova-agent/web': minor
'@nova-agent/cli': patch
---

WebUI 首页整页对齐 ZCode 桌面端（2026-11-14 拍板「完全一致优先」，参照值取自 ZCode UI 克隆仓 zai-light）。

**主题底座**：亮色平面改为 `#f8f8f8` 页面 / `#f0f0f0` 侧栏 / 白色浮层；中性族统一到 `rgba(13,13,13,…)` 族（边框 subtle 5% / strong 10%、交互 hover 5%）；新增 composer 卡专用 token（`--nova-surface-input`、`--nova-input-border[-hover|-focused]`、`--nova-elevation-composer` 柔和双层阴影，暗色为 0 阴影）。

**侧栏**：默认宽 264px；新增「按时间」视图为默认分组（今天/昨天/N 天前/本周/上周/本月/更早，日历日语义，原「按工作区」树保留在视图菜单）；条目两行化（标题 / 工作区·相对时间）；新建任务行带 Ctrl+N 提示（壳层新增真实 Ctrl/Cmd+N → 新会话绑定）；底部改为身份块（头像字母 + Nova）+ 连接指示 + 设置齿轮。

**Hero**：问候语换为参照六档文案（边界不变），字号带 30/20；标题行内 34px 星标退役，改为整高 hero 区的静态品牌线框背景（`HeroBackdrop`，顶锚 `max(52px, 29dvh)`、内容列 672px）。

**Composer**：卡壳 16px 圆角 / 0.5px token 边框 / 12px 内距 / 柔和阴影 / hover-focus 边框加深；hero 的工作区 chip 移入卡内第一行（参照 `contextHeader` 座位）；44px 文本底线守恒不变。

**有意偏离（记名）**：不做建议词条 chips、「自动化」导航项、agent 下拉 / git 分支 / worktree / 麦克风（均无对应功能）；深色主题只随共享槽位联动。详见 `docs/NOVA-DESIGN-SYSTEM.md` §2.8。
