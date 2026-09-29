# @nova-agent/tui-app

## 0.4.0
### Minor Changes

- b21a782: 把终端界面（TUI）从 cli 的内置功能改造为**配置驱动的动态 surface 插件**——兑现「`nova --tui` 是一个插件，不是 cli 源码里硬挂的内部 surface」。
  
  这次是对 `tui-surface-restore` 那一份 changeset 描述的机制的**结构改造**（机制变了，功能没变）：TUI 不再是 cli 自带的 surface，而是 `tui-app` 通过公共 `AgentSurface` 契约导出的一个插件，由 `~/.nova/config.json` 的 `surfaces` 行点名后动态加载。参照系是 dsh：host 源码永不点名 `@deepseek-harness-tui/dsh-tui`，它在 `cordis.yml` 的 `plugins` 行里被动态解析。
  
  - **`@nova-agent/core`**：`AgentSurface*` 契约从 `kernel.ts` 拆出到 `surface.ts`，kernel.ts 收为纯 barrel（结构预算要求拆不要求抬）。契约仍是纯类型、零实现，core 不认识任何具体 surface。
  - **`@nova-agent/plugins`**：新增 `surface-registry.ts`——`createSurfaceRegistry()`（数组注册表）+ `loadSurfacePlugins(specs, cwd)`（动态 `import()`、`default ?? surface` 具名导出、`isAgentSurface` 校验 `{name,claim,start}` 三件齐备、缺一即启动失败）。`resolveModuleSpec` 与 `loadExtraPlugins` 共用同一原语。`surfaces` ServiceKey 仍声明、仍**无容器提供者**（刻意死缝：注册表必须先于内核装配存在，而容器是内核装配的产物——往容器里 provide 一个「内核还没装好时就要用」的东西自相矛盾）。
  - **`@nova-agent/tui-app`**：新增 `src/surface.ts` 插件入口——`export const tuiSurface: AgentSurface`，`claim` 读 `flags.tui && !flags.repl && interactive`，`start` 走 `startTuiSurface(runtime)`。package.json 新增 `"./surface"` 子路径导出，tsdown `entry` 加 `src/surface.ts`。`answersQuestions: true` 由 surface 自己声明。
  - **`@nova-agent/cli`：`cli` 的白名单从 `[plugins, ai, core, qqbot, web, tui, tui-app]` 收窄到 `[plugins, ai, core, qqbot, web]`——`tui`/`tui-app` 刻意不在列**。这是 dsh 模型：host 源码不点名 surface 包。`dep-direction.mjs` 的正则扫**全文件文本**（含注释与字符串），所以 cli 源码里**零** `@nova-agent/tui`/`@nova-agent/tui-app` 字面量——`grep` 已验。`tui-mode.ts` 删除；`tui` 的 `SurfaceEntry` 与 `import('./tui-mode.js')` 从 `surfaces.ts` 删除。
  - **`cli/src/surface-host.ts`（新增）**：`buildSurfaceRuntime(surface, m, argv)` 是**任何动态加载 surface 的通用装配点**（调用点 ③）——`runSurface()` 调 `surface.start(runtime)`，host 装内核。`userQuestions` 从 `surface.answersQuestions ?? surface.interactive` 推导（不再手抄），TUI 路径因此与 `repl`/`web` 同源——这正是 `tui-surface-restore` 漏的那一行，如今由 surface 自己声明、host 读取。`toAgentSurfaceRequest`/`toCommandPorts`/`toFlags`/`toDiagnostic` 适配。
  - **`cli/src/surfaces.ts`（重写）**：`loadDynamicSurfaces(config, cwd, argv, registry)`——`config.surfaces` 缺省→`[]`；否则 `loadSurfacePlugins` + `registry.register` + 适配成 `SurfaceEntry`（claim/start → `runSurface`）。`resolveSurface(m, extras=[])` 把动态 surface 放在 SUBCOMMAND 与 DEFAULT 之间。先序遍历保留：子命令仍最高、`--repl` 仍强过 opt-in、浏览器仍兜底。
  - **`cli/src/config.ts`**：`surfaces: z.array(z.string().min(1)).optional()`，schema 仍是 `.strict()`。注释用裸名「tui-app 包的 ./surface 子路径」——不含 `@nova-agent/` 字面量，正则安全。
  - **`cli/src/index.ts`**：`main()` 先 `createSurfaceRegistry()` + `loadDynamicSurfaces(config, process.cwd(), args, registry)` 再 `resolveSurface`。`--tui` 未在 `surfaces` 配置时给一条引导错误（点名「tui-app 包的 ./surface 子路径」），而非静默回落到 web——一个显式 opt-in 不该静默选错端。
  - **`cli/package.json`**：从 dependencies 删除 `@nova-agent/tui` 与 `@nova-agent/tui-app`——cli 不再静态依赖 surface 包。
  
  **测试**：`cli/test/surfaces.test.ts` 重写（注入一个 fake tui surface 作 `extras`，钉死动态层优先级与回落，7 个用例）；`plugins/test/surface-registry.test.ts` 新增（真实临时 `.mjs` 模块：default/surface 具名导出、no-export 拒绝、import 抛错拒绝、相对路径，9 个用例）；`tui-app/test/surface.test.ts` 新增（claim 的四个方向直测，6 个用例）。
  
  **门禁证据**：`pnpm gates` → 「依赖方向：8 个包全部符合白名单」「行数预算：409 个 src 文件全部在上限内」；`pnpm verify` → build/typecheck 全 Done、175 文件 2034 测试通过（+16）；`grep @nova-agent/tui packages/cli/src` 零命中。**「cli 不能静态依赖 surface 包」是机检红线**，不再靠约定。
  
  **未解决**：①根 `package.json` 尚未加 `@nova-agent/tui-app` 工作区依赖——裸 spec `@nova-agent/tui-app/surface` 在 monorepo dev 下从仓库根解析是否走通，需 `pnpm build` 后真机 `pnpm nova --tui` 验证（需 `~/.nova/config.json` 的 `surfaces` 行声明）；②TUI 真机验收仍无法自动化（`tui-surface-restore` 的第三条理由延续）；③调用点 ① ② 的 `userQuestions` 仍各自手传（repl/web 显式 `true`，exec/qqbot 默认 `false`）——只有 ③ 从 surface 声明推导，因为它服务第三方 surface。
