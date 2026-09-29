# AGENTS.md — NovaAgent

> 本文件是仓库的**唯一权威文档**。`README.md` 只是门面页。**机制变了就改这里**；行数口径是 `scripts/structure-budget.json` 的 `split('\n').length`。

## 1. 这是什么

自研、插件化、轻量化的跨平台本地 agent 运行时：在**当前工作目录**运行，通过任意 OpenAI 兼容端点对接模型，以「一切皆插件」的内核统一扩展工具、斜杠命令、钩子、Skills 与能力服务；界面只是同一内核事件流的消费者。所有数据集中在 `~/.nova/`，**运行目录零写入**。

- **运行时**：Node.js ≥ 20；PTC 代码模式要求 ≥ 22.19（`stripTypeScriptTypes`）。
- **工具链**：TypeScript（strict，`noUncheckedIndexedAccess`）、ESM-only；构建 `tsdown`、测试 `vitest`、lint `oxlint`、包管理 pnpm。无 prettier。
- **平台**：Linux / Windows 为测试目标（macOS 顺带兼容）。路径一律 `node:path` + 抽象层，**禁止硬编码 `/` 或 `\`**。
- **参照系**：pi（分层包结构）、deepseek-harness（一切皆插件 / Cordis 式容器 / WebUI 设计资产）、openai/codex（AGENTS.md 发现链 / 审批 / 可回放会话日志）。

## 2. 常用命令

```bash
pnpm install
pnpm build         # pnpm -r build：各包 tsdown 构建（连带产出前端产物）
pnpm dev           # tsx 直跑 cli 源码（免构建）
pnpm test          # vitest run（不联网；ai 层注入 fetch + SSE fixture）
pnpm typecheck     # pnpm -r typecheck（逐包 tsc --noEmit）
pnpm lint          # oxlint packages（含 complexity / 长函数 warn）
pnpm gates         # 结构棘轮：依赖方向白名单 + 逐文件行数上限
pnpm gates:update  # 同步行数上限（下调静默；上调逐条打印 RAISED）
pnpm check         # 快环：lint + gates + --changed 测试
pnpm verify        # 全环：build + typecheck + test + gates
pnpm smoke:web     # 真机冒烟 nova --web（走真 provider，故不在 verify 里）
pnpm nova          # 跑 dist：TTY 上默认起浏览器界面
pnpm release       # changeset version + sync root version + commit + tag
```

> ⚠️ `pnpm nova` 跑的是 **`packages/cli/dist`**，改完 `src` 必须 `pnpm build` 才生效（`pnpm dev` 走 tsx 直读源码）。

> ⚠️ `packages/web`、`packages/cli` 解析 `@nova-agent/{plugins,core,web}` 的类型取**已构建的 `dist/index.d.mts`**。改了 core/plugins 要先 build 再 typecheck 依赖方。

**`nova` 的五种形态**（认领规则见 §4）：

- `nova` → **浏览器界面**（`@nova-agent/web`，默认）：单 Node 进程 = HTTP 静态托管 + 单 WebSocket 事件流。启动打印**一次性带 launch token 的 localhost URL**，校验后落 HttpOnly 签名 cookie；绑定地址强制回环。`NOVA_WEB_PORT` 可固定端口（前端开发流：先 `nova --web`，再在 `packages/web/ui` 跑 `pnpm dev`，http/ws 全代理）。`--web` 是这个默认形态的**显式拼法**，不是另一个 surface。
- `nova --tui` → **终端全屏界面**（`@nova-agent/tui-app`，**配置驱动的动态 surface 插件**）：alternate screen + 原始键盘 + 一条内核订阅。**需 stdin/stdout 都是 TTY**，管道下自动回落 `--repl`（朝管道里画帧只会吐出一堆转义序列）。显式 opt-in，不改默认形态。**需先在 `~/.nova/config.json` 的 `surfaces` 行声明 `@nova-agent/tui-app/surface`**——cli 源码不静态依赖 tui-app，未声明时 `--tui` 给一条引导错误而非静默回落（§4）。
- `nova --repl` → readline 终端形态（非 TTY 自动回落；`--repl` 是「强制回落」而非兼容 no-op）。
- `nova qqbot` → QQ 机器人（需 `qqbot.appId` / `clientSecret`；对端独立会话，永不交互审批）。
- `nova exec "<task>" --json` → 非交互单次执行（JSONL 事件流；未放行的审批自动拒绝）。`--json` 下另有控制行 `run_error` 与 `notice`；SIGINT 优雅中止。

## 3. 配置（唯一来源 `~/.nova/config.json`）

项目目录里**不需要、也不会产生**任何 `.nova/` 文件。schema 是 `packages/cli/src/config.ts` 的 **zod `.strict()`**：未知键（如拼错的 `apporval`）在加载时报错并点名。`apiKey` 支持 `{env:NAME}`（未设置即报错，不静默变空串）。**字段清单以该文件为唯一事实来源。**

```jsonc
{
  "provider": {                       // 可选；缺省即「未配置」空壳，首次由设置页写入
    "baseURL": "https://api.example.com/v1",
    "apiKey": "sk-...",              // 或 "{env:MY_KEY}"
    "model": "model-name",
    "temperature": 0.7,               // 可选：0..2
    "maxTokens": 8192,                // 可选：正整数 → max_tokens
    "contextWindow": 200000           // 可选：窗口兜底（缺省查 models.dev）
  },
  "providers": [                      // 可选：BYOK 多供应商；`provider` 是活动项镜像
    { "id": "default", "name": "显示名", "baseURL": "https://…/v1",
      "apiKey": "{env:K}", "models": [ /* 与顶层 models 条目同形 */ ] }
  ],
  "activeProvider": "default",        // 可选：活动供应商 id；悬空回落第一个
  "models": [                         // 可选：非空即「全量接管」菜单（见 §5 模型端）
    { "id": "gpt-x", "name": "显示名", "contextWindow": 128000,
      "maxOutput": 8192, "inputModalities": ["text","image"],
      "outputModalities": ["text"], "attachment": true,
      "reasoning": true, "toolCall": true }
  ],
  "approval": "read-only",            // read-only | auto-edit | full
  "notify": true,                     // 可选：NOVA_NO_NOTIFY=1 亦可关
  "systemPrompt": "补充指令…",         // 可选：注入首条上下文片段
  "maxTurns": 30,                     // 可选：单次任务最大轮数（上限 500）
  "autoCompactTokenLimit": 60000,     // 可选：上轮 prompt tokens 超限自动压缩
  "projectDocMaxTokens": 8000,        // 可选：AGENTS.md 链 token 预算（按 token 非字节）
  "ui": { "theme": "dark" },          // 可选：REPL 外观（NO_COLOR 恒定无色）
  "plugins": {                        // 可选：插件 roster（配置层扩展点）
    "disable": ["todo"],              // 关掉的内置插件（核心功能不可关，见 §5 插件分层）
    "enable": ["subagent"],           // 开启的进阶插件（advanced 默认关；关闭＝从此表移除）
    "extra": ["./my-plugin.mjs"]      // 额外插件源（路径或包名；加载失败即启动失败）
  },
  "tools": {
    "bash": { "enabled": true, "timeoutMs": 60000, "shellPath": "C:/Program Files/Git/bin/bash.exe" },
    "code": {                          // 可选：PTC 模式（native|ptc|both，缺省 native = 关闭）
      "mode": "ptc",
      "maxParallelSubCalls": 10,       // 单 run_code 内并行子调用上限（≤100）
      "computeMs": 30000, "maxWallMs": 60000,
      "maxOutputBytes": 1048576, "maxOldGenerationSizeMb": 256
    }
  },
  "qqbot": { "appId": "xxx", "clientSecret": "{env:QQBOT_SECRET}" },
  "surfaces": ["@nova-agent/tui-app/surface"]  // 可选：动态 surface 插件模块 spec（包名或 ./rel.mjs）；加载失败即启动失败
}
```

**`surfaces` 是 `plugins.extra` 的 surface 版**（§4）：每行一个模块 spec，由 `plugins/src/surface-registry.ts` 的 `loadSurfacePlugins` 动态 `import()`。模块以 `default`（或 `surface` 具名）导出一个 `AgentSurface`，校验 `{ name, claim, start }` 三件齐备，缺一即**启动失败**——与 `plugins.extra` 同一条纪律：静默忽略一个扩展比坏掉的启动更糟。**cli 源码不静态依赖任何 surface 包**：`surfaces` 行点名谁就加载谁，加一个 surface 是改配置，不是改 cli 源码。`--tui` 未在 `surfaces` 声明时给一条引导错误而非静默回落（§4）。

**`plugins` 是配置层扩展点的正式入口**：不改源码即可关掉任一内置插件或加载自写插件。`extra` 模块须以 `default`（或 `plugin`）导出一个 core `Plugin`（`{ name, inject?, Config?, apply(ctx) }`，`apply` 可用 `registerTool` / `registerCommand` 注册工具与命令），走与内置插件**完全相同**的容器 API 与审批门。拼错的 `disable` 名会告警；加载失败的 `extra` 直接让启动失败——静默忽略的扩展比坏掉的启动更糟。

**插件分三层**（`plugins/plugin-tier.ts`）：**core** 不可关且不渲染开关（注册表与服务、`fs-read`/`fs-write`/`search`/`ask-user`）；**standard** 默认开、可关（`bash`/`jobs`/`todo`/`goal`/`workspace`）；**advanced** 默认关、写 `plugins.enable` 才加载（`subagent`/`ptc`/`qqbot`）。生效规则只有一个函数 `enabledByTier`：`disable` 命中→关（**disable 优先**，安全侧）→ `enable` 命中→开 → tier 默认。未知名字 fail-open 到 standard——把第三方划进 core 会让它**永久不可关**。持久化分工：standard 写 `disable`，advanced 写 `enable`（关闭＝移出）。**有两个录取口的行是例外**：`ptc`（`code.mode !== 'native'` 即录取）与 `qqbot`（配置里有 `qqbot` 块即录取）——推导经 `plugin-tier.ts` 的 `impliedOptIns` **让位于显式 `disable`**（boot `kernel-config.ts` 与 live `runtime-roster.ts` 的 `codeModeOptIn` 走同一规则），所以这两行**两个方向都写**：关闭也写 `disable`，否则推导在下次启动把它复活，开关「自动打开」。`ptc` 关闭同时把生效 `codeMode` 归回 `native`（boot 侧在 `kernel-config.ts` 投影、live 侧在 `runtime-switch.ts` 跟随；文件保留操作者自己的 `tools.code.mode`，重新打开该行即恢复），且 `runtime-facade.ts` 的 `setCodeMode` 在 `ptc` 行被关时**拒绝**非 `native` 模式——插件没加载的模式绝不运行。

Skills 的发现根按优先级：项目 `.agents/skills/` → 项目 `.nova/skills/`（向后兼容）→ 用户 `~/.agents/skills/` → 用户 `~/.nova/skills/`（向后兼容）；目录包 `<name>/SKILL.md` 与扁平 `<name>.md` 都认。frontmatter 仅 `name` / `description`（**支持 YAML 块标量** `>-` / `|`），同名时**项目级优先**。

## 4. 架构

pnpm monorepo，依赖方向由 `pnpm gates` 机检。工作区 **9 个成员**（`packages/*` 加 `packages/web/ui`），**8 个受白名单管辖**：

| 包 | 职责 |
| --- | --- |
| `core` | provider 无关的 agent 循环（async generator 事件流）、append-only 消息模型、会话持久化与投影、工具调度、token 预估、请求级修剪、后台 jobs、**插件容器**、**内核句柄与事件协议**、审批与呈现词汇表、向人提问、surface 目标校验、工作区文件与目录枚举 |
| `plugins` | **插件世界与内核装配**：工具宿主（core `{ name, inject, apply }` 协议）、审批引擎、内置工具（含 `ask_user_question`）、skills、**命令目录唯一生产者**、`createAgentKernel`、roster、AGENTS.md 读链与 `/init` 模板 |
| `ai` | OpenAI 兼容手写客户端：fetch + SSE 流式、工具调用、重试与断流自愈、usage/缓存命中提取 |
| `tui` | **终端渲染底座**：字符宽度表（CJK/emoji 双宽）、ANSI 清洗、键序解码、cell 网格 + 增量重绘。**零依赖、不认识内核**——它只认「字符格 + 按键」，所以任何包都能依赖它，而它不把任何产品概念带进渲染层 |
| `tui-app` | **终端 surface**：transcript 归约（`blocks.ts`）、卡片渲染（`panels.ts` / `question-card.ts`）、键链（`keys.ts`）、批准与提问两张接管卡、帧装配（`app.ts`）。只依赖 `core`/`plugins`/`tui` |
| `web` | **浏览器 surface 后端**：HTTP 静态托管 + 单 WS 事件流；launch token → HMAC 签名 HttpOnly cookie；自写 RFC6455（**零第三方依赖**） |
| `qqbot` | QQ 机器人接入插件（**第三方插件编写示范**，只依赖 core/plugins 公共 API） |
| `cli` | 产品壳（**surface 装配**）：argv → 装配哪个 surface + 配置发现 + 模型元数据 |

前端子包 `packages/web/ui`（private `nova-web-ui`）是浏览器侧，React 18 + Vite 7 + Tailwind 4。

**依赖方向白名单**（`scripts/dep-direction.mjs` 的 `ALLOW`）：

```
core: []                              ai: [core]
plugins: [core]                       qqbot: [core, plugins]
web: [core, plugins]                  tui: []
tui-app: [tui, core, plugins]
cli: [plugins, ai, core, qqbot, web]
```

脚本用正则扫各包 `src/` 的 **import 语句**（不是 `package.json`）。`core` 零上游；**surface 层（web / tui-app / qqbot / repl / exec）地位相同**，都用 core/plugins 公共 API。**`web` 永不 import `cli`。** `tui` 的白名单是**空的且是有意的**——它能依赖的包为零，因此零依赖底座这个性质由门禁保证，而不是靠约定；反过来说任何包都可以依赖它而不产生环。

> **`cli` 的白名单刻意不含 `tui` / `tui-app`**：终端界面是一个**配置驱动的动态 surface 插件**（`~/.nova/config.json` 的 `surfaces` 行点名模块），cli 源码里**不出现任何对它的引用**——正则扫全文件文本（含注释与字符串），cli 既不 import 它也不在字面量里点它的名。这是 dsh 的模型：host 源码永不点名 `@deepseek-harness-tui/dsh-tui`，它在 `cordis.yml` 的 `plugins` 行里被动态解析。**「`cli` 不能静态依赖 surface 包」是一条被门禁机检的红线**——加一个 surface 是改配置，不是改 cli 源码。**根 `package.json` 的 devDependency `@nova-agent/tui-app` 不是死代码**：它是让 `nova --tui` 运行期 `import('@nova-agent/tui-app/surface')` 能从 `node_modules` 解析到 workspace Junction 的**唯一**途径（cli 的依赖里没有它）。它刻意放根、不进 cli 依赖，正是这条红线的镜像——镜像是「运行期可解析」，镜像的反面是「源码不点名」。**门禁不扫根 `package.json`**（`dep-direction.mjs` 只扫 `packages/*/src` 的 import），所以这条只靠文档点名，别把它当可删的残留。

**包输出形态**：每个包 `exports` 只有 `"."`（`dist/index.*`），tsdown 单入口 `src/index.ts`。两个例外：① `plugins` 另有两个 **spawn-only worker 入口**（`ptc/worker.ts`、`builtin/search-worker.ts`）——固定输出文件名是 `new URL('./worker.mjs', import.meta.url)` 的解析前提，但**不是公共 API**；② `cli/src/index.ts` **零 `export`**，`"."` 是一个只执行 `main()` 的 bin 脚本，公共面在 `config.ts` / `surfaces.ts` / `command-runner.ts`。

### 可插拔 Surface：一份契约，两类来源

surface 是「同一内核事件流的人类端消费者」。**契约只有一份**——`core/src/surface.ts` 的 `AgentSurface { name; interactive?; answersQuestions?; claim(request); onWorkspaceChanged?(dir,skillCount); start(runtime) }`，配套 `AgentSurfaceRequest`（argv + 交互性 + host-owned flags）、`AgentSurfaceRuntime`（装配好的 kernel + host 借出的命令端口 + 表现值）、`AgentSurfaceKernel`（**结构性**——真实 `Kernel` 满足它，所以 surface 包只对 core 类型）、`AgentSurfaceCommands` / `AgentSurfaceUi`（host 借出 / surface 自有）。**纯类型，零实现**——core 不认识任何具体 surface。

surface 有**两类来源**，地位相同：

- **内置 surface**（`cli/src/surfaces.ts`）：`SUBCOMMAND_SURFACES`（`qqbot` / `exec`）+ `DEFAULT_SURFACES`（`web` / `repl`）。它们是 cli 自带的，因为它们的认领判据是 argv 形状本身（子命令、`--web`、`--repl`、非 TTY 回落）。
- **动态 surface 插件**（`~/.nova/config.json` 的 `surfaces` 行）：每行一个模块 spec（包名或 `./rel.mjs`），由 `plugins/src/surface-registry.ts` 的 `loadSurfacePlugins` 动态 `import()`——模块以 `default`（或 `surface` 具名）导出一个 `AgentSurface`，校验 `{ name, claim, start }` 三件齐备，缺一即**启动失败**（与 `plugins.extra` 同一条纪律：静默忽略一个扩展比坏掉的启动更糟）。**`tui-app/src/surface.ts` 就是这样一个插件**（`export default tuiSurface`）——cli 源码**不点名它**，只在配置 `surfaces` 行写 `@nova-agent/tui-app/surface` 时才被加载。

  解析是**先序遍历**：`SUBCOMMAND_SURFACES` → 动态 `surfaces`（注册顺序）→ `DEFAULT_SURFACES`，**第一个 `claim(request)` 为真的胜出**。所以动态 surface 是**加层**而非改道：子命令仍最高，`--repl` 仍强过任何「请给我全屏」的 opt-in，浏览器默认仍在最后兜底。

  ```
  1. qqbot — positional[0] === 'qqbot'      2. exec — positional[0] === 'exec'
  [动态 surfaces：tui = flags.tui && !flags.repl && interactive  ← 仅当配置声明]
  3. web — !repl && (web || interactive)     4. repl — repl || !interactive
  ```

  `interactive = stdout.isTTY && stdin.isTTY`。**claim 必须覆盖交互与非交互两种 stdio**：`nova --web` 一走管道也必须被 web 认领（真机 smoke 就是这么跑的），否则会被 REPL 抢走。此判据由 `cli/test/surfaces.test.ts` 的认领表直测钉住（含注入一个 fake tui surface 作 `extras`，钉死动态层的优先级与回落）。

  **`--tui` 是显式 opt-in，且带 TTY 前置条件**：`tuiSurface.claim` 读 `flags.tui && !flags.repl && interactive`，所以管道下自动让位给 `repl`——**绝不朝管道画帧**；与 `--repl` 同时给出时 `repl` 胜出（`--repl` 是「强制回落」，比「请给我全屏」更强）。两个方向都有直测钉住（`tui-app/test/surface.test.ts` 直测插件自己的 claim；`cli/test/surfaces.test.ts` 直测它在认领表里的位置）：去掉 `!repl` 或去掉 `interactive` 都会让测试变红。**`--tui` 未在 `surfaces` 配置时**，main() 给一条引导错误（点名「tui-app 包的 ./surface 子路径」），而非静默回落到 web——一个显式 opt-in 不该静默选错端。

  **argv 解析与「谁来服务它」分成两个文件**：`cli/src/cli-args.ts` 拥有 `ParsedArgs` + `parseArgs`（`--tui` 是其中一个 flag），`cli/src/surfaces.ts` 拥有认领表 + 启动。两者问的是不同问题（「这行命令是什么意思」与「谁来执行它」），此前挤在一个文件里，拆开后 `surfaces.ts` 的上限从 258 降到 205——**上限下调就是这次拆分的证据**。

  > **`surfaces` 是 `plugins.extra` 的 surface 版**：同一套动态加载原语（`resolveModuleSpec`）、同一套「校验失败即启动失败」的纪律。区别只在 `extra` 加载的是内核插件（core `Plugin`：`{ name, inject?, Config?, apply(ctx) }`），`surfaces` 加载的是 surface 插件（`{ name, claim, start }`）——两者都不许在 host 源码里点名。

### 内核装配有三个调用点，不是「唯一装配点」

- **调用点 ①** `cli/src/kernel-boot.ts` 的 `bootKernel()`：exec / repl / qqbot 经它装配（provider 由 owning surface 注入）。
- **调用点 ②** `web/src/controller.ts` 的 `WebController.create()`：**web 自己装配**，不经 `bootKernel`。`cli/web-mode.ts` 只借 `createProvider` / `toKernelConfig` 交给 `launchWeb`，内核在 `packages/web` 内建起来。这是**结构性分歧而非疏漏**：web 需要 `modelCatalog` 与 provider 的模型标签/窗口，而 `BootOptions` 装不下。因此「`nova` 默认形态走 `bootKernel`」是错的——**默认形态恰恰是唯一绕过它的那个**。
- **调用点 ③** `cli/src/surface-host.ts` 的 `buildSurfaceRuntime()`：**任何动态加载的 surface（含 tui）经它装配**。`tui-mode.ts` 已删——TUI 不再有自己的装配壳，它是一个 surface 插件，`runSurface()` 调 `surface.start(runtime)`，`buildSurfaceRuntime()` 装内核。形状与 ② 同因——`TuiApp` 要 `kernel.skills` / `kernel.rootDir()` / `codeMode()` 以及 `workspace.onChange` 的活回调，而 `bootKernel` 返回的 `Kernel` 给不了「装配期间的 holder 绑定」（`onSubagentProgress` 要引用尚未存在的 `kernel`，靠一个 `holder` 对象延迟解析）。

  **`userQuestions` 的单一来源**：推导规则只有一个——core 的 `deriveUserQuestions(caps)` 返回 `answersQuestions ?? interactive ?? false`，fail-closed。两个读它的地方共用这一个函数：`runtime-env.ts` 的服务端 provider（ask tool 每次调用时对 `registry.current()` 求值）与 `surface-host.ts` 的 `buildSurfaceRuntime`（对刚加载的 surface 求值）——它们**不可能再写出两条不一致的规则**，规则变更先变函数、测试先红。该 flag 默认 **false 且是 fail-closed**（无人值守的 exec / qqbot 若拿到 answerer，run 会停在提问里直到被 abort，而没有任何卡片能释放它）。有人的 surface 必须显式打开，否则 `ask_user_question` 直接回一句 `no user-questions answerer accepted the request` 给模型：工具在、UI 在、提问永远不会发生。`tuiSurface` 声明 `answersQuestions: true`，所以 TUI 路径现在与 `repl` / `web` 同源——这正是它当年恢复时漏的那一行，如今由 surface 自己声明、host 读取。

  > 调用点 ① ② 没有 registry 时回落到 `opts.userQuestions`（repl / web 显式 `true`，exec / qqbot 默认 `false`）。**只要装配传了 `surfaces`（`registry.current()` 有值），服务端 provider 就从当前 surface 推导**，host 的显式值不再生效——所以动态 surface 的答案永远来自 surface 自己的声明，不来自装配点。直测在 `core/test/user-question.test.ts`（`deriveUserQuestions`）与 `surface.test.ts`（`answersQuestions` 被断言）。

## 5. 核心设计

### 一切皆插件（Cordis 式容器）

工具、斜杠命令、生命周期钩子、能力服务全部经插件容器注册，并且可以**按键替换**——内核里没有任何能力是硬连线的。

- **容器**（`core/plugin/`）：`Context`（服务读写 + effect 撤销 + 事件派发）／`Fiber`（状态机 `pending→loading→active→failed→disposed`）／`ServiceStore`（`key<T>()` 寻址，provider 换代驱动依赖方重载）／`EventRegistry`（五种派发：`emit`、`waterfall`、`parallel`、`serial`、`bail`）。
- **waterfall**：监听器返回非 `undefined` 即胜出；调 `next(...)` 委派并可改写参数；不委派也不返回 = 弃权。
- **serial / bail**：第一个决定性裁决即胜出——审批门是 `priority: 1000` 的监听器，所以权限总是先被裁定。
- **effect 撤销**：一切注册走 `ctx.effect()`，返回的 disposer 在插件卸载时**逆序**执行——**正确拆除是构造出来的，不是记得做的**。
- **一份插件协议**：`core/plugin/types.ts` 的 `Plugin`（`{ name?, inject?, Config?, apply(ctx) }` + 函数 / 类两种形式）是**唯一**的公共插件 API——内置、surface 自带、`plugins.extra` 第三方走同一条。`apply(ctx)` 里经 `plugins/toolbox.ts` 的 `registerTool(ctx, def, permission)` / `registerCommand(ctx, def)` 注册工具与命令，每个注册都变成容器 effect，于是正确拆除是构造出来的（插件卸载时 disposer 逆序执行）。**没有兼容门面、没有第二种插件形态**——历史上 `{ name, activate(ctx) }` 门面已随 `PluginContext` 一并删除。
- **roster 组装**在 `plugins/runtime-roster.ts`：内置 + surface 自带 + `extra` − `disable`，随后追加 `kernelCommandsPlugin` 与（非空时）`skillsPlugin`。`host.reset()` **复用同一个 registry**——重 roster 时工具服务不消失又回来，审批门看不到服务闪断。

**能力服务缝**（`core/plugin/capabilities.ts` 是**唯一定义处**）：10 个服务键 `llm` / `tools` / `commands` / `approval` / `sessions` / `compaction` / `jobs` / `spill` / `skills` / `surfaces`，4 个事件键 `beforeLlmCall`(`llm/before`)、`beforeToolCall`(`tool/before`)、`afterToolResult`(`tool/after`)、`pluginLoaded`(`plugin/loaded`)。

> **10 个服务键里 10 个有提供者。** `surfaces` 当初是无提供者的「刻意死缝」——注册表搬到了 plugins（`surface-registry.ts`），契约也被消费（`tui-app/src/surface.ts` 实现了 `AgentSurface`），但它**不进容器**：注册表必须在内核装配之前就存在（先决定哪个 surface 服务这次 argv，才装内核），而容器是内核装配的产物。这条「先得有、再装配」的时序约束依然成立——**注册表对象先于容器**——但现在装配方把已加载的 surfaces 连同注册表一起交给 `createAgentKernel({ surfaces })`，容器经 `runtime-env.ts` 的 `surfaceRegistryProvider` 把**同一个**注册表实例 provide 成 `surfaces` 服务，于是 surface 变成一条普通插件行（出现在 `/plugins`、落 tier 表、可开关）。所以它**有提供者**了，只是提供的是「容器外的同一实例」，不是新建的。`pluginLoaded` 仍是无提供者（声明齐全、全仓无 `ctx.on`/`ctx.emit`）。**新增能力键的前提是已经有人消费它。**

### 内核协议（`AgentSession` + `KernelEvent`）

`KernelEvent` = `AgentEvent` 的 11 个（`turn_start` / `text_delta` / `reasoning_delta` / `message` / `tool_call_start` / `tool_call_result` / `usage` / `turn_aborted` / `llm_retry` / `empty_completion` / `done`）+ **内核新增 18 个**：`user_message`、`phase`、`approval_request`、`approval_resolved`、`question_request`、`question_resolved`、`tool_progress`、`subagent_update`、`job_update`、`queue_update`、`todo`、`goal`、`model`、`command`、`compaction`、`run_failed`、`run_stats`、`notice`。

辅助联合（`protocol-vocabulary.ts`）：`TurnPhase = idle|thinking|writing|tool|waiting_approval|waiting_question|compacting|retrying`；`NoticeCode = compacted|compact_fused|compact_alias_broken|compact_failed|surface_lagged|listener_failed`。

**一个 surface 只需 `switch (event.type)` 就能驱动整个产品**——凡不在协议里的都不可观测，这既让 surface 可替换，也让它们能针对同一个 reducer 直测。

- **`AgentSession`**（`core/kernel/session.ts`）是 surface 拿到的**唯一句柄**：`events`；`session` / `messages` / `status` / `running` / `currentPhase` / `lastUsage` / `lastPromptTokens` / `queued` / `approvalMode`；方法 `usageSnapshot()` / `setApprovalMode()` / `setApprovalPolicy()` / `pendingApprovals()` / `pendingQuestions()` / `subscribe()` / `notice()` / `announceCommand()` / `announceModel()` / `observeSubagent()` / `observeJob()` / `jobSnapshots()` / `stopJob()` / `prompt()` / `abort()` / `resolveApproval()` / `resolveQuestion()` / `cancelQuestion()` / `compact()` / `dispose()`。surface 不自己跑生成器、不自己落盘——「model-visible means logged」由内核 `consume()` 保证。
- **`Kernel`**（`plugins/runtime-types.ts`）：`agent` / `hooks` / `host` / `llm` / `models?` / `commands` / `runCommand()` / `permission` / `jobs` / `skills` / `systemPrompt` / `rootDir()` / `sessionEnv()` / `buildFragment()` / `codeMode()` / `roster()` / `newAgentSession()` / `activateSession()` / `setWorkspace()` / `setCodeMode()` / `dispose()`。实现是 `runtime-facade.ts` 的活读门面（`models` 在没有 `modelCatalog` 时**整个键不出现**，而非空 object）。
- **`EventPump`**（`kernel/pump.ts`）：`MAX_LAG = 2000`；落后消费者的窗口被清空并替换为一条 `surface_lagged` 通知；**抛错的监听器被隔离**（`listener_failed`）而不是把进程带走。
- **量测**：`RunMeter` / `RunStats`（`kernel/metrics.ts`）——`startedAt` / `durationMs` / `firstTokenMs?` / `llmMs` / `toolMs` / `requests` / `toolCalls` / `retries` / `promptTokens` / `completionTokens` / `cachedTokens`。

> **`AgentSession` 没有 `setModel`。** 切换是 `ChatProvider.setModel()`（原地改写同一客户端实例）→ `runtime-models.ts` 随后调 **`AgentSession.announceModel()`** 发 `model` 事件。

### 命令目录

斜杠命令也是插件缝：`core` 声明 `CommandRegistry`（`ctx.registerCommand`，与第三方插件同一条公共 API），**`plugins/kernel-commands.ts` 是其唯一生产者**。`commandRunner` 同时给出**活目录**（`catalog()` 每次读容器）与**唯一 runner**（`Kernel.runCommand(name, args)`）。

分工线画在**能力**上，不在名字上：需要界面才能完成的事（换主题、退出进程、打开模型选择器）**不进这个目录**，归那个界面。反之任何插件注册的命令——第一方或第三方——都自动出现在每个界面菜单里并由同一条 runner 执行，**没有第二份目录**。

runner 契约是「调用方永远拿到一条可渲染的结果」：开一条 `command` 行、收集命令自己 `log` 的行、以 `done` 行收尾（命令抛错**把原因写进同一行**，不中止会话）；未知名字同样留一行。前端「一份草稿意味着什么」是 `ui/src/composer/command-menu.ts` 的一组纯函数：注册表认得 `/name` 就发命令帧，认不得就**原样发提示词**。

REPL 保留自己的 `COMMAND_SPECS`（`/theme` / `/clear` / `/exit` 只有终端能做）；但两边 `/compact` 的**语义是同一个**。

### 呈现意图词汇表（core 拥有形状，surface 拥有观感）

`core/presentation.ts`：`ToolCallKind`（`read|edit|write|search|execute|job|plan|other`）+ `card` 判别的 `ToolCallView` / `ToolResultView`。**core 只拥有调用的形状与语义**（无文案、无颜色、无列宽），**文案 / 颜色 / 列宽 / 降级档位一律归各 surface**。

工具经 `ToolDefinition.presentCall?(args)` / `presentResult?(args, content)` 声明自己是什么，界面 `switch (view.card)` 消费，**不按工具名特判**。两者都是纯函数，且 `presentCall` **不得读盘**（它在授权前被调用，审批弹窗要能为尚不存在的文件画出 diff），故签名里没有 `ctx`。未声明的工具（含第三方、`jobs`、`run_code`）自动落 `generic` 卡——**永远不会不可渲染，只是不够具体**。

**视图解析归宿主，不归界面**：`callViewOf(tools, call)` / `resultViewOf(tools, call, content)` 从**活工具表**取声明，控制器在出站前把 `view` / `resultView` 附在帧上，`ready` 回放时对每个历史工具块做同一件事。于是浏览器侧零按名特判、零失败启发式。

### Web surface

`nova` 的默认形态 = 一个 Node 进程托管前端 + 一条 WebSocket 事件流，**没有第二套状态**：内核事件进，帧出。

- **持久日志是真相，`ready` 覆盖转录**。浏览器不累积「自己以为的历史」；挂上 socket 就收到 `ready` 基线（`rootDir` / `sessionFile` / 模型 / 审批档 / 模式 / `commands` / `history` / `historyTotal` / `runTotals` / 挂起审批 / 用量基线 / 窗口分母），**重连即重建**。回放块由服务端 `transcript.ts` 从 `deriveMessages()` 投影（跳过上下文片段、工具调用与结果按 id 配对）。
- **两个窗口，同一切点**：转录基线与轨迹（`session-pages.ts` 的两条 `LogWindow`）在同一时刻切。`ready` 带 `HISTORY_TAIL = 40` 与 `traceTotal`；`load_earlier` / `load_trace` 按 `{ have }` 向前翻页。`baseline.ts` 的**冻结快照**是游标所依（实时事件只追加在客户端活区，绝不进这个数组）；轨迹 `have: 0` 是重读，非零按已切窗口计数；「已全部持有」回空批而非报错。
- **线上硬上限**：客户端帧 ≤ 512 KiB，`have` ∈ `0..1e6`，WS 单条 ≤ 1 MiB（超限以 1009 关闭）；畸形帧拒绝并给出原因，不静默截断。
- **会话列表不参与「重建」**：`ready` 重置一切会话态，**唯独不清空侧栏列表**——切会话会广播 `ready`，而重列不是让面板眨眼的理由。契约：`ready` 只把 `sessionsStale` 置真，客户端在「陈旧且无请求在飞」时单飞补问，答到之前旧行继续渲染。服务侧对应地让重问便宜：`core/session-listing.ts` 并行 `stat` + 按 `mtime:size` 记忆化 `peekSession`（**键不能只有 mtime**：NTFS 时间戳约 15ms 一格，「换工作区后立刻重列」时前后 mtime 可能相同，旧 head 会被永久命中；size 每次追加都变）。
- **空白会话只是「待用」的那一个**：会话**在第一条提示词之前就已存在**（`Session.create` + 工作区标记 + 上下文片段），所以「开始了没有」是**内容问题**——判据是 core 的 `isBlankSession`（用户角色消息是否**全部**是 runner 播种的片段，与头部扫描共用 `isContextFragment` 同一份规则）。两条后果：①**已在空白会话上再点「新会话」不新建日志**（否则每按一次多一个空壳），只回一份新基线；②列表里**只有当前打开的那个空白会话成行**。头部扫描（`session-peek.ts` 的 `blank`）是同一判据的有界读法：缓冲区**读满即判非空**（截断的头部里「没看到提示词」不等于「没有提示词」，**失败要偏向显示**）。服务端为此多读 `BLANK_SCAN_SLACK` 个头部再裁页。
- **工作区归属：头扫描与完整投影必须给出同一个答案**。两者曾规则不同：前者取**第一个**标记并在首条提示词处 `break`，后者取**最新**一个——于是中途换过工作区的会话被列在它**已经离开**的目录下。如今两边都取**最新**标记，头扫描也**不在提示词处停止**（**标记追加在提示词之后是常态**）。
- **`ready` 基线要带齐「首绘就正确」所需的活读数**：`commands` 与 **`roster`** 都在 attach 时从活注册表读。这是同一条纪律的两次教训——设置导航由**活 roster** 派生（关掉的插件页必须从导航消失），而 `roster` 帧只由插件管理页请求，于是**重启后直接打开设置**会画出已被关闭插件的页；`ready` 带上 roster 后首绘即正确。凡「导航 / 菜单 / 分组的形状由某个列表决定」而该列表另有专用帧时，基线必须自带一份，否则冷启动与热路径给出两个答案。
- **`launchWeb` 整份透传 controller 选项，不逐字段手抄**：只解构出四个托管项，其余交给 controller——逐字段重建时**新加的可选字段会被静默丢掉**（可选属性不在类型里，编译不报错），而 controller 单测不经过这道缝。
- **模型记忆落在配置文件，不落在浏览器**：一次模型切换**跨进程**记住，写回 `~/.nova/config.json` 的 `provider.model`。**必须改写原始文本**（`cli/config-write.ts`）：`loadConfig` 会跑 `expandDeep` 把 `{env:MY_KEY}` 展开成密钥，**把解析后的对象写回去就等于用明文替换引用**。落盘用同目录 tmp + rename。**浏览器存不了这件事**：`NOVA_WEB_PORT` 未设时端口临时分配，而端口是 origin 的一部分——每次启动都是新 origin。写失败**不回滚已发生的切换**，按错误帧报给读者。
- **surface 触摸文件系统的四件事**：换工作区、删会话、查文件、浏览目录。四个帧都遵守同一条纪律——**校验先于变更，答复即状态**：
  - `set_workspace {dir}`：先经 **`resolveWorkspaceDir()`** 校验（不存在 / 不是目录 / 落在 `~/.nova` 内一律拒绝），**再**调内核。顺序不可颠倒：`setWorkspace` 会把 bash / search / fs 的根一次性改指。通过后广播新的 `ready`——`rootDir` 是客户端获知工作区的**唯一**来源。
  - `delete_session {file}`：`deleteSessionLog()` 复用 `sessionLogPath()` 的同一道边界（删除与 resume 的合法范围**逐字相同**），**真删**（日志即会话，文件还在就仍会被列出）。文件已不在时回一条 error 帧——这是正常竞态而非故障。前端删除按钮在会话行的悬停位（dsh `Rows.tsx` 规则：动作占用时间戳单元格），确认框的**取消键带 `data-modal-autofocus`**（误按 Enter 必须落在安全侧）。
  - `list_files {query}` → `files {query, items, truncated}`：`core/file-listing.ts` 广度优先遍历，跳过 `.git` / `node_modules` / `dist` 与点目录、**绝不跟随符号链接**、条目（200）与墙钟（1s）双上限；被截断时**明说**（"没有更多" 与 "没查完" 是两件事）。前端菜单在**词首**的 `@` 处开启（邮箱地址不弹列表），空格结束未加引号的引用，`"…"` 让带空格的路径保持为一个 token。
  - `list_directory {dir?, files?}` → `directory {path, home, parent?, crumbs, roots, entries, truncated}` 与 `create_directory {dir, name}`：**工作区选择器与文件引用共用的目录浏览**。浏览器标签页没有能用的文件夹对话框——`showDirectoryPicker()` 在 `http://127.0.0.1` 上确实存在（回环算安全上下文），但它 resolve 出的 handle **不带路径**（`path` 是 Electron 扩展），而工作区按**绝对路径**采纳，所以**挑路径 = 问宿主枚举一层并画出来**（`core/directory-listing.ts`）。三条纪律：**默认只列目录**（`files: true` 才给文件，`kind: 'dir' | 'file'`）、**绝不跟随符号链接**、**拒绝与空列表是两种答复**（`directory_error` 帧 vs 空 `entries`：不可读的挂载不能看起来像空文件夹）。每条目带宿主拼好的绝对路径（浏览器永不自己 join）、home 面包屑裁剪到主目录、新文件夹名经 `isSafeDirectoryName` 校验（`.`, `..`, 分隔符, 控制字符, Windows 保留字符一律拒）。**`roots`（`directory-roots.ts`）是「只能选 C 盘」的正解**：Windows 上盘符是 `dirname` 的**死端**（`dirname('C:\') === 'C:\'`）而主目录只在一个盘上，所以光靠往上走永远到不了 `D:`——卷列表只有宿主知道，随每一层下发（Windows 逐个 `stat` 探活）；另配 dsh 的 `.crumbEditZone` 路径编辑框。前端 `DirectoryBrowser.tsx` 是进程内弹窗（portal + modal layer，另有 `DirectoryBrowserDialog` 无 portal 纯 markup 供无 DOM 的静态测试车道直接走）。**关闭即丢弃已取列表**（下次打开重问——宿主可能已经变了）。
  - **引用是文本，不是协议对象**：一次挑选写进草稿的是 `@path` / `@"path with spaces"`——用户本可以手打的那种文本。因此「model-visible ⟺ logged」不需要任何日志改动就仍然成立；模型用已有的 `read_file` 读取它。这也是 `files` 帧回传 `query` 的原因：落在旧文本上的迟到答案据此丢弃，而不是替换成没人正在问的候选。
