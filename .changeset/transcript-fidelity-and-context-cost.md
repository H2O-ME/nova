---
"@nova-agent/core": patch
"@nova-agent/plugins": patch
"@nova-agent/web": patch
---

**子智能体在界面上从来没显示过**（不是「显示得不对」）。`subagent_update` 声明在内核协议里、前端也写好了对应的行并测过，但**全仓没有任何地方发布这个事件**：进度回调被留给各 surface 自己传，而四个装配点（web / repl / exec / qqbot）一个都没传，于是回调链在 `onSubagentProgress` 处断掉，那个行是死代码。现在与后台 job 同样处理（`jobs.setListener` 的先例）——**在装配点接线**，把嵌套循环的生命周期直接发到当前会话上；surface 仍可覆盖。

**首次请求的约 1 万上下文里，约 9500 是 AGENTS.md，而它一直被按字节计价。** 预算单位错了：估算器对中日韩字符约 1 token/字、对其它文本约 1 token/4 字，所以 32,000 **字节**的预算在这份中文文档（1.61 字节/字）上只买到约 9,400 tokens，却仍丢掉了文件的 47%。改为按 **token** 计（`PROJECT_DOC_MAX_TOKENS = 8000`，并通过 `projectDocMaxTokens` 暴露为配置项——dsh 里它也是配置而不是常量），截断点用同一套估算器二分求得，因此中日韩与 ASCII 不再被区别对待，切口仍落在完整字符边界。按本仓实测：注入量 18,019 → 8,000 tokens（44% 的文档）。

**上下文占用环在续接会话时虚高。** `ready` 的回退读的是 `run/stats.promptTokens`，而它是**一轮内所有请求的求和**（`RunMeter` 刻意累加），不是「窗口现在多满」。实测一轮两请求报 25,268 而真实最后一次请求是 12,920（**+96%**）。现在这个数由内核的 `lastPromptTokens` 负责：进程内跑过就走内存锚点，否则从日志投影里取**最后一条 assistant 消息自己的 `usage.promptTokens`**，surface 不再自己重建。

**弹窗没有入场动画。** dsh 的 `Modal` 让遮罩与卡片按同一时长和缓动淡入；本仓的工具侧板一直有，三个弹窗（设置 / 删会话 / 目录浏览）却是硬切，读起来是「闪一下」而不是「面板到来」。按 `ui-primitives/Modal.module.css` 的 `modalEnter` 补上，并在 `prefers-reduced-motion` 下停用。

**轮次 header 上那行 `22:21 · 用时 2.8s · 首 token 1.7s · 42 tok/s` 已删。** dsh 的 `TurnProcessNodeView` 就是 `[label][chevron]`，它的样式表里**根本没有 detail 类**；每次运行的时钟 / TTFT / TPS / 工具时间住在会话统计 pill 的弹窗与轨迹表里。那行既重复了 label 自己的「用时」，又把一坨数字塞进了参考实现空着的位置。

另外按行数门禁拆出 `agents-md-init.ts`（`/init` 的模板与「读链」是两件事，只共用一个文件名）。