- b21a782: 以插件形态恢复终端界面（TUI）：`nova --tui`，显式 opt-in，管道下自动回落 `--repl`。
  
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

### Patch Changes

- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [b21a782]
- Updated dependencies [436d7b3]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
  - @nova-agent/core@0.4.0
  - @nova-agent/plugins@0.4.0
  - @nova-agent/tui@0.4.0

### Minor Changes

- 1b6376d: **TUI 全量重写：删除旧实现，新增 `@nova-agent/tui-app`**（M11 批4）。旧 `@nova-agent/tui-view` 全包（≈3,000 行纯视图层）、`cli/tui` 壳（≈4,500 行）与旧 `tui-mode.ts` **一行不留地删除**——渲染计算与产品逻辑长期纠缠、反复拖累开发。新包是 `nova` 的默认形态（非 TTY 与 `--repl` 仍回落 readline REPL）。
  
  - **三层分工**：纯函数层（`blocks` 事件归约 → `entries` 滚动条目 → `render` 显示行 → `panels` 卡片 → `frame` 整帧装配，`Palette` 注入、可假时钟直测）／按键层（`keys.ts` 一个 reducer：审批 → 模态面板 → 全局键 → 输入区，动作是描述不是执行）／壳层（`app.ts` 只留 alternate screen、raw 键盘、**一个时钟** `TICK_MS=33`、内核订阅与 tps/cache 计量——壳层不做版面算术）。
  - **M10 的逐值设计成果全部移植**：GrokNight RGB 四档调色板（truecolor / 16 色 / light / plain）、`layout.ts` 度量与**整屏一条左缘**、留白节奏与密度规则（工具行紧排、其余块一空行、提问自带 vpad）、**动词短语聚合行**、工具行**三态折叠**、reasoning 定高活窗口、导轨 `sin²` 行波、`<10s` 一位小数的活体行、贴底锚定（仅"转录里只剩欢迎卡"时居中）、输入卡 / 审批卡 / 队列 lane / 快捷键条 / 欢迎卡 / 列表面板。
  - **键位**：`Enter` 发送、`Shift+Enter` 换行、`/` 命令面板（Tab 补全 / ↑↓ 选择）、`Tab` 未开会话前循环 普通→PTC→混合、`↑↓` shell 式输入历史（草稿自动寄存）、`PageUp`/`PageDown`/滚轮滚动、工具行点击三态折叠（动词组行点击即展开成员）、`Ctrl+C` 中断 → 清草稿 → 两段退出、`Esc` 中断。
  - **保留的交互**：长粘贴折成 chip（缓冲区存全文，提交一字不差）、审批「总是允许」行 ←/→ 调授权词数（词前缀匹配）、「拒绝」行打字补理由并回流给模型、外部内容显示净化与焦点重读（沿用 `@nova-agent/tui`）。
  - **有意的取舍**：上下文仪表只有总量（无分区着色、无悬停换形）；↑↓ 是历史而非多行光标移动；启动**不等** models.dev（`contextWindow` 先取配置，目录异步到达后回填，冷缓存/断网不再先给十几秒空屏）。
  - **同批修掉的真 bug**：彩色终端下状态栏整字段被丢（调色板字符串用 `.length` 算宽 → 改走 `stringWidth`）；动词组行的 `▸` 是死 affordance（点击无反应 → `toggleEntry` 认 `group:` 前缀）。

### Patch Changes

- Updated dependencies [1b6376d]
- Updated dependencies [b6255b3]
- Updated dependencies [1e35cdb]
- Updated dependencies [1b6376d]
- Updated dependencies [1b6376d]
- Updated dependencies [42c1bfb]
- Updated dependencies [37ea5d6]
- Updated dependencies [1e35cdb]
- Updated dependencies [1e35cdb]
- Updated dependencies [ef55de7]
- Updated dependencies [1999ce0]
- Updated dependencies [1fc1728]
- Updated dependencies [3d9b23a]
- Updated dependencies [3f15834]
  - @nova-agent/plugins@0.4.0
  - @nova-agent/core@0.4.0
  - @nova-agent/tui@0.4.0