- **引用本地文件（`@path`），不复制；粘贴图片例外，它必须上传**。两条规则是同一件事的两面，差别在于**字节到底住在哪里**：
  - **文件有路径**，模型用已有工具去读，所以附件是**指针**：一行卡片记住宿主报出的绝对路径，发送时把 `@path` 追加进草稿。**没有文件上传路由，没有上传目录。** 曾经的 `POST /api/upload` 把任意文件的字节流进 `~/.nova/cache/uploads/` 好让 `read_file` 够得着——而 `@path` 本来就是文件进提示词的通道，所以那份副本喂给模型的东西**从原路径一样读得到**，代价却是把用户的字节复制一份、且只增不减（实测 24MB 视频被白白复制）。
  - **粘贴的图片没有路径**：剪贴板只给字节（`File.path` 是 Electron 私有扩展），不落盘就**再也找不回来**。因此图片是**唯一**走字节的附件（`POST /api/image`）。`image/svg+xml` 刻意排除——文件类型表把它算作图片，但它不在请求路径接受的四种格式内。
  - **四条纪律**：①普通浏览器不给拖入/粘贴文件的真实路径，所以拿到真实路径的唯一途径是**宿主自己枚举**（`+` 菜单的「引用本地文件」）；②拖入/粘贴**仍然 `preventDefault`**（否则浏览器会导航到该文件、直接丢掉会话），非图片文件只回一句解释、**不静默复制**——静默正是当初被反对的行为；③目录行是「选择」不是「导航」（文件行点一下即采用，不进目录）；④路径是绝对路径，落在工作区外时走**正常审批门**，不再有 `trustedReadRoots` 豁免。
