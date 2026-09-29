---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/tui': minor
'@nova-agent/tui-app': minor
'@nova-agent/web': patch
'@nova-agent/cli': minor
---

以插件形态恢复终端界面（TUI）：`nova --tui`，显式 opt-in，管道下自动回落 `--repl`。

参考 `dsh-TUI`（dsh 的 TUI 插件）补齐「dsh 只有 WebUI」的缺口，但**不移植它的实现**——那一层是 React 19 + react-reconciler + Ink 与约 30 个 `@deepseek-ai/*` peer，而本仓的 surface 姿态是零第三方依赖。移植的是**能力**，实现用本仓自己的分层：

- **`@nova-agent/tui`（新增，零依赖）**：字符宽度表（CJK/emoji 双宽）、ANSI 清洗、键序解码、cell 网格与增量重绘。**不认识内核**——它只认「字符格 + 按键」。空白的依赖白名单由 `dep-direction.mjs` 机检，所以「零依赖」是门禁保证的性质而非约定。
- **`@nova-agent/tui-app`（恢复并扩展）**：与 web 同构的 surface。`blocks.ts` 归约、`panels.ts`/`question-card.ts` 渲染、`keys.ts` 键链全是纯函数（`tui` + `tui-app` 共 17 个测试文件 / 261 个断言，全部在无 TTY 的测试车道直测），`app.ts` 只做「把纯层输出写进 stdout」。当初 TUI 被删的三条理由中，前两条由这次分层直接解掉：渲染层不再与产品逻辑纠缠，终端状态只有 `stop()` 一个出口。
- **提问卡**：`ask_user_question` 在终端也画得出来并答得了，语义与 web 侧逐字对齐（`question.ts` 是 `web/ui/src/question/decisions.ts` 的一对一移植）——跳过算决定、选项与自由文本互斥、id 走 `Object.hasOwn` 防原型链命中。
- **`userQuestions: true`（`cli/src/tui-mode.ts`）**：这是 `ask_user_question` 的 opt-in，默认 false 且 fail-closed。恢复 TUI 时它正是漏的，于是工具在、UI 在、提问永远不发生（模型只会收到 `no user-questions answerer accepted the request`）。三个装配点（`kernel-boot` / `web/controller` / `tui-mode`）现在一致。
- **`pendingQuestions()` 回放**：`start()`/`setAgent()` 除了挂起审批还要回放挂起提问，否则在一个已经停等中的 run 上永远画不出卡片——那个 run 的事件早已发完，而 surface 是后挂上来的。
- **`--tui` 的认领规则**：排在 `web` 之前（否则默认形态会吃掉它），但带 `interactive` 前置条件，所以朝管道画帧不可能发生；`--tui --repl` 时 `repl` 胜出。两个方向都有直测钉住。
- **argv 解析拆出 `cli/src/cli-args.ts`**：`parseArgs` 与「谁来服务这行命令」是两个问题，拆开后 `surfaces.ts` 的上限从 258 降到 205。
- **`tui`/`tui-app` 纳入锁步版本组**，工作区 9 个成员、8 个受白名单管辖。

**未解决**：TUI 的真机验收仍无法自动化（`pnpm smoke:web` 的终端对应物还不存在），这是它当初被删的第三条理由，也是唯一没被这次恢复解掉的一条。见 `AGENTS.md` §7.4。
