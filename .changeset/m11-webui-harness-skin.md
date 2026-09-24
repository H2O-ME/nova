---
'@nova-agent/web': minor
---

**WebUI 换肤：deepseek-harness 设计系统移植（MIT）**。旧 WebUI 的观感判定为不达标（零 token、硬编码深色一坨、Unicode 字符图标、无动效），本次不仿写、直接移植 harness 的资产（样式文件逐份 MIT 署名）：

- **三层 token + 明暗双档**：`ui/src/styles/`（static→alias→组件局部；`body[data-ds-dark-theme]`，首帧前解析，暗为默认，侧栏一键切换并记忆）。组件源码从此禁字面色——`style-guard.test.ts` 机检（零字面色、零 ANSI）。
- **三栏 AppFrame**：左侧栏（280px 默认、264–420 可拖、窄屏收为 56px 图标轨道/浮层展开）承载品牌、新建会话、按日期分组的会话列表、主题与连接状态；正文宽度轴 `clamp(680px, 64%, 920px)`；工具详情板改挂帧右缘（overlay + 发丝缝 + lv3 投影）。`Sessions.tsx` 推挤面板退役。顶部窄条只留会话标题 crumbs、上下文仪表与压缩；**审批档/执行模式切换移入 composer 工具栏**（harness：控件长在它治理的东西上）。转录列 `flex 1 0 auto` 保证 composer **恒贴底**（首版漏了这条 harness `.viewArea` 契约，短转录时输入卡悬在页面中部、下方整片死黑——真机截图抓到）。
- **composer 胶囊卡**：22px 圆角 + elevation-soft 描边投影、蓝色 caret、34px 圆形发送钮（空态半透明，运行中原地变中断钮）；审批卡/队列/统计条成为 composer 上方 dock 栈，转录在 sticky 渐隐座下滚过；新增回底按钮（零高度插槽）。
- **消息与工具行**：用户消息右对齐胶囊气泡、assistant 全宽 markdown；reasoning 收成 24px 折叠行；工具行 24px 密度——光晕状态点取代字符标记、运行中 300px 光泽带横扫、点击展开 IN/OUT 卡或**真 diff**（新纯模块 `diff-lines.ts`：LCS 交错 hunk + 上下文折叠 + `└ +A -R` 脚注，替换"先全部旧行再全部新行"的假 diff）；hover 浮现「详情」药丸。
- **markdown 渲染升级**（仍是元素树、无 innerHTML）：链接（仅 http(s) 给 href）、有序/无序列表、表格、引用、hr；代码块带 sticky 语言条与复制钮。图标全部换成手写内联 SVG。
- 后端帧协议与 `state`/`card-view`/`format` 纯逻辑契约**零改动**；新增 9 条纯函数测试（diff-lines 7 + style-guard 2），全仓 68 文件 / 766 测绿。