- **审批走事件，不走隐式等待**：`approval_request` 帧带完整请求，前端以 `resolve_approval` 回答（answer 就是内核的 `AskResult`，线上解析走 core 的 `parseAskResult` 单一解析器）；断连时挂起审批随内核 abort 收敛为 deny（fail-closed）。
- **认证只有一道**：启动打印一次性 `?t=<token>` 的 localhost URL，校验后落 **HMAC-SHA256 签名、host-only、HttpOnly、`SameSite=Strict`** cookie 并 302 到干净地址；HTTP 与 `/ws` 共用它（`timingSafeEqual` 比对），静态托管拒绝穿越。`web/src/index.ts` 强制回环绑定。**不引入任何第三方依赖**——RFC6455 服务端自写。**缓存策略按路径分**：`/assets/*` 是 Vite 内容哈希产物 → `max-age=31536000, immutable`；**其余（含 `index.html`）一律 `no-cache`**——缓存的文档指向上一次构建的资产 URL，重建后那个文件已不存在。
- **前端分层与内核同构**：`state.ts` 是唯一 reducer（帧入、UI 块出，纯函数直测）；`state-events.ts` 归约事件；`card-view.ts` 是工具卡的**纯渲染模型**（六卡 × running/stale/ok/fail 四态，DOM-free 直测）；`chrome-view.ts` 是外壳视图模型；`flow.tsx` 是块 → 行的唯一映射；`format.ts` 是**主要格式化处**；`trace-view.ts` / `diff-lines.ts` / `session-groups.ts` 同为纯函数。React 组件只做投影。markdown 走**元素树渲染**，全程无 `innerHTML` / `dangerouslySetInnerHTML`——XSS 靠构造不可能，而非转义正确。
- **视觉系统 = deepseek-harness 移植（MIT，样式文件逐份署名）**：三层 token（`--dsw-static-*` → `--dsw-alias-*` → 组件局部 `--dsh-*`），明暗双档同一级联（`body[data-ds-dark-theme]`，`index.html` 内联脚本首帧前解析，暗为默认）；三栏 AppFrame（280px 默认、264–420 可拖、<1024px 收为图标轨道）；转录由 `.root` + `.scroll` + `.column` 三层展开，`.scroll` 撑满剩余高度保证 composer 座**恒贴底**。图标全部手写内联 SVG（设计盒写进元素本身的 `width`/`height` 属性——只有 `viewBox` 的 SVG **没有内在尺寸**，在 flex 行里对父级宽度贡献为零）。护栏 `ui/test/style-guard.test.ts`：**零字面色（含注释）、零 ANSI、每个内联 `<svg>` 都声明设计盒、每个 CSS 类都有消费者**。
  > **CSS 变量的类型要当心**：`--dsw-font-xxs-12` 是 `font` **简写**（`12px/18px …`），写成 `font-size: var(--dsw-font-xxs-12)` 是**无效声明、被静默丢弃**（实测两个子代理摘要类因此一直继承 13px 而非参考的 10px）。用 `font:`，或直接用 `font-size` 的字面值。

