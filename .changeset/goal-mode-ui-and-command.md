---
'@nova-agent/plugins': minor
'@nova-agent/web': minor
---

**目标模式：输入框里终于有反馈，`/goal` 也能真的设定目标。**

参考实现（dsh `ui-goal` + `ui-conversation` 的 composer）里，斜杠目标模式有两处专门的呈现：输入框在草稿停在 `/goal ` 时画一行**提示语**，且这行提示会用「当前有没有目标」消歧；宿主则把 `/goal <目标>` 当真建立一个目标。Nova 此前两处都缺——输入框零反馈，`/goal` 只认查看与 clear，于是「目标模式」在界面上不可观测。

- **命令**（plugins）：`/goal` 语法对齐参考实现的 `parseGoalCommand`——`<目标>` 建立、`edit <目标>` 修改、`pause` / `resume` / `clear` 是精确控制词、空参数查看；输出随状态给出一行**可用命令表**（进行中 → `edit`/`pause`/`clear`，已暂停或受阻 → `edit`/`resume`/`clear`，已完成 → 新建/`clear`）。已有目标时再输一个目标**拒绝**而不是静默替换（轮次计数属于已经开始的活），`edit` 保留同一个目标与预算；`complete` 是终态，`pause`/`resume` 对它明确拒绝并指向正确动作。语法与生命周期各成一件事，故从 `kernel-commands.ts` 拆到 `goal-command.ts`；每次写入仍只走 `AgentSession.announceGoal`（先落日志、再广播）。
- **输入框**（web/ui）：新增 claim 提示（`composer/claim-hint.ts`）——草稿是注册表认得的命令、且参数仍为空时画一行 ghost hint；`/goal` 有两个变体，由**是否已有目标**决定（`hint.goal` / `hint.goal.active` 的消歧，与参考实现的键规则逐字一致），文案取参考实现 zh 词表的原文。于是提示语与命令互为承诺：提示说能输目标，就真的能建目标。草稿的「首 token + 参数」解析收敛成 `command-menu.ts` 的 `draftCommand()`，命令帧与提示共用同一份判断。
- **回放安全**（web）：目标仍只有一份存储——log-only 的 `goal/change`，读者看到的都从它来（活的是 `goal` 事件，切换会话或重启是 `ready.goal`）。新增端到端回放测试：`/goal 发布 v1` 之后**换一个进程**读同一份日志，基线里目标完好、轮次计数一致；且目标续做注入的那条**临时提示词不会**作为用户消息出现在日志或回放里（与压缩摘要同一类陷阱：core 写给模型看的东西绝不能被画成用户说过的话）；`clear` 是**被记录的状态**，重启不会把目标从更早的事件里复活。
