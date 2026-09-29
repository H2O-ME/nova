---
'@nova-agent/web': patch
---

**提问卡 UI 对齐参照实现 dsh（用户反馈「效果简陋」后重做）。** 提问卡此前借用了审批卡的彩色顶部条（`等待确认` + 圆点 + 序号徽章），而 dsh 的 `ui-user-questions` `QuestionComposer` 是**干净卡片**——问题文本本身就是卡片标题（16px/500 的 `h2`，可选的 `header` 作眉标），右上角是折叠 / 放弃两个 24px 图标按钮，**没有彩色条**。已按 dsh 逐行对齐：

- **头部**：`strip` 移除，问题文本升为 `h2` 标题（`question.header` 有值则作眉标），右侧新增「折叠 / 展开」按钮（`cardMinimized` 让卡片收成标题行，方便读上面对话）与「放弃整组问题」。
- **选项**：单选前加**序号指示器**（20×20 数字徽章），多选前加**勾选框**（14×14、选中时实心 + 勾）；选中态改为轻浮层背景 + 细边（`interactive-bg-hover` + `border-l2`），不再是业务色粗背景。
- **自定义答案**：有选项时是**选项形状的一行**（`customRow`，带指示器、多选镜像勾选态；单选显示编辑图标），与选项并列；无选项时才是独立框（`customBlock`）。
- **底部**：翻页器独立成 `‹ 上一题 n / m 下一题 ›` 的 `pager`，进度不再挤在徽章里；`跳过` / `下一题·提交` 按钮、错误反馈（右对齐 `role="status"`）。
- **视口**：卡片 `max-height: min(60vh, 520px)`，选项区滚动；卡宽沿用 `--dsh-chat-content-width`（与旁侧输入卡的关系不变）。

**一刀边界**：审批卡的彩色顶部条**不是简陋**——dsh 的 `ui-approval` `ApprovalPanel` 本来就是 warn strip（`StateDot` + `waiting`），所以审批卡保持原样、未动。两张卡因此不再同款，但那正是 dsh 的本相：审批是警告，提问不是。

**验证**：`question-panel` 契约测试 23 条全绿（`renderToStaticMarkup` 车道，无 DOM）；变异验证把 `title` 改回 ordinal 形式 → 2 条测试立刻变红，已恢复。`style-guard` 9 条全绿（用到的每个 `--dsw-*` token 都在 token 层声明、每个 CSS 类都有消费者、每个内联 SVG 有设计盒）。`pnpm --filter nova-web-ui build` 产物哈希已变。`pnpm lint` 0 错误。web/ui 全量 787 条测试通过。