### 模型端（三种权威，一条优先级）

- **id 由端点拥有**：`ChatProvider.listModels()` → `GET /models`。**大小写敏感是单个站点的命名怪癖**（`deepseek-v4-flash` → 503 而 `DeepSeek-V4-Flash` → 200），所以请求用的名字必须**按当前端点的名单对账**，绝不靠改配置去凑：`core/model-id.ts` 的 `resolveModelId(configured, available)` 三趟匹配（精确 → 唯一大小写无关 → 唯一标点无关，歧义则保留原样），`sameModelId` 是同一规则的判等。**绝不把某个站点的拼写硬编码进代码或配置。**
- **能力有三级优先级**（`core/model-catalog-rules.ts`）：配置 `models[].<field>` → models.dev → 未知（**未知是合法答案**，占用环不画百分比而不是猜一个窗口）。合并是**逐字段**的（`??` 而非 `||`，所以显式 `false` / `0` 存活），且是**覆盖而非重述**：只写 `id` 的条目照样从 models.dev 拿到窗口与模态。
- **配置 `models[]` 非空即「全量接管」菜单**（`catalogIds`）：站点没公布的 id 也能选，被移除的不会再出现；**在役模型永远在列**（菜单得答得出「我在跟谁说话」）。读**活取**而非捕获数组，否则设置页保存后菜单要到重启才变。设置页编辑能力时同时显示「当前生效」与「自动值（占位）」，两者的差就是操作者在偏离什么。
- `set_model` 走 `ChatProvider.setModel()`，**原地改写同一客户端**（不重建 provider——会话句柄、子代理工具、缓存亲和绑定都还指着这个实例）→ 会话发 `model` 事件 → 控制器把它变成给所有客户端的 `state` 帧：**座位跟着事件走，不跟点击的乐观值走**。失败是**答案**（空列表 + 重试）而不是断线；窗口未知时**清空分母**而不是沿用上一个模型的数字。

