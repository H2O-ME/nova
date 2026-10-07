---
'nova-web-ui': minor
'@nova-agent/plugins': patch
---

两处按操作者点名对齐 dsh（2026-10-06，见 `docs/dsh-parity-inventory.md` 第 21 轮）。

**上下文面板补「Token 统计」环**（对齐第三方 dsh-context）：

- 新增环形卡：几何逐值移植参照的 `donut.tsx`（`viewBox 42`、`r = 15.9155`、`stroke-width 4`、`offset = 100 − consumed + 25`、段间 0.5 两端各切一半、只写 `from` 的入场关键帧）。纯几何在 `context/donut-model.ts`，环组件 `context/Donut.tsx` 只画不算。
- **口径 = 计费口径**：环心总量取 `SessionTotals` 的 `promptTokens + completionTokens`，与 composer 的用量药丸**同一个对象**，两处数字不可能打架；类别 token 按 `live.cats` 比例分摊并标 `≈`（估算），占比是真读数；没计费时环心画 `—`。
- 上下文视图头部改双列（统计条 + 环卡，`auto-fit minmax(min(360px,100%),1fr)`，窄窗自动落两行）。
- **两条记名偏离**：输出段用 `--dsw-static-red-500`（本仓 token 层没有参照的粉色 ramp，色号不同、语义位次相同）；参照在输出旁注「含思考」不写（本仓内核不单列推理 token，写了就是编造）。

**插件中心从「设置弹窗第三节」搬到「侧边栏顶层页」**（对齐 dsh `ui-plugin-manager` 的 `PANEL_ID = 'plugins'` + `sidebar.panellist`）：

- 侧边栏在「新会话」下方新增顶层入口（36px 行 / 收起态 36×36 轨道钮，`aria-current="page"` 只在打开时给），主栏由 `PluginCenterPage` 承接——**渲染的还是同一个 `PluginsSection`**，一个实现一个门；`App` 只持一个布尔。
- **离开插件中心的手势先关它**：`new_session` 与 `resume` 两条路径都先调 `onLeavePlugins()`，否则点会话行会因「已是当前会话」的早退而看起来毫无反应。
- 删除设置里的 `plugins` section 及其导入；设置弹窗注释同步改写。
- 顺带删掉 `PluginsSection` 已无人传的 `onClose` prop（声明了却永远没人传的死参数）。
- **记名偏离**：参照每个插件有自己的图标，本仓插件清单没有 artwork，统一用 `PluginIcon` 图标座。

新增 `token-stats.test.tsx`（8 条）与 `plugin-center.test.tsx`（4 条），两条变异验证（环心总量改回分类求和、行内描述改成只在展开时渲染 → 各自立刻变红）。

plugins 半边（`runtime-switch`）：翻转一个**连导入都没成功**的插件时，失败原因此前从 loader 的 live entry 上取——那行根本没到过 loader，entry 上只有翻转前的旧禁用行、无错误，报错就成了无因的「did not load」。现在从 tree 行兜底取 error。
