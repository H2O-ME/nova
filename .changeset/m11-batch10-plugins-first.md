---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

**一切皆插件落地 + 形态收敛到浏览器 UI（M11 批10–批11）**。两批一起发：批10 把内核能力全部变成可替换的插件服务，批11 删掉 TUI——两者合起来才是"一个内核 + 一种产品界面"的完整姿态。

### 一切皆插件（批10）

- **插件容器（`@nova-agent/core` 新公共面：`core/plugin/`）**：Cordis 式 `Context` / `Fiber`（pending→loading→active→failed→disposed，含依赖变更 reload）/ 服务键寻址（`key<T>()` + provider 换代驱动依赖方重载）/ 类型化事件（emit、waterfall、parallel、serial、bail 五种派发）/ `ctx.effect()` 撤销（**正确拆除由构造保证**）/ 结构化配置校验。`waterfall` 的胜出者是"自己返回了非 undefined 的那个"，`next(...)` 可委派并改写参数；`serial` 由第一个决定性裁决胜出（审批门是 priority 1000 的监听者）。
- **能力服务缝（新公共面）**：approval / llm / tools / commands / sessions / compaction / jobs / spill / skills / surfaces 全部成为**可按键替换的服务**，生命周期钩子成为内核事件（`beforeLlmCall` / `beforeToolCall` / `afterToolResult` / `pluginLoaded`）。历史插件 API（`{ name, activate(ctx) }` + `registerTool`/`registerCommand`/`registerHook`）在 `@nova-agent/plugins` 的宿主门面上被**适配**到容器——内置插件与第三方插件一行不改就获得正确生命周期。
- **配置层扩展点（新公共配置面）**：`~/.nova/config.json` 新增 `plugins.disable`（不加载的内置插件名）与 `plugins.extra`（额外插件模块：绝对/相对路径或包名，须以 `default`/`plugin` 导出 `{ name, activate }`）。**不改源码即可选择、替换或扩展任一能力**。拼错的 disable 名告警；extra 加载失败即启动失败。
- **可溯**：`/plugins` 打印 roster（名字 / 状态 / 注入的服务），数据源是 `kernel.roster()`。
- **内核装配只有一个点**：`createAgentKernel()` 从 325 行单文件拆成 env/roster/facade/session 四份；四个 runner 全部经 `cli` 的 `bootKernel()` 装配；provider 的会话亲和（`setSessionId`）改由 sessions 服务在 open/activate 时绑定——四处手写的 `bindSessionAffinity` 全部删除（WebUI 与 qqbot 的会话亲和此前靠手工接线，现在结构上不可能漏）。
- **单一实现**：审批答案解析三份合一（`core` 新增 `parseAskResult`，WebUI 帧 / 插件 asker / 桥接消息走同一解析器与同一 fail-closed 规则，理由与 scope 有界）；控制字符策略三份合一（`core` 新增 `hasControlChars`，多行字段例外一致）。
- **四个真 bug**（均有回归测试）：①审批弹窗答案若在 publish 内**同步**到达会被占位 resolver 吞掉 → run 永久挂死；②事件泵里抛错的监听器变成未捕获异常**杀掉进程**（现在转成 `notice` 上报）；③`prompt()` 先入内存后落盘，写失败时内存与磁盘发散；④`gateCompact` 被 `running` 守卫挡死——**自动压缩从未真正生效**，每轮都报一次幻影失败。

### 形态收敛（批11，破坏性）

- **TUI 整体删除**：`packages/tui`、`packages/tui-app` 与 Rust 包 `packages/tui-rs` 连同 CLI 胶水（`tui-mode.ts` / `rust-tui.ts` / `rust-tui-wire.ts`）全部移除；包数 8 → 6。
- **`nova` 的默认形态改为浏览器界面**（原来起全屏 TUI）。迁移：需要终端形态用 `nova --repl`（非 TTY 仍自动回落 readline REPL）；`nova --web` 保留为显式拼法。`nova exec` / `nova qqbot` 不变。
- **`@nova-agent/web` 导出变更**：`resolve_approval` 帧的 `answer` 现在是内核的 `AskResult`（线上解析走 `core` 的 `parseAskResult`），`WireAnswer` 与 `toAskResult` 随之删除；浏览器端照旧可以只发 `{reason}` / `{scopeWords}` 这类裸 grant，解析归宿主。
- **surface 认领表**（`cli/surfaces.ts`）：换默认形态时踩到的坑——首版把「非 TTY 一律回落 REPL」排在浏览器界面之前，于是管道里的 `nova --web` 被 REPL 抢走（真机冒烟脚本正是这么跑的：`stdio: ['ignore','pipe','pipe']`，改动后它会一直等 URL）。现在 `--web` 在两种 stdio 下都认领，只有 `--repl` 排在它前面；`cli/test/surfaces.test.ts` 用「四种调用 × 交互/非交互」的认领表直测钉住。
- **配置**：`ui.theme` 只影响 REPL（浏览器面有自己的明暗 token 档）；`--theme` 同理。
- 文档按新形态重建：`AGENTS.md` 重写（6 包架构、容器与服务缝、WebUI 契约、公共 API 六面），`README.md` 与配图重绘，随 TUI 过时的 `docs/`（`tui-design.md`、`MILESTONES.md`、外部工具生成且已失真的 `architecture/`）删除；版本测试改为**从磁盘发现工作区包并校验 changesets 锁步组**（原先它一直在检查一个已删除的包）。