### TUI surface

`nova --tui` = 同一内核事件流的终端消费者，**与 web 同构**：事件进，帧出，没有第二套状态。

- **分三层，因为三个问题不同**：`tui`（字符格 + 按键，零依赖、不认识内核）／`tui-app` 的纯函数层（`blocks.ts` 归约、`panels.ts` / `question-card.ts` 渲染、`keys.ts` 键链）／`app.ts` 的驱动层（stdin 原始模式、定时帧、内核订阅）。**整层可在无 TTY 的测试车道直测**（`tui` + `tui-app` 共 17 个测试文件 / 261 个断言，全部不碰真 TTY），驱动层只做「把纯层的输出写进 stdout」——这正是它当初被删的三条理由中第一条的反面（渲染层与产品逻辑纠缠）。
- **TTY 归属只有一个出口**：`stop()` 一次还原原始模式、光标、alternate screen。当初被删的第二条理由是「TTY 接缝反复出洞」——治法是让**所有**终端状态变更都走同一条 `Screen` 生命周期，而不是散在各处的 `process.stdout.write`。
- **两张接管卡，优先级是安全**：批准卡（`KeyboardOwner` = `'approval'`）**先于**提问卡路由——审批是安全门，一个待批准的 `rm` 不该被一次提问挡住键盘。两者可以**同时存在**（模型可以一边等审批一边问问题），所以 transcript 里是两个独立字段（`pending` / `question`）而不是一个联合。
- **重放挂起状态是 `start()` 的责任，不是事件的**：`start()` 与 `setAgent()` 都要回放 `pendingApprovals()` **和** `pendingQuestions()`。只订阅事件会在一个已经停等中的 run 上永远画不出卡片——那个 run 的事件早已发完，而 surface 是后挂上来的。**两个都要**：只补一半照样卡死（恢复 TUI 时 `pendingQuestions()` 正是缺的那半）。
- **提问语义与 web 逐字对齐**（`tui-app/src/question.ts` 是 `web/ui/src/question/decisions.ts` 的一对一移植）：**跳过是一次决定而非缺席**（把提交门设在「已回答」上会让一批全跳过的问题永远提交不出去）；**选项与自由文本互斥**（线上优先取文本，留着陈旧选中项就会出现「显示一个答案、发送另一个」）；**id 由模型给出**，所以用 `Object.hasOwn` 取草稿——`__proto__` / `constructor` / `toString` 这类 id 会让 `drafts[id]` 意外命中原型链成员。三处都有直测，含原型污染用例。

### 观测面自己算不出来就去内核要

轮次 header 与底部统计条全部来自内核的 `run_stats`（`RunMeter` 在 `consume()` 里量），**表面一个数都不测**。**轮 header 就是参考实现的那一行**（dsh `TurnProcessNodeView`：满宽按钮 + `[label][chevron]`）——它**不承载任何读数**（dsh 样式表里根本没有 detail 类）：时钟 / TTFT / TPS / 工具时间住在**统计 pill 的弹窗**与**轨迹表**里，印在 header 下面既重复了 label 自己的「用时」，又把数字塞进参考实现空着的位置（本仓曾如此，已删）。过程组是 dsh `ChatGroupSeat` 的 body：`min(400px, 50vh)` 上限、组内自滚（`overscroll-behavior-y` 阻断链式滚动、`scrollbar-gutter: stable`），并在**还能继续滚的那一端**盖 24px 渐变遮罩——上限不让四十步的回合把答案顶出屏幕，遮罩让「被裁掉」与「到头了」可区分；**运行中的回合不设限**。推理行读 stepProcess 语义词汇（流式「正在分析请求」+ 思考实时尾行，落定「已完成分析」）。答案尾行带**用量 pill 与消息时钟**——同一份 `RunStats` 走两个出口：header 管时长、统计 pill 管 token，**读数不重复出现在第三处**。统计条读数取 dsh `stats.counts` 模板（`N 轮 N 步 · X tok/s`），用量段有计费输入即报「缓存命中 N%」；上下文占用环与统计 pill 同排挂 composer dock 行（hero 阶段无读数不渲染）。**占用环的分母来自内核**：`AgentSession.lastPromptTokens` 在进程内跑过时读内存锚点，否则从日志投影取**最后一条 assistant 消息自己的 `usage.promptTokens`**——这里曾读 `ready` 里的 `run/stats.promptTokens`，而那是**一轮内所有请求的求和**（`RunMeter` 刻意累加），不是「窗口现在多满」：实测一轮两请求报 25,268 而真实最后一次是 12,920（**+96%**）。工具行是按钮，点开右侧详情侧板看完整参数/结果原文/时间；后台 job 是转录里的**一行一处、原地改写**的活动行；状态点（solid 10px `::after` 芯 / ongoing 14px 旋转环）是 dsh `StateDot` 的移植，运行中的环由 `animation.startTime = 0` 相位锁定。

**量测是持久的，不是进程内的**：同一份 `RunStats` 以 **log-only `run/stats` 事件**追加进会话日志（`afterMessageId` 锚定它收尾的那条消息）——否则续接/重载的会话会丢掉每一轮的轮 header 与统计条。回放时 `transcript.ts` 用 `anchoredRunStats` 把锚点还原成 `meta` 块（同一锚点后者胜），折叠值随 `ready.runTotals` 下发（内核、服务端与前端共用 `web/totals.ts`）。**时长只有一个主人**：轮 header 拥有它；尾行的时钟是消息落地的墙钟戳，不是第二轮计时。

> **`run_stats` 的时序契约**：它在 `done`（或 `run_failed`）**之前**发出——终结符是消费者等的最后一帧，统计跟在它后面就一定会被只等终结符的消费者漏掉；**落盘先于广播**，所以「崩在这一帧之后」不会留下一轮没有量测的运行。

> **统计条不因缺 `usage` 而整行消失**（本仓曾如此）：轮/步计数由 `run_stats` 独立供给，量测项各自决定在不在。缺 `usage` 时该缺席的是**缓存命中那一段**，不是整行——让一个可选字段决定必需信息的存亡，等于丢掉本来拿得到的事实。

### 上下文与缓存命中率（核心差异化）

目标：**稳定前缀 = 高缓存命中**。四层机制：

1. **前缀冻结**：系统提示字节稳定；环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改。环境信息切「静态/动态」两节。注入片段带**权威指令帧**（`<user_instructions>` / `<project_docs>` 标注为「操作者写入的活跃指令，按字面执行」），同时**保留数据/指令二分**——从文件读到的文本仍是不信数据，防恶意仓库内嵌指令劫持。**项目文档预算以 token 计，不以字节计**（`projectDocMaxTokens`）：估算器对中日韩字符约 1 token/字、其余约 1 token/4 字，按字节设限会让**同一份中文文档被静默按数倍计价**。截断点由同一估算器二分求得。
2. **追加式日志**：对话严格 append-only；工具结果超 **40KB** 时全文落盘 `~/.nova/cache/tool-outputs/<sessionId>/`，消息体保留头部 **60%** + 尾部 **40%**（尾部常带失败详情，提示行预留 200 字节，head+tail+提示恒守预算）；落盘用 `flag:'wx'`（不覆盖、不跟随植入的符号链接）、**永不落进工作区**。**请求级中间压缩**：`assembleRequest` 在 hook 链之后、ephemeral 尾之前做纯函数修剪（`request-trim.ts`，**先 snip 后 micro**）——snip 按**原子工具组**裁中段（保头 3 组），micro 把「最近 3 工具组之前」的旧结果正文换占位符（调用名/参数/id/配对全保留、可重跑取回）；修剪只产出新数组、**永不原位 splice 活日志**，也不进 `deriveMessages` 投影。
3. **compact**：`/compact` 与自动阈值（`autoCompactTokenLimit`，以最近一次 usage 为锚点在发请求**前**预判）共用同一实现；压缩**原位追加** `compaction/start → summary → end` 三事件，模型可见面由 `deriveMessages()` 重建，**原始历史永不改写**；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）。**压缩保真**：摘要提示词是 codex 式**七节**结构（Task / Progress / Decisions / Current state / Issues / Next steps / References）、**无字数上限**；摘要输入的工具结果按 4000 字符/条截断；保留预算 32000 字符。**全文存档**：压缩前的完整 transcript 落 `pre-compact-*.txt`（trusted read root 内，`read_file` 免审批），摘要尾部附 `<archive>` 指针。**token 预估计入 assistant 的 tool call 参数**（`rawArgs`），`estimateMessageTokens` 带 `WeakMap` 记忆化。headless（exec）的轮内预检逐请求全量估算，并带**熔断**：一次压缩后仍超阈值即停用本任务后续自动压缩并告警一次。
4. **供应商对齐**：请求携带 `prompt_cache_key` 与 `x-session-id` / `x-session-affinity` 亲和头，让网关把同一会话固定路由到同一缓存节点。指标目标：会话第 3 轮起缓存命中率 ≥ 90%。

> **工具数组顺序**：主工具数组发给 provider 前按**工具名字典序稳定排序**（`ai/client.ts`，不改动调用方传入数组）——即使中途禁用 bash 或切换 code mode 导致注册顺序重排，工具槽位顺序也保持稳定。PTC SDK binding 亦按 schema 字典序生成。

### 会话日志 v2（不可变事件流 + 投影）

`SessionEvent` 共 **10 个变体**：`message`、`compaction/start`、`compaction/summary`、`compaction/end`、`todo/write`、**`goal/change`**、`approval`、**`workspace`**、`code-dispatch`、`run/stats`。其中 `todo/write` / `goal/change` / `approval` / `workspace` / `code-dispatch` / `run/stats` 是 **log-only**（永不进模型可见面）；`workspace` 标记供会话切换时恢复工具根与列表分组。

压缩不重开会话；v1 旧会话打开时原子升级（`upgradeToV2`）。`appendEvent` **先写盘后入内存**——写失败时内存与磁盘不再发散。**抗损坏**：进程被杀导致的末尾半行在 `Session.open` 时自动截断修复（不告警），中段真损坏行跳过并告警。`compactionSummaryMessage()` 让压缩的活路径与回放投影构造**逐字节相同**的摘要消息。

会话目录 API 在 `session-index.ts`（目录遍历 / 头扫描 / 列表记忆化 / `workspace` 标记各自成文件），列表按**工作区**分组（`workspace` 标记 / 旧日志回落 `<environment>` 的 `cwd=`）。**surface 传来的字符串 → 会话存储认的路径**归 `session-target.ts`（`sessionLogPath` / `deleteSessionLog` / `resolveWorkspaceDir` / `isInsideNovaHome`）：目录枚举只列不抛，目标校验必须拒绝并说明原因，两者失败模式不同所以按职责分开。**缺失工具结果的补齐只有一份实现**（`session-repair.ts` 的 `missingToolResults`）。

### 审批与权限（轻量版，对标 codex）

三档：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）。execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 默认按**命令程序前缀**记忆（`git status` 放行后续 `git …`，不波及 `rm`），复合命令只整条记忆；该粒度**可交互调节**（选中「总是允许」行按 ←/→ 挪授权词数，引擎按**词前缀匹配**放行，越界/复合自动回落默认粒度）。「拒绝」行打字即补充理由，经 `{answer:'deny', reason}` → hook verdict 一路回流成工具结果 `Permission denied: by user: <理由>`——**拒绝从死路变成一次指令**。

**答案解析只有一个实现**：`core/approval.ts` 的 `parseAskResult(value)` 把**任何不可信来源**的答案（WebUI 帧、插件 asker 返回值、REPL 行）转成内核 `AskResult`——同时接受 tagged 与 bare 两种形状，fail-closed（畸形一律 `undefined`），scope 词数与拒绝理由长度有界，拒绝理由里的控制字符被拒（`core/text.ts` 的 `hasControlChars`，多行字段允许换行）。此前每个 surface 各带一份，三份的「什么算合法」各不相同。

ask 路径的每次决定写入 `approval` 审计事件（log-only，可回放；自动放行不记事件，防只读工具刷屏）。审批弹窗上方实时渲染 `edit_file` 的 diff、`write_file` 的目标+首行预览（工具经可选 `preview(args)` 声明）。

### 工具执行

- **文件工具硬化**：`write_file` / `edit_file` 越界检查跑在 **realpath 规范化路径**上（堵死符号链接跟穿逃逸）；写用同目录 tmp + rename 原子替换；`edit_file` 带按文件版本的陈旧检测；`read_file` / `edit_file` 共用 `READ_MAX_BYTES = 8 MiB` 上限，另有二进制探测。`countLines()` 不把尾换行当一行。
- **并行执行**：工具可声明 `isConcurrencySafe` 纯同步分类器，相邻多个 opt-in 调用整段并行（审批仍逐个串行），结果按原调用顺序写入保持确定性；并行段用 `Promise.allSettled` 收敛避免 unhandledRejection。
- **输出截断防御**：`finish_reason=length` 的截断消息中**所有 tool call 一律不执行**（流式参数可能静半截），整批以错误结果回填让模型重发；未解析成 JSON 的畸形参数**只失败那几条**，其余照跑；两条拒绝路径同样**成对发 `tool_call_start`**（只发结果则现场不显示）。
- **search_files**：`content_regex` 与 `name_glob` **至少一个必填**，两个都给时 `content_regex` 优先；默认跳过 `.git` / `node_modules` / `dist` 与点目录、绝不跟随符号链接、单文件 1 MiB 上限。**回溯隔离**：`content_regex` 先经宿主预检（长度 ≤ 512、量词总数 ≤ 32、嵌套量词组拒绝），再进**全新 worker 线程**执行；墙钟预算默认 30s、中止信号透传 `terminate()`。
- **专用工具优先于 shell**：系统提示与工具 description 双侧写排他句（`Use read_file — not shell commands like cat/head/tail`、`Use search_files — not shell grep/rg/find`）。
- **工作区切换（switch_workspace）**：第一方 `workspace` 插件（opt-in）校验目标目录后经 runner 回调 `env.reroster()` 重建工具宿主——fs/bash/search 根、技能列表、环境片段 cwd 一致重指。

### PTC / Code Mode（对标 Cloudflare/dsh run_code 简化版）

`tools.code.mode` 三态 `native|ptc|both`（`PtcMode` 定义在 core——config/host/纯视图层共用，避免跨层依赖）。开启后模型获得 `run_code {code, description}`：写一段 async TypeScript 程序，`await tools.name(args)` 即子调用，**穿过与原生调用完全相同的管线**（审批门 + 钩子 + 超时/中断）。只有程序 print/return 的策展输出进入上下文，中间结果只落 `code-dispatch` 审计事件。执行基底是**每 run 全新 worker 线程**（信任姿态等同 bash）：剥型、空环境、堆/busy-time/墙钟/输出四类预算。

### Subagent（隔离子代理）

`subagent` 工具（opt-in）：嵌套 `runAgent` 跑**全新消息面**（上下文隔离——子代理看不到父对话，prompt 必须自包含），最终 assistant 报告作为工具结果回流父会话（父日志保持「model-visible means logged」；子代理自身对话是瞬态、不落盘）。嵌套工具集活读取并**过滤 subagent 自身**（结构性禁止递归）；透传父 abort signal 与**同一 hooks 链**。**编排姿态**三层注入（系统提示 + 工具描述 + 嵌套 `SUBAGENT_POSTURE`）：默认 1–2 个只读侦察、brief 不重叠、报告给 `path:line` 证据指针；设计/复杂实现留在主代理。嵌套报告首行约定 `complete/partial/blocked`。

**进度回调在装配点接线，不留给 surface**（与 job 的 `jobs.setListener` 同一条纪律）：嵌套循环的 `start` / `tool_call` / `usage` / `done` 是内核事实，每个 surface 都要，所以 `runtime-builtins.ts` 的 `kernelPlugins()` 自己把它接到当前会话的 `observeSubagent()` 上（surface 给了 `onSubagentProgress` 则优先）——`runtime-roster.ts` 只是它的调用者。此前它被留给调用方，而四个装配点一个都没传，回调链在此断掉——`subagent_update` 在协议里声明着、前端为它写好并测过一整行，**全仓却没有任何地方发布过这个事件**，那一行是死代码。**新增「每个 surface 都想要」的内核事件时先问生产者在哪**：声明与消费者齐全而生产者缺席，测试会照着手写 fixture 一路绿。

### 后台 jobs / todo

`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，`jobs` 工具（list/output/stop）读写增量输出。job 自然结束时**下一次 LLM 请求自动注入一行通知**（`drainFinished()`，以克隆消息数组追加临时 user 消息——**不落日志、不破坏投影不变量**；**送达性至少一次**：请求失败/中断时经 `requeue()` 回队），模型无需空转轮询。

`todo_write` 整表替换、last-write-wins，快照持久化为 log-only 事件，不占模型上下文；**计划面板**（composer dock 上一块默认折叠的卡，无计划不渲染）由内核 `todo` 事件驱动、续接时随 `ready.todos` 恢复；**计划失活提醒**：连续 3 轮无 `todo/write` 快照时，下一次请求经**同一请求级临时通道**注入 `STALE_TODO_NAG`（与 job 通知共用 at-least-once 簿记）。两个尾注都排在 hook 链**之后**——`beforeLLMCall` 的原地压缩假设 `request.messages` 与 `opts.messages` 同引用，提前克隆会吞掉它的 splice。

### 目标模式（goal）

`create_goal` / `update_goal` 工具与 `/goal` 命令。`/goal` 是 dsh 的完整语法：`<目标>` 建立、`edit <目标>` 修改、`pause` / `resume` / `clear` 控制、空参数查看（输出带随状态变化的可用命令表）；语义在 `plugins/goal-command.ts`，命令目录里只留一行注册。输入框在 `/goal ` 参数为空时画 claim 提示（`composer/claim-hint.ts`），并按**是否已有目标**在 `hint.goal` / `hint.goal.active` 之间消歧——dsh 的 `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}` 同一条规则，提示语与命令互为承诺。目标与 `todo_write` **同构**：整份快照、last-write-wins、log-only 的 `goal/change` 事件（`null` 记「已清除」，所以「没有目标」只有一种拼法），续接时随 `ready.goal` 恢复，模型不为它付上下文。

**跨轮续做复用已有的请求级临时尾通道**，core 不为它新增机制：`goalPlugin` 的 `beforeLLMCall` 钩子往正在组装的请求追加一条临时 user 消息（与 job 通知、计划失活提醒同一条通道，不落日志、每请求重算 ⇒ at-least-once）。由**插件侧**产出是刻意的：core 否则要认识 goal 才能硬编码第三个生产者。`rounds` 就在这个钩子里递增（唯一递增点），所以「模型读到第几轮」和「续接时恢复的计数」必然同源。轮次用尽即转 `blocked` 并写明原因——不是无限续做，也不是静默停下。前端 `GoalPanel` 挂在计划面板**之上**（目标是更长久的意图，计划是它当前这一步）。

`AgentSession.announceGoal(goal)` 是**工具之外**的调用者（`/goal` 命令、续做钩子）唯一的门口：它先 `appendEvent` 再 `publish`。工具路径不需要它——`goal/change` 由 `agentOptions` 的 log-watch 拾取（与 `todo/write` 同一条）。

### Skills / 数据落盘

Skills 只把 name+description 注入索引，命中触发词才加载正文——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发（发现根与优先级见 §3）。

```
~/.nova/
├─ config.json              # 唯一配置来源
├─ skills/                  # 用户级技能
├─ sessions/YYYY/MM/DD/     # JSONL 会话（append-only，可回放，按日期归档，全局不分项目）
└─ cache/
   ├─ tool-outputs/<sessionId>/   # 工具输出溢出 + 压缩前全文存档
   ├─ images/<sha256-hex>         # 粘贴图片的字节（内容寻址，见 §5 模型端）
   └─ models-dev.json             # 模型目录缓存
```

路径布局**只有一处**（`core/paths.ts`）。`cache/tool-outputs` 是**目前唯一的 trusted read root**——写进去的是本进程自己，不是从工作区读来的第三方文本。`cache/images/` **不是** read root，也不该被工具打开：它是**请求侧的存储**，按 `ImageAttachmentRef.id` 寻址（`core/image-store.ts` 的 `imagesDir` 是唯一定义处），存的是没有路径的那些字节。**没有 `uploads/`**：有路径的文件一律走 `@path` 引用。

### 粘贴图片的模型端（唯一走字节的输入）

采集与存储（四种格式、`POST /api/image`、字节嗅探、内容寻址、`readBoundedBody` 边读边数、`parsePromptImages` 形状校验 → `admitPromptImages` 核对存储）见上面 Web surface 一条。请求侧三条规则（`core/image-projection.ts`）：

- **能力门在发请求时判，不在采集时判**：用户可能在视觉模型下贴图、随后切到纯文本模型，所以决定必须**跟随当次模型**，且**只在真有图片时才去问**（纯文本会话零成本）。**接受**则内联为 `data:` URI（已对真实网关验证：64×64 纯色 PNG 被正确说成蓝色，回包 usage 里 `image_tokens` 非零），**且无图时仍发纯字符串 `content`**——没有图片的会话与这个特性存在之前**逐字节相同**；**不接受**则换成 `imageOmittedText` 占位符（**静默丢弃最坏**，模型会对着看不见的图硬答）。
- **`undefined` = 接受（fail-open）**：模态表是第三方查询，解析不出普通网关别名是常态，把「查不到」当「这模型瞎」会打瘸本来好好的视觉模型。
- **字节丢了说「丢了」，不说「模型不支持」**：`imageLostText` 与 `imageOmittedText` 是**两个**函数——模型本来能收下这张图，归因给它的能力就是往日志里写一句假话，此后每轮都重复它。

## 6. 代码约定

- **内置能力皆第一方插件**：新工具/命令走 `registerTool(ctx, def, permission)` / `registerCommand(ctx, def)`，钩子走 `ctx.on(...)`，与第三方同 API、同审批门；新的**能力**（服务）走 `ctx.provide(key<T>(), impl)`。别在 core 里开特例。
- **Hook 结果结构化**：`ToolCallVerdict` 是判别联合（`allow` / `deny`+reason / `rewrite`+plain-object args），`validateToolCallVerdict(unknown)` 纯函数在宿主组合器与 `runAgent` 门各验一次（fail-closed）。`beforeLLMCall` 链另带工具集护栏（按名集合比较：可收窄或 clone 保持集合不变，**加宽直接抛错**——工具集是前缀缓存的一部分）。
- **前缀字节稳定**：任何动态内容都注入会话首条 user 片段（append-only），绝不回改系统提示或旧消息。
- **单一实现**：同一件事只允许一个实现——审批答案解析（`parseAskResult`）、文本卫生（`hasControlChars`）、呈现形状（`presentation.ts`）、视图解析（`callViewOf`）、斜杠命令语义（`command-runner.ts`）、前端格式化（`format.ts`）、路径布局（`core/paths.ts`）、缺失工具结果补齐（`session-repair.ts`）、模型 id 对账（`core/model-id.ts`）。**发现第二份就把它并掉。**
- **测试不联网**：①单元层（纯函数，断言确定字符串）；②ai 层注入 `fetch` + SSE fixture；③接缝集成测试（SSE→client→runAgent 全管道、save→open→deriveMessages→新轮的投影一致性）。三条直测车道：**内核层**（`core/test/`）、**surface 层**（`web/test/` 守帧编解码/认证门/静态缓存策略/回放重建/视图 enrich/命令目录与 runner；`web/ui/test/` 以纯 reducer、纯渲染模型、纯格式化、行级 diff、会话分组、`/` 菜单规则钉住流式合并、工具行形变、命令行收敛、审批清场、断线语义、六卡映射、每轮统计累加、分页游标——**没有 DOM、没有浏览器**）、**cli 层**（`cli/test/` 守 surface 认领表、装配、命令语义、配置校验、版本锁步）。**真机验收单独一档**：`pnpm smoke:web`。
- **测试必须隔离 `~/.nova`，且隔离由配置保证而非靠记忆**：`vitest.config.ts` 的 `setupFiles` 指向 `packages/test-setup.ts`，它在任何测试模块加载前把 `USERPROFILE` / `HOME` 指向临时目录。此前隔离靠各测试自己记得调 `withFakeHome`，而**五个套件忘了**（含建真内核跑在临时工作区、会话日志却写进真实 `~/.nova/sessions` 的 `plugins/test/runtime.test.ts`），于是每次 `pnpm test` 都在污染真实主目录，累积了 600+ 个垃圾会话。**会被人忘掉的规则等于没有规则**——凡是「每次都必须做对」的事，一律做成机制。
- **路径/跨平台**：一律 `node:path` + 抽象层；bash 工具 Windows 优先 Git Bash、回落 PowerShell 并强制 UTF-8（`POWERSHELL_UTF8_PREFIX` / `powershellInvocation` / `bashOnPath` / `resolveShellName` 是共享原语）。
- **文档即真相**：机制变了同步改本文件；决策理由写进 commit message 与机制条目。
- **写代码时就要为拆分留位**：新增能力时**先**判断它属于哪个文件、那个文件离上限还有多远，**再**落笔；而不是写完一大坨后等门禁报红再回头拆。判据是**职责**而非行数——一个文件同时回答两个不同问题时（「哪条规则」与「谁来提供」、数据形状与运行时行为、读取与写入），**当场**分成两个文件。返工拆分的时间与 token 成本远高于一开始就分开。
- **门禁与 verify 分层**：快环 `pnpm check`；全环 `pnpm verify`。`pnpm gates` 是两件套**结构护栏**：`dep-direction.mjs` 机检包间 import 方向、`structure-budget.mjs` 管逐文件行数上限（超限即失败；新文件没有上限条目也会失败；陈旧条目亦失败，跑 `pnpm gates:update [子串]` 同步——上调逐条打印 `RAISED`，增长必须显式发生过）。**单文件超长是设计失败**：行数天花板就是「拆它」的指令。治巨型闭包的真正手段是 oxlint 的长函数/复杂度警告（存量警告即重构靶单）。
- **上限带余量，且必须随时可见**：上限 = `当前行数 + max(10, 10%)`，**不是**当前行数。曾经钉成当前行数，于是每个文件一落地就在 100%：门禁只会在收尾时说「你已经超了」，说不出「你快超了」，结果每次都要为十几个文件做**批量返工拆分**——而拆分成本本可以在写的时候就顺手摊掉。配套两条：①每次运行（默认的只读检查）末尾打印剩余不足 10 行的文件，作为**前瞻**信号而非失败，因此它出现在 `pnpm check` 快环里；②纯转出桶（只含 `export * from` / `export { … } from`，无任何声明）不计行数——它的长度是**模块条数**而非设计属性。
- **两道门禁的扫描范围**：`dep-direction.mjs` 与 `structure-budget.mjs` 都扫 `packages/<包>/src` **及其嵌套工作区成员的 `src/`**，所以 `packages/web/ui/src`（全仓最大的一块代码）**已经被覆盖**——它有逐文件行数上限，import 也按**宿主包 `web`** 的白名单（只允许 `@nova-agent/core` / `plugins` / `react`）机检。此前这一层是盲区（只扫单层 `packages/*/src`），文件再长、引了别的包都无人报警；若某包子目录**不是**工作区成员却有自己的 `src/`，它同样会被收进预算——「这是别人的目录」不再是一个可用的豁免理由。
- **断言粒度**：测试断**契约与不变量**（宽度守恒、结构顺序、关键字段存在、降级行为），不断完整文案串——观感微调不该触发红测试。**UI 测试车道无 DOM**，用 `renderToStaticMarkup` 或纯函数；**`readFileSync` 读源码做断言是反模式**。
- **绝不能动真实 `~/.nova/config.json`**，除非用户明确要求；实机检查一律用临时 home（`mkdtemp`）。

## 7. 状态与开放问题

**版本现状**：**0.4.0 已发行**（附注标签 `v0.4.0`；`core` / `ai` / `plugins` / `tui` / `tui-app` / `web` / `cli` **七个锁步包** + 根包；`qqbot` 独立升到 **0.3.0**，记录在其自身 CHANGELOG）。本次发行把插件协议换代（删除 legacy `{ name, activate(ctx) }` 门面）等全部积压变更集收进 `0.4.0` 段；0.y.z 期破坏性变更升次版本（§8），锁步组下次发行基线为 0.4.0。**TUI 已按插件形态恢复**（见 §4 / §5）：`tui` 是零依赖渲染底座、`tui-app` 是与 web 同构的 surface，`nova --tui` 显式 opt-in。它曾被整体删除，原因是①渲染层与产品逻辑纠缠、②TTY 归属接缝反复出洞、③真机验收无法自动化——①由「纯函数层 / 驱动层」分层解决，②由单一 `stop()` 生命周期解决，③仍然是**未解决**的那一条（见下）。**`docs/` 只放对齐清单 `dsh-parity-inventory.md`，其余会漂移的副本不要加。**

1. **OpenAI 兼容接口缓存语义不一致**：DeepSeek 自动前缀缓存、部分网关需显式参数。已落地 usage/命中率统计；按 provider 的能力探测表留待后续。
2. **外部插件加载**：`plugins.extra` 已可加载本地路径/包名模块；尚无 registry 与 git URL 安装。
3. **容器化建议**：v1 不做进程沙箱，重隔离建议容器化运行。
4. **TUI 的真机验收仍然无法自动化**：这是它当初被删的三条理由里**唯一没被解决**的一条。`tui` + `tui-app` 有 17 个测试文件 / 261 个断言、`--tui` 无 TTY 的回落有直测，但「帧真的画对了、键真的被收到了、退出真的还原了终端」在 CI 里**没有任何自动化证据**——它只能在真 TTY 上人工看一次。`pnpm smoke:web` 是浏览器面的真机档，TUI 还没有对应物。
5. **`AgentSurface` 契约已被消费 + `surfaces` 服务键已有提供者（均已解决）**：core 声明的公共 surface 契约现在有消费者——`tui-app/src/surface.ts` 实现了它，`plugins/src/surface-registry.ts` 加载它，`cli/src/surface-host.ts` 把它接到内核装配。「第三方 surface 只依赖 core/plugins 公共 API」是事实，不再是意图。**`surfaces` 服务键也已从死缝变成有提供者**：装配方把已加载的 surfaces 连同注册表交给 `createAgentKernel({ surfaces })`，容器经 `runtime-env.ts` 的 `surfaceRegistryProvider` 把**同一个**注册表实例 provide 成 `surfaces` 服务（见 §5）。`pluginLoaded` 事件键仍同类：只有声明，全仓无 `ctx.on`/`ctx.emit`。
6. **三个装配点的一致性（`userQuestions` / `onSubagentProgress`）已收口**：`userQuestions` 的**推导规则**收成一个 core 纯函数 `deriveUserQuestions(caps)`（`answersQuestions ?? interactive ?? false`），`runtime-env.ts` 的服务端 provider 与 `buildSurfaceRuntime` 共用它，直测在 `core/test/user-question.test.ts` 钉住「有人 surface ⇒ true、无人值守 ⇒ false」——规则变更先改函数、测试先红，两端不可能再写出两条不一致的规则。`onSubagentProgress` 同理已由 `runtime-builtins.ts` 的 `kernelPlugins()` 在装配点接线（§5 Subagent）。**剩余**：① ② 没有 registry 时 `userQuestions` 仍回落到 host 显式值（repl/web `true`、exec/qqbot 默认 `false`），这是「内置 surface 的声明」而不是「装配点的规则」，不是缺陷。
7. **（已解决）** `tui-mode.ts` 已被删除——TUI 不再是 cli 源码里的一个装配壳，它是 `tui-app` 里配置驱动的动态 surface 插件，经 `cli/src/surface-host.ts` 的 `buildSurfaceRuntime` 装配。`tui` + `tui-app` 的 17 个测试文件 / 261 个断言全部不碰真 TTY，`--tui` 无 TTY 的回落由 `cli/test/surfaces.test.ts` 认领表直测。**剩余的 ④（真机验收）仍无法自动化**——见本列表第 4 条。

## 8. 版本与发布（SemVer 2.0.0）

版本号遵循 **Semantic Versioning 2.0.0**。规范第 1 条要求升位必须有公共 API 判据——本节即**本项目的公共 API 定义**。

### 公共 API 面

凡改变以下任一面的可观察行为或签名，即为公共 API 变更；未列入清单的内部实现（模块私有函数、错误文案、事件内部字段等）不构成版本约束。

1. **CLI 用法与参数**：`nova` / `nova exec` / `nova qqbot` 的全部 flags 与形态、`--json` 事件流 schema、进程退出码。
2. **配置 schema**：`~/.nova/config.json` 的字段名、类型与语义（§3 清单，含 `models[]`、`{env:NAME}` 引用形式与 `plugins.disable` / `plugins.extra` 的加载语义）。
3. **JSONL 会话日志 v2 格式与投影语义**：`SessionEvent` 的 10 个事件类型、字段结构、`deriveMessages()` 投影规则、压缩语义。
4. **插件 API**：core `Plugin`（`{ name, inject?, Config?, apply(ctx) }` + 函数 / 类两种形式）、`registerTool(ctx, def, permission)` / `registerCommand(ctx, def)`、`ToolDefinition`（含 `presentCall` / `presentResult` / `preview`）、`ToolExecuteContext`、钩子签名、审批档位与 `permission` 声明；**容器公共面**（`Context` / `ctx.provide` / `key<T>()` / `ctx.on` / `ctx.effect`）与 `plugins.extra` 能加载的插件形态。
5. **内核协议（surface 契约）**：`AgentSession` 句柄的方法集、`KernelEvent` 的变体与字段、`Kernel` 的成员（含 `models?` / `commands` / `runCommand()` / `roster()`）、`createAgentKernel` 的装配签名——凡实现一个 surface（官方或第三方）所依赖的都是公共面。
   > **`surfaces` 服务键保留声明但刻意无容器提供者**（§5 能力服务缝 + §7.5）：注册表在容器之外先于内核装配存在（`plugins/src/surface-registry.ts`），契约被 `tui-app/src/surface.ts` 消费——所以 `AgentSurface` / `AgentSurfaceKernel` **是行为契约**（有人实现、有人加载、有人装配），但 `surfaces` ServiceKey 与 `pluginLoaded` 事件键仍是死缝（无 `ctx.provide` / 无 `ctx.on`）。`surfaces` 的死是**刻意的**：往容器里 provide 一个「内核还没装好时就要用」的东西自相矛盾。`pluginLoaded` 仍未接线。它们仍是 `core` 的导出，签名变更照样要升位。
6. **各 `@nova-agent/*` 包公开导出**：每个包 `exports` 只有 `"."`。`core`（agent 循环 / 消息模型 / 会话 / kernel 句柄与事件协议 / 审批与呈现词汇表 / 插件容器 / 模型 id 对账与目录选择规则 / 文件与目录枚举；**`session-peek.ts` 不在其中**）、`ai`（`client` + `sse`）、`plugins`（容器门面 / 审批 / 内置工具 / 命令目录与 runner / 内核装配；`fs.ts` 与 `bash.ts` 只做**窄化具名再导出**）、`web`（surface 后端与帧协议：`list_models` / `set_model` / `list_model_config` / `save_models` / `command` / `load_earlier` / `load_trace` / `set_workspace` / `delete_session` / `list_files` / `list_directory` / `create_directory` 客户端帧与 `parseClientFrame` 判据、`models` / `model_config` / `state` / `sessions` / `files` / `directory` / `directory_error` / `ready` 的字段、`server.ts` 的静态缓存策略与 `GET`/`POST /api/image` 字节路由）、`qqbot`（渠道插件示范）、`cli`（`config` / `surfaces` / `command-runner`——**`"."` 是 bin 脚本，零 export**）。

### 升位映射

| 变更类别 | 判定 | 升位 |
| --- | --- | --- |
| 不兼容 | 破坏以上任一 API 面的行为或签名（如日志 v2→v3、插件钩子签名变更、删除一个 surface 形态） | 升**次版本**（0.y.z 期）/ 主版本（1.0.0 后），并在 changeset 正文里点名迁移方式（生成的 `CHANGELOG.md` 即发行说明） |
| 向后兼容新增 | 新增 flag / 字段 / 工具 / 导出，既有行为不变 | 升**次版本** |
| 仅修正 | 只修复错误结果，公共 API 面不变 | 升**修订号**（x>0 时） |

### 发布流程（changesets）

- monorepo **fixed 锁步组**：7 个 `@nova-agent/*` 工作区包（`core` / `ai` / `plugins` / `tui` / `tui-app` / `web` / `cli`）恒一致、共享单一版本号（`.changeset/config.json` 的 `fixed` + `privatePackages: { version: true, tag: true }`、`access: "restricted"`）；`qqbot` **刻意留在组外**（第三方插件示范，按自身改动独立升位）。根包 `nova-agent` 是 private 且非 workspace 成员，由 `scripts/sync-root-version.mjs` 在 release 中读 `packages/cli/package.json` 同步。**锁步组与磁盘上的工作区包必须一致**：`cli/test/version.test.ts` 从磁盘发现包并校验——组里写了不存在的包会让 `changeset version` 直接失败。
- 每项面向用户改动提交一份 changeset（`.changeset/*.md`，标注 minor / patch）。**变更集在发行前可合并**：被后续重写取代的条目应并入取代它的那一条，而不是留成悬空记录。
- 发行：`pnpm changeset` → `pnpm changeset version` → 提交 → `changeset tag` → `pnpm release` 一条龙。
- **已发行版本内容不可变**（规范第 3 条）：绝不 amend / 移动既有 tag；一切修改以新版本向前发行。
- tag 形式：附注标签 `vX.Y.Z`——v 前缀是 tag 名，版本号本体为无前缀的 `X.Y.Z`。

### 0.y.z → 1.0.0 门槛

当前处于 **0.y.z 初始开发阶段**：基线 `0.1.0`，每次发行递增次版本号。升至 **1.0.0** 的判据：软件用于正式生产环境、且上述公共 API 六面稳定（变更频率从「随时可能」降至「仅经慎重评估才破坏」）。`0.y.z` 期的每次发行均视为完整发行——遵守不可变 tag 规则、有 changeset 记录、可回溯。
