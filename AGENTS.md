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

**`nova` 的四种形态**（认领规则见 §4）：

- `nova` → **浏览器界面**（`@nova-agent/web`，默认）：单 Node 进程 = HTTP 静态托管 + 单 WebSocket 事件流。启动打印**一次性带 launch token 的 localhost URL**，校验后落 HttpOnly 签名 cookie；绑定地址强制回环。`NOVA_WEB_PORT` 可固定端口（前端开发流：先 `nova --web`，再在 `packages/web/ui` 跑 `pnpm dev`，http/ws 全代理）；未设时**记住上次绑定端口**、下次优先复用（占用即回落临时端口）——origin 因此跨重启稳定，配合持久化配对 cookie，**WebUI 可作为 PWA 安装**（manifest 与图标由 `web/ui/public/` 下发）。`--web` 是这个默认形态的**显式拼法**，不是另一个 surface。
- `nova --repl` → readline 终端形态（非 TTY 自动回落；`--repl` 是「强制回落」而非兼容 no-op）。
- `nova qqbot` → QQ 机器人（**要求配置里有一行 `plugins.entries` 指名 `@nova-agent/qqbot` 并填好它自己 `config` 里的 `appId` / `clientSecret`**；对端独立会话，永不交互审批）。这个包**不在随产品发行的三个扩展包里**——它是第三方编写示范，行不给就没有通道，`nova qqbot` 会点名拒绝而不是挂起（见 §3、§4）。
- `nova plugin add|remove|list` → 第三方插件的安装/卸载/清单（装到 `~/.nova/plugins`，**写回 `plugins.entries` 里的一行**）。**不经配置加载**，所以配置被坏插件搞坏时它仍可用（见 §3）。
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
  "plugins": {                        // 可选：插件树——唯一的插件配置入口（见下）
    "entries": [                      // 一行一个插件；id 是内置插件的名字，或一个模块 spec
      { "id": "todo", "enabled": false },
      { "id": "./my-plugin.mjs" },                          // 加一个插件＝加一行
      { "id": "@nova-agent/plugin-ptc", "config": { "mode": "both" } },
      { "id": "@nova-agent/qqbot",      "config": { "appId": "xxx",
                                        "clientSecret": "{env:QQBOT_SECRET}" } }
    ]
  },
  "skills": { "disable": [] },        // 可选：Skill 中心关掉的技能（按名；项目级/用户级同名一并关）
  "tools": {
    "bash": { "enabled": true, "timeoutMs": 60000, "shellPath": "C:/Program Files/Git/bin/bash.exe" }
  },
  "surfaces": ["./my-surface.mjs"]    // 可选：动态 surface 插件模块 spec（包名或 ./rel.mjs）；加载失败即启动失败
}
```

**`plugins.entries` 是插件树，也是唯一的插件配置入口**：不改源码即可关掉任一内置插件或加载自写插件。每行 `{ id, enabled?, config? }`——`id` 是一个**内置插件的名字**，或**一个模块 spec**（`plugins/src/plugin-tree.ts` 的 `buildTree` 先放全部进程内内置插件，其余 id 一律按**同一处** spec 规则解析）。`enabled` 是**唯一**的开关：行开着（或按它自己 manifest 的 tier 默认开着）就加载，关着就只留一行给面板。**没有第二张表、没有推导**——曾经 `disable`/`enable`/`extra` 三处表达同一件事，于是两张表能互相矛盾，而配置推导（`tools.code.mode`、`qqbot` 块）又能越过两张表把关掉的插件复活；现在启动路径与设置面板写的是同一个字段（`cli/src/config-write.ts` 的 `setPluginEntry`），所以一次开关不可能与一次重启给出两个答案。

**行里的 `config` 归那个插件自己**：由它的 `Config` schema 校验（core 的 `objectConfig`，一个结构化的 standard-schema，见 `core/src/plugin/schema.ts`），内核不知道 bash 有没有超时，也不该知道。schema 里每个字段都是**可选**的（`{}` 是合法的一行，"缺省"永远是插件自己的默认值而不是校验失败），但**未知键一律点名拒绝**——一个被静默丢掉的键就是「设置看起来存下了、其实什么都没做」。`{env:NAME}` 展开仍然逐行生效（`cli/src/config-expand.ts`），且**只有插件行里的未解析引用降级成诊断**：核心段的引用照旧致命，而某一行的 `{env:QQ_SECRET}` 没设置只让那一行报错，不再把浏览器界面、REPL 与 `exec` 一起拖死。

**`surfaces` 是插件行的 surface 版**（§4）：每行一个模块 spec，由 `plugins/src/surface-registry.ts` 的 `loadSurfacePlugins` 动态 `import()`。模块以 `default`（或 `surface` 具名）导出一个 `AgentSurface`，校验 `{ name, claim, start }` 三件齐备，缺一即**启动失败**——与 `plugins.entries` 里加载不起来的行同一条纪律：静默忽略一个扩展比坏掉的启动更糟。**cli 源码不静态依赖任何 surface 包**：`surfaces` 行点名谁就加载谁，加一个 surface 是改配置，不是改 cli 源码。

**`plugins.entries` 与 `surfaces` 的每一行是一个模块 spec，解析规则只有一处**（`plugins/src/module-spec.ts`）：路径按**工作目录**解析；裸包名先交给 Node（随产品解析）；**只有产品解析不到的名字**才落到**用户插件根** `~/.nova/plugins/node_modules/`。用户根是**回退而非遮蔽**——产品能解析的名字永不被用户根里的旧副本顶掉（否则一次升级会被几个月前装的同名副本来个静默失效）。第三方插件的安装路径是 `nova plugin add <包名>`（`cli/src/plugin-command.ts`）：npm 装进用户插件根 → 用 boot **同款**检查（`loadPluginModule` + 一个用完即弃的宿主，`plugin-probe.ts`）确认这个模块真的能作为一个插件跑起来 → **最后**才写 `plugins.entries` 的那一行，任一步失败都不留配置行；`remove` 顺序相反（先撤行、后卸包，剩下的包是惰性的、剩下的行会让下次启动失败）。该命令**在建内核之前、加载配置之前**执行——它要修的就是「配置坏了导致启动失败」这件事，所以它不能依赖一次成功的启动。**`plugin add` 写的是与设置面板同一个字段**：旧 `plugins.extra` 列表是第二道门，装好的插件可以在那里列着却别处关着，于是 `nova plugin list` 与面板能对「什么在跑」各说各话。

**插件分三层，档位归插件自己的 manifest**（`core/src/plugin/types.ts` 的 `PluginManifest.tier`）：**core** 不可关且不渲染开关（注册表与服务、`fs-read`/`fs-write`/`search`/`ask-user`）；**standard** 默认开、可关（`bash`/`jobs`/`todo`/`goal`/`workspace`）；**advanced** 默认关，写出这一行并 `enabled: true` 才加载（`subagent`/`context`/`ptc`）。默认态只有两个函数（`enabledByDefault(tier)` / `isRequiredTier(tier)`），**没有按名字的中心名单**：插件自己说「我叫什么、我什么档」，宿主从来不认识它。没有 manifest 的插件按 `standard` **fail-open**——把第三方划进 core 会让它**永久不可关**。**「缺席＝关」是唯一读法**：没有任何推导录取口，`plugins.entries` 里没提到的行就按它的 tier 默认，行里 `enabled: false` 就关，两个方向都是**同一个字段**，所以开关不会「自动打开」。

Skills 的发现根按优先级：项目 `.agents/skills/` → 项目 `.nova/skills/`（向后兼容）→ 用户 `~/.agents/skills/` → 用户 `~/.nova/skills/`（向后兼容）；目录包 `<name>/SKILL.md` 与扁平 `<name>.md` 都认。frontmatter 仅 `name` / `description`（**支持 YAML 块标量** `>-` / `|`），同名时**项目级优先**。

## 4. 架构

pnpm monorepo，依赖方向由 `pnpm gates` 机检。工作区 **10 个成员**（`packages/*` 九包 + 嵌套子包 `packages/web/ui`），**9 个包受白名单管辖**（嵌套成员的 `src/` 按宿主包 `web` 的规则一并受检）：

| 包 | 职责 |
| --- | --- |
| `core` | provider 无关的 agent 循环（async generator 事件流）、append-only 消息模型、会话持久化与投影、工具调度、token 预估、请求级修剪、后台 jobs、**插件容器**、**内核句柄与事件协议**、审批与呈现词汇表、向人提问、surface 目标校验、工作区文件与目录枚举、上下文洞察契约 |
| `plugins` | **插件世界与内核装配**：工具宿主（core `{ name, inject, apply }` 协议）、审批引擎、内置工具（含 `ask_user_question`）、skills、**命令目录唯一生产者**、`createAgentKernel`、roster、surface 注册表、AGENTS.md 读链与 `/init` 模板、`context` 折叠器 |
| `ai` | OpenAI 兼容手写客户端：fetch + SSE 流式、工具调用、重试与断流自愈、usage/缓存命中提取 |
| `web` | **浏览器 surface 后端**（产品的富界面）：HTTP 静态托管 + 单 WS 事件流；launch token → HMAC 签名 HttpOnly cookie；自写 RFC6455（**零第三方依赖**） |
| `qqbot` | QQ 机器人接入插件（**第三方插件编写示范**，只依赖 core/plugins 公共 API）：插件体自持通道（凭据、拨号、探针、设置页、`qqbot_send` 工具全在 `src/plugin.ts` 起的 fiber 内），`src/surface/mode.ts` 只是 `nova qqbot` 的认领行 + 常驻；cli 经一处动态装载使用。**不在 `SHIPPED_PACKAGES` 里**——要用它得自己在 `plugins.entries` 写一行 |
| `plugin-subagent` | 扩展出包（advanced 档，只依赖 core）：`subagent` 工具——隔离子代理 |
| `plugin-context` | 扩展出包（advanced 档，只依赖 core）：上下文洞察折叠器（`contextInsights` 服务）与窗口快照（`windowAtSeq` —— Browser/DNA 卡共用） |
| `plugin-ptc` | 扩展出包（advanced 档，只依赖 core）：PTC / code mode（`run_code` + spawn-only worker 入口） |
| `cli` | 产品壳（**surface 装配**）：argv → 装配哪个 surface + 配置发现 + 模型元数据 |

前端子包 `packages/web/ui`（private `nova-web-ui`）是浏览器侧，React 18 + Vite 7 + Tailwind 4。终端只有 readline REPL（cli 自带，非 TTY 回落）——**全屏终端界面（TUI）已整体删除**：渲染层与产品逻辑纠缠、TTY 接缝反复出洞、真机验收无法自动化，而浏览器界面已是富界面；「终端上有第二个全屏界面」如有需要，应作为第三方 surface 插件另立包，不回本仓。

**依赖方向白名单**（`scripts/dep-direction.mjs` 的 `ALLOW`）：

```
core: []                              ai: [core]
plugins: [core, plugin-subagent, plugin-context, plugin-ptc]
qqbot: [core, plugins]                plugin-subagent: [core]
plugin-context: [core]                plugin-ptc: [core]
web: [core, plugins, plugin-context]
cli: [plugins, ai, core, qqbot, web]
```

（`plugins` 对三个扩展包的边是 **spec 表 + 运行时 `import()`**，源码不 import 实现——名字仍须在名单里，机检扫的是包名文本；三个扩展包只依赖 core，所以 `plugins` 声明它们为依赖时不成环。`web` 多一条到 `plugin-context` 的静态边：只读路由 `GET /api/context-window` 复用同一个窗口折叠（`windowAtSeq`），而不是各写一份会漂的元素分类——live 路径仍经容器拿 fold，两条通道互不替代。）

脚本用正则扫各包 `src/` 的**全文件文本**（不是 `package.json`；注释与字符串里的包名同样算违规）。`core` 零上游；**surface 层（web / qqbot / repl / exec）地位相同**，都用 core/plugins 公共 API。**`web` 永不 import `cli`。**

> **`cli` 的白名单 = 内核三件 + 内置 web 后端 + qqbot 的「动态边」**（`plugins` / `ai` / `core` / `web` / `qqbot`）：web 的入口要 `launchWeb`——这是**真实的静态依赖**，不是疏漏；`repl` / `exec` 是自带的纯 argv 形状 surface；**qqbot 已去静态化**——cli 对包的引用只剩 `cli/src/qqbot-surface.ts` 里的一处 `await import('@nova-agent/qqbot')`（名字仍进白名单：机检扫的是包名文本，动态 `import()` 的字符串也算边），该文件只对**结构性镜像**编程，包缺席时 `nova qqbot` 报「扩展不可用」、`nova --web` 降级（见 §7.7）。内置四家的认领判据都是 argv 形状本身（子命令、`--web`、`--repl`、非 TTY 回落），所以**认领行留在 cli**（必须同步可答），产品形态各归其主。其余 surface 一律是**配置驱动的动态插件**（`~/.nova/config.json` 的 `surfaces` 行点名模块），cli 源码不点名；机检红线（`dep-direction.mjs`）只覆盖 `@nova-agent` 命名空间（非本 scope 的包名扫不到）。所以「加一个 surface 是改配置」对**第三方 surface** 成立、对内置默认形态（web）不成立。

**包输出形态**：每个包 `exports` 只有 `"."`（`dist/index.*`），tsdown 单入口 `src/index.ts`。两个例外：① `plugins` 另有两个 **spawn-only worker 入口**（`ptc/worker.ts`、`builtin/search-worker.ts`）——固定输出文件名是 `new URL('./worker.mjs', import.meta.url)` 的解析前提，但**不是公共 API**；② `cli/src/index.ts` **零 `export`**，`"."` 是一个只执行 `main()` 的 bin 脚本，公共面在 `config.ts` / `surfaces.ts` / `command-runner.ts`。

### 可插拔 Surface：一份契约，两类来源

surface 是「同一内核事件流的人类端消费者」。**契约只有一份**——`core/src/surface.ts` 的 `AgentSurface { name; interactive?; answersQuestions?; claim(request); onWorkspaceChanged?(dir,skillCount); start(runtime) }`，配套 `AgentSurfaceRequest`（argv + 交互性 + host-owned flags）、`AgentSurfaceRuntime`（装配好的 kernel + host 借出的命令端口 + 表现值）、`AgentSurfaceKernel`（**结构性**——真实 `Kernel` 满足它，所以 surface 包只对 core 类型）、`AgentSurfaceCommands` / `AgentSurfaceUi`（host 借出 / surface 自有）。**纯类型，零实现**——core 不认识任何具体 surface。**内置四家与配置加载的 surface 都实现它**：claim 只读 `AgentSurfaceRequest`，start 收装配好的 `AgentSurfaceRuntime`——「一份契约」不再有例外。

> **`AgentSurfaceKernel` 带 `roster()`**（结构性镜像 `AgentSurfacePluginRow`：`{ name, state, enabled, error? }`）。surface 必须能如实回答「我依赖的那一行现在是什么状态」，而这与宿主「不认识任何插件名」并不冲突：surface 问的是**它自己关心的那个行 id**，判定逻辑全在 `cli/src/plugin-report.ts`（`pluginRowState` 按行 id 查 roster，顺序即语义——**加载失败优先于关着**，因为一条失败的行也读 `enabled: false`）。这条缝有两个消费者：启动时的失败行报告（`repl` / `exec`）与 `nova qqbot` 的四种成因拒绝（没有这一行 / 有但关着 / 开着但加载失败 / 加载了但凭据没填——**只有真的没有或真的关着才谈「去打开这一行」**，第四种是 `qqbot` 包自己的通道读数）。
>
> **失败行的原因必须被念出来，且不可注入**。启动横幅的「插件」一列只列**贡献了工具**的行，于是加载不了的行在那句里无声缺席——「只有剔除、没有失败提示」曾是真实缺陷。现在 `repl`（含非 TTY 回落）与 `exec` 在起跑前逐行念出每一个失败行（点名行 id + 原因，一行一个，不合并也不只报第一个），`/plugins` 的行也带上 ` — <原因>`（**关着的行不带**——健康地关着没有要解释的事）。失败**不阻断启动**：这是「插件出错是数据，不是崩溃」在呈现层的同一句话。行 id 与原因都来自插件界面的数据，落到终端前一律经 `oneLineText`（控制码点转成可见转义）——**这份实现只有一份，住在 `core/src/text.ts`**（core 零上游，所以它只能在那里；`cli/src/lines.ts` 只是**再导出**它，对外 API 不变），所以一个 `\r` 覆盖不掉已经打印的字、ANSI 序列也改不了终端状态。同一条纪律管到**出口**：core 的日志出口（`core/plugin/context.ts` 的 `defaultLog`）在写 stderr 前转义 `message`，于是 `plugin "<id>" failed to load: <插件自己抛的文本>` 与「监听器抛错」这两条相邻的日志不会一行安全、一行可注入。`nova plugin add|remove|list` 的终端输出（`cli/src/plugin-command.ts`）也已纳入同一条纪律。

surface 有**两类来源**，地位相同：

- **内置 surface**（`exec.ts` / `repl.ts` / `web-mode.ts` 各自导出 `AgentSurface` 工厂；qqbot 的工厂在 `@nova-agent/qqbot` 包的 `src/surface/mode.ts`，cli 侧只有 `qqbot-surface.ts` 的认领 + 装配贡献，由 `cli/src/surfaces.ts` 的 `builtinSurfaces` 分成 `head`（`qqbot` / `exec`）与 `tail`（`web` / `repl`））。**认领行在 cli**（判据就是 argv 形状本身：子命令、`--web`、`--repl`、非 TTY 回落——必须同步可答），**实现在哪**与认领无关：qqbot 的产品形态属于它自己的包。**认领 ≠ 启动通道**：QQ 的通道是那一行插件自己的 fiber（行关着就没有 socket），所以这个 surface 只认领并常驻，起来后先问「通道在不在」，不在就报出该开哪一行、该填哪些字段。
- **动态 surface 插件**（`~/.nova/config.json` 的 `surfaces` 行）：每行一个模块 spec（包名或 `./rel.mjs`），由 `plugins/src/surface-registry.ts` 的 `loadSurfacePlugins` 动态 `import()`——模块以 `default`（或 `surface` 具名）导出一个 `AgentSurface`，校验 `{ name, claim, start }` 三件齐备，缺一即**启动失败**（与 `plugins.entries` 同一条纪律：静默忽略一个扩展比坏掉的启动更糟）。cli 源码**不点名任何 surface 包**，只在配置 `surfaces` 行写谁才加载谁。

  解析**只有一次 `registry.resolve(request)`**——内置与动态是同一个注册表里的行，**注册顺序即优先级**：`head` → 动态 `surfaces`（配置顺序）→ `tail`，**第一个 `claim(request)` 为真的胜出**，赢家同时被记录（`registry.current()`）。所以动态 surface 是**加层**而非改道：子命令仍最高，`--repl` 仍强过任何 opt-in，浏览器默认仍在最后兜底。

  ```
  1. qqbot — positional[0] === 'qqbot'      2. exec — positional[0] === 'exec'
  [动态 surfaces：各自的 claim 判据  ← 仅当配置声明]
  3. web — !repl && (web || interactive)     4. repl — repl || !interactive
  ```

  `interactive = stdout.isTTY && stdin.isTTY`。**claim 必须覆盖交互与非交互两种 stdio**：`nova --web` 一走管道也必须被 web 认领（真机 smoke 就是这么跑的），否则会被 REPL 抢走。此判据由 `cli/test/surfaces.test.ts` 直测钉住（按 `head → 配置 → tail` 亲历注册，注册一个 fake surface 钉死动态层的优先级与回落——配置的 surface 压过浏览器默认、让位 `--repl`、自带 TTY 守卫时管道下回落内置；并钉住「赢家被记录进 `current()`」对内置与配置同样成立）。

  **关掉的行不进注册表（2026-10-01 修）**：`registry.resolve()` 发生在**装配内核之前**（`cli/src/index.ts:76-89`——先注册内置 `head`，再由 `loadDynamicSurfaces` 注册配置的 surface，再注册 `tail`，最后才 `resolve`），所以注册表是**认领集合**（「这次可能由谁服务」），不是「谁被配置了」。因此 `cli/src/surfaces.ts:91` 先问那一行是否启用，为真才注册：`if (surfaceRowEnabled(surface, registry, entries)) registry.register(surface)`；`surfaceRowEnabled`（`plugins/src/surface-registry.ts:167-173`）用装配期**同一份** `surfacePlugin(surface, registry)` 造出那一行、套 `manifestOf`，再交给 core 的 `rowEnabled` 裁决。于是 `enabled: false` 的 surface **只留面板行、不进注册表**（行仍在 `plugins.entries` 里，所以面板还能把它再打开）——旧路径只产出 `options.disabled`（不建 fiber、不跑 `apply`），**没有任何东西把它从注册表移除**，于是面板显示「已关闭」、重启后照样被认领并 `start()`——与「关掉插件后 nova 启动时还在用它」**同族**（同一个「开关只决定面板显示、不决定谁在跑」的形状），但**不是那一个实例**：用户报告的那条路是**插件树 fiber**（`plugins.entries` 的行 → `plugin-tree.ts` 判定 → 不建 fiber → 无 socket），**不受这道门管辖**——本次管的是**配置声明并加载的 `surfaces` 行**。三条边界在这里写明：① **下次启动生效**——`resolve()` 每个进程只选一次，运行期关掉**正在服务**的那个 surface **不会**热停（这是明写的边界，不是缺陷）；② `register` 按**实例身份**幂等（`surface-registry.ts:58`），同一实例不会在表里出现两次——否则卸载时 disposer 的 `indexOf` 会摘掉**另一份**，把一个已 `resolve` 并启动的 surface 静默摘出；③ 去重**按身份、不按名字**：两个不同 surface 重名是配置错误，应当被解析器看见，不该被静默吸收。

  **`rowEnabled(manifest, override?)` 是「一行是否启用」的唯一定义处**（`core/src/plugin/types.ts:278-279`：`isRequiredTier(tier) ? true : (override?.enabled ?? enabledByDefault(tier))`；结构化单行开关 `PluginSwitch` 在 `:258`）。`plugins/src/plugin-tree.ts:200,272,311` 与 cli 的装配前判定都调它（经 `core/plugin/index.ts:43` 导出），**不许在调用点重写这个表达式**——再写一份就是本仓反复拆掉的「同一件事两处各算各的」。

  **argv 解析与「谁来服务它」分成两处**：`cli/src/cli-args.ts` 拥有 `ParsedArgs` + `parseArgs`，`cli/src/index.ts` 把 flags 交给唯一一次 `registry.resolve`，认领判据住在各 mode 文件的工厂里。前者问「这行命令是什么意思」，后者问「谁来执行它」——`surfaces.ts` 只是注册表接线与优先级排序。

  > **`surfaces` 是插件行的 surface 版**：同一套动态加载原语（`resolveModuleSpec`）、同一套「校验失败即启动失败」的纪律。区别只在 `plugins.entries` 加载的是内核插件（core `Plugin`：`{ name, manifest?, inject?, Config?, apply(ctx) }`），`surfaces` 加载的是 surface 插件（`{ name, claim, start }`）——两者都不许在 host 源码里点名。

### 内核装配只有一个调用点（2026-10-01 装配合一后）

- **唯一入口**：`createAgentKernel` 在生产代码里只被 `cli/src/kernel-boot.ts` 的 `bootKernel` 调用一次；`cli/src/surface-host.ts` 的 `buildSurfaceRuntime()` 是通往它的唯一路径——**任何 surface（内置四家或配置加载）都经它装配**，装配完成后 `runSurface()` 才调 `surface.start(runtime)`。历史：曾有三个调用点（web 自装、动态 surface 自装），自装 web 的理由「`BootOptions` 装不下 `modelCatalog`」在字段补齐后失效——三个调用点曾是「新选项被静默丢掉」的温床。
- 内置四家的差异以 **`SurfaceBoot` 贡献**表达：`exec` 贡献 `perRequestCompact` + 装配后 `setPolicy('never')`（`cli/src/exec.ts` 的 `afterBoot`）；`qqbot` 的贡献由 **cli** 的 `qqbot-surface.ts` 给出——`boot.kernel` 里先**迟装载**包（缺包要在建会话日志之前失败），成功后贡献 `sessionDir: sessionsRoot()/qqbot`（对端会话与交互会话隔离）与 `perRequestCompact`；**不存在包内 `prepare()`**，装配后也不再由 cli 回填或钉策略——审批策略由包自己的 `mode.ts` 在 `start(runtime)` 里钉 `agent.setApprovalPolicy('never')`（与它「先问通道在不在」的拒绝相邻，因为「无人值守」是那个形态自己的性质，不是宿主的补贴）。web 贡献模型目录、设置页写回器与「未配置端点」的占位 provider；配置的 surface 没有贡献，拿共享的那份。`WebController.create` / `launchWeb` 收装配好的 `kernel`。
- 「装配期间的活回调」由这里的 holder 绑定：`workspace.onChange` 引用尚未存在的内核，holder 延迟解析；换工作区的反馈经 `surface.onWorkspaceChanged` 交回**在役 surface**——契约成员从此有实现方（`repl`）。

  **`userQuestions` 的单一来源**：推导规则只有一个——core 的 `deriveUserQuestions(caps)` 返回 `answersQuestions ?? interactive ?? false`，fail-closed。`runtime-env.ts` 的服务端 provider 每次调用时对 `registry.current()` 求值——而注册表现在对**每一类** surface 都有赢家（内置四家也注册在里面），所以「这次是谁在服务、他能不能问人」全仓只有一个答案；`buildSurfaceRuntime` 传的 `deriveUserQuestions(surface)` 只覆盖「没有注册表的装配」（内核测试 / 嵌入方）。该 flag 默认 **false 且是 fail-closed**（无人值守的 exec / qqbot 若拿到 answerer，run 会停在提问里直到被 abort，而没有任何卡片能释放它）。有人者在自己的 `AgentSurface` 上声明一次（`repl` / `web` 靠 `interactive: true` 推导即真），否则 `ask_user_question` 直接回一句 `no user-questions answerer accepted the request` 给模型——工具在、UI 在、提问永远不会发生。

  > 没有注册表的装配回落到 `opts.userQuestions`（内核测试 / 嵌入方显式传）。直测在 `core/test/user-question.test.ts`（`deriveUserQuestions`）与 `cli/test/surfaces.test.ts`（内置赢家也被记录进 `current()`、`ready` 级断言见 `core/src/surface.ts`）。

## 5. 核心设计

### 一切皆插件（Cordis 式容器）

工具、斜杠命令、生命周期钩子、能力服务全部经插件容器注册，并且可以**按键替换**——内核里没有任何能力是硬连线的。

- **容器**（`core/plugin/`）：`Context`（服务读写 + effect 撤销 + 事件派发）／`Fiber`（状态机 `pending→loading→active→failed→disposed`）／`ServiceStore`（`key<T>()` 寻址，provider 换代驱动依赖方重载）／`EventRegistry`（五种派发：`emit`、`waterfall`、`parallel`、`serial`、`bail`）。
- **waterfall**：监听器返回非 `undefined` 即胜出；调 `next(...)` 委派并可改写参数；不委派也不返回 = 弃权。
- **serial / bail**：第一个决定性裁决即胜出——审批门是 `priority: 1000` 的监听器，所以权限总是先被裁定。
- **effect 撤销**：一切注册走 `ctx.effect()`，返回的 disposer 在插件卸载时**逆序**执行——**正确拆除是构造出来的，不是记得做的**。
- **一份插件协议**：`core/plugin/types.ts` 的 `Plugin`（`{ name?, manifest?, inject?, Config?, apply(ctx, config) }` + 函数 / 类两种形式）是**唯一**的公共插件 API——内置、surface 自带、`plugins.entries` 第三方走同一条。`apply(ctx)` 里经 `registerTool(ctx, def, permission)` / `registerCommand(ctx, def)` 注册工具与命令（两个原语住在 `core/src/plugin/registration.ts`、与键相邻——扩展插件包因此只依赖 core，`plugins` 原样再导出），每个注册都变成容器 effect，于是正确拆除是构造出来的（插件卸载时 disposer 逆序执行）。**没有兼容门面、没有第二种插件形态**——历史上 `{ name, activate(ctx) }` 门面已随 `PluginContext` 一并删除（`plugin-tree.ts` 的加载器还会对旧写法点名报错，而不是静默什么都不注册）。
- **一行插件 = 一个稳定 Entry**（`core/plugin/loader.ts` 的 `PluginLoader`）：`id` 是身份，跨 reconcile 不变，配置、开关、fiber 都挂在 Entry 上。于是重 roster（换工作区、一次开关、一次保存）是一次 **diff 而不是重建**：plugin 与 config 都没变的行保留它的 fiber，它的工具、服务与监听器**不会被拆掉再装一遍**。行关着时（`disabled`）**不创建 fiber、不跑 `apply`**，但行仍在 `list()` 里——管理面板要能把它再打开，而「关掉的行什么也不启动」是字面意义上的（没有 socket、没有 worker、没有定时器）。
- **行是插件的，不是宿主的**：roster 组装在 `plugins/runtime-roster.ts`（`buildTree` 决定有哪些行、`PluginHost.sync` 把树交给 loader），行从**插件自己的 manifest** 取得标题/描述/档位。曾经这里有三张按名字的表（`CORE_PLUGINS`/`ADVANCED_PLUGINS`/显示标签）与一个按名字 switch 的扩展工厂，于是「加一个插件」等于改 `plugins` 的源码；现在宿主**不认识任何插件名**，只认识「一行」。
- **插件不是客人**：`PluginLoader` 本身是 `loader` 服务（`PluginHost` 构造时 provide 到根 context），所以插件拿到的是与宿主**同一组**操作——`create` / `update` / `remove` / `reconcile` / `transaction`。配合下面 `Context.scope` 的 isolate / intercept，这就是全部扩展模型：一个插件可以替换或包裹任何服务、把自己的子树挂进来、再整个收走，而不需要宿主为每项能力准备一套精选 API。
- **插件出错是数据，不是崩溃**：导入与激活失败**记在该行的 `error` 上并写日志**，绝不从 `create` / `update` / `reconcile` 抛出来（dsh `vendor/loader/src/config/entry.ts` 的 `_init()` 同一条：catch 住并 log）。所以一个坏插件既不能挡住启动、也不能挡住别的行，更不能把进程带走——操作者看到的是**那一行带原因**，这就是「插件运行出错不能影响主程序」在代码里的落法。**只有编程错误才抛**：未知 id、重复 id、未知父行、一个没有插件的 group 行——这些是宿主自己的 bug，静默才是错的。

**能力服务缝**（`core/plugin/capabilities.ts` 是**唯一定义处**）：18 个服务键 `loader` / `llm` / `executionEnvironment` / `tools` / `commands` / `approval` / `sessions` / `compaction` / `jobs` / `shell` / `spill` / `skills` / `userQuestions` / `surfaces` / `contextInsights` / `routes` / `pluginRpc` / `pluginConfig`，4 个事件键 `beforeLlmCall`(`llm/before`)、`beforeToolCall`(`tool/before`)、`afterToolResult`(`tool/after`)、`beforeTurnEnd`(`turn/before-end`)。（`pluginLoaded` 死缝已删，见 §7.5。）

**`shell` 缝替掉了「宿主按名字读 bash 那一行」**：上下文片段要告诉模型「你在什么 shell 里工作」（`shell=<name>`），而这个答案只有**跑命令的那个插件**知道。此前宿主在 `runtime-env.ts` 里 `entries.find(e => e.id === 'bash')` 去读它的 `shellPath`——那是宿主源码里的插件名，而且操作者一改 `shellPath`（或换掉这个插件）就会与实际执行不一致。现在 bash 在自己 `apply(ctx, config)` 里 `ctx.provide(shell, { name, path })`，宿主读服务、没有 provider 就回落到探测环境（与终端面板同一条）。**行关掉即服务消失**，因为 provide 挂在 fiber 上。

**键的四个新成员就是「插件与宿主同权」的落地**（`plugin-services.ts` 与 `host.ts` 各自只是提供者）：

- **`loader` → `PluginLoader`**：`create` / `update` / `remove` / `reconcile` / `transaction`——一个插件能在运行时管理**别的行**。它随 `PluginHost` 构造即 provide，所以拿到的实例与宿主**是同一个**。键定义搬进 `capabilities.ts`（原先在 `loader.ts`），为的是「这个文件是键的唯一定义处」这条不变量继续成立。
- **`pluginRpc` → `PluginRpc`**：插件**声明自己的命名空间**（`register(name, handler)`，disposer 挂在它自己的 fiber 上），界面侧 `invoke(name, op, payload)` 调用。**被关掉的插件没有命名空间**，所以它什么也不回答——宿主因此不需要为任何插件准备请求族，一个通用的 `plugin_request` / `plugin_response` 帧对就够了（`web/src/plugin-frames.ts`）。payload 是 `unknown`，因为只有那个插件知道自己的操作是什么意思。
- **`pluginConfig` → `PluginConfigPort`**：`readEntry(id)` 返回**文件里写的那一份**（`{env:NAME}` 因此能按**名字**回显，而不是把密钥漏出去），`setEntry(id, patch)` upsert 那一行——`config` **逐键合并**（表单只提交它拥有的字段：省略＝保持原样，`null`＝删掉这个键，于是操作者手写的 `{env:NAME}` 引用不会被展开后的密钥顶掉），写完**立刻重 roster**。放在端口里而不是每个调用点，是为了让「存了却没生效」不可能发生：保存与生效是一步。
- **`executionEnvironment` → `ExecutionEnvironment`**：活的 provider、活的工具注册表、组合后的钩子、persona、工作区根与进度汇（都按调用时求值，不是装配时快照），供 `subagent` / `ptc` 这类**执行类插件**用。于是它们从「内核点名构造的工厂」变成「`inject` 一个服务的普通包」——宿主不再需要认识它们。
- **`Context.scope({ isolate, intercept })` 与 `Context.labelled(id)`**（`core/plugin/context.ts`，转写 dsh `vendor/loader/src/config/isolate.ts`）：`isolate` 给一个服务名分叉出私有 provider（子树读到自己的那份，别的子树不受影响），`intercept` 包裹任意服务的实现（替换或仅做观测）。**刻意没有「可拦截服务」的白名单**——store 里每一个键都能被包裹，工具与 agent 循环自己的缝也不例外，因为它们就是普通服务。

> **18 个服务键里 17 个有提供者；`routes` 是宿主可选缝。** `surfaces` 当初是无提供者的「刻意死缝」——注册表在 plugins（`surface-registry.ts`），契约被 surface 包消费，但它**不进容器**：注册表必须在内核装配之前就存在（先决定哪个 surface 服务这次 argv，才装内核），而容器是内核装配的产物。这条「先得有、再装配」的时序约束依然成立——**注册表对象先于容器**——装配方把已加载的 surfaces 连同注册表一起交给 `createAgentKernel({ surfaces })`，容器经 `runtime-env.ts` 的 `surfaceRegistryProvider` 把**同一个**注册表实例 provide 成 `surfaces` 服务，于是 surface 变成一条普通插件行（出现在 `/plugins`、落 tier 表、可开关）。它**有提供者**，只是提供的是「容器外的同一实例」，不是新建的。`routes` 走同一条「容器外实例」的路线：宿主（`web-mode.ts`）建一个 `WebRouteRegistry`，经 `routeRegistryProvider` 进 `extraPlugins`、把同一个实例 provide 成 `routes` 服务；插件经 `ctx.must(routes)` 注册自己的资产前缀。**与 `surfaces` 不同的是 `routes` 是 host-owned**：只有跑着 HTTP 服务器的宿主（web surface）才 provide 它；headless（exec / qqbot）不 provide，插件读到 undefined 即降级（genui 在终端没有面板要渲染，资产路由自然也不需要）。

### 插件设置页（插件自带，宿主只画）

插件的设置**不问宿主**：插件在 `manifest` 里声明 `page: true`（`core/plugin/types.ts`），于是浏览器侧的 roster 行带上 `page?: boolean`，导航就多出它一节；点进去时界面发一条通用 `plugin_request`，`op` 为 `page`，插件回一个 `PluginPageDescriptor`（`core/src/plugin/settings-page.ts` 的 `{ title, intro?, guide?, status?, fields?, actions? }`）——字段是四种原语的数组（`text` / `secret` / `select` / `switch`），行为是具名动作。

- **宿主只提供一个渲染器**：`web/ui/src/settings/PluginPageSection.tsx` 把描述符画出来，`pagePlugins(rows)`（`settings/plugin-state.ts`）从**活 roster** 里筛出 `page === true && enabled !== false && state === 'active'` 的行；导航因此与「谁真的开着」同源，不存在一处写死的页清单。判据是**白名单而不是 `state !== 'failed'` 黑名单**：一节页要靠那个插件自己的 `pluginRpc` 命名空间回答 `page`，而命名空间**挂在 fiber 上**——`pending` / `loading` 还没跑 `apply`、`disposed` 已拆、未知相位同样证明没有命名空间，所以「没报故障」不等于「有活 fiber」，只有 `active` 能答。两个字段答两个问题：`enabled` 是**操作者意图**的事实（关掉的行 `enabled: false`，而 `apply()` 抛错的行 `enabled` **仍是 `true`**——操作者确实要它开），`state` 是**活性**事实；所以「关着」与「开着但坏了」是两件事，**面板必须能说出后者**，而导航只给活着的页。
- **读写都走同一对端口**：`pluginConfig` 读那一行的原样 config（`{env:NAME}` 按名字回显），保存时提交**它自己拥有的那些键**——逐键合并，所以「表单没提到的字段」不会被抹掉。谁拥有哪个键由插件自己的 `Config` schema 说了算，界面不认识任何插件的字段名。
- **一个插件做示范**：QQ 通道的凭据、拨号、探针、状态读数全在它自己的 `page` 回复里，所以删掉 `QqbotSection` / `qqbot-view.ts` / `save_qqbot` 帧之后行为不缩水——**界面里没有一行按插件名分支的代码**。这也意味着第三方插件能给出与本仓内置插件同等质量的设置面板，而不需要改宿主的任何源码。
- **答得了 `page` 不等于进得了导航**：页面可见的**必要条件**是那个插件**在自己的 manifest 里声明 `page: true`**（另两条见上一行：没被关掉、且 `state === 'active'`；今天 `qqbot` 与 `plugin-ptc` 各自声明一次）。RPC 命名空间注册得再全，缺这条声明就是一片不可达的页——曾经两行都只注册命名空间、都不声明，于是 QQ 与 PTC 的设置页在真实产品里根本不出现，而手写 fixture 的测试照样绿（夹具替生产者作证）。所以**加一条 `page` 回复时，同一处必须补上声明**；宿主不留「谁有页」的名单。判据一句话：**一个能力的证据，是它在真实路径上被用了一次——不是类型里有这个字段，也不是夹具里有这个值。**

### 装载器的能力边界（写下来，免得被当成缺陷）

`PluginLoader` reconcile 的是**配置树**：行的增删改、服务的替换与包裹、fiber 的挂载与卸载。**它不做 Node 模块代码热替换**——模块解析、`import()` 缓存失效、旧模块实例的回收都不在它的职责里（`core/src/plugin/loader.ts` 头部明确写着这条边界）。所以「改一行插件的 `config` 或开关立刻生效」与「改一个插件模块的源码后不重启就生效」是两件事，只有前者成立。**写下这条的理由**：把「配置重载」误读成「代码热载」，会让人以为改完源码立刻能被验收——而真相是 `pnpm dev` 之外的场景必须重启进程。

### 内核协议（`AgentSession` + `KernelEvent`）

`KernelEvent` = `AgentEvent` 的 11 个（`turn_start` / `text_delta` / `reasoning_delta` / `message` / `tool_call_start` / `tool_call_result` / `usage` / `turn_aborted` / `llm_retry` / `empty_completion` / `done`）+ **内核新增 18 个**：`user_message`、`phase`、`approval_request`、`approval_resolved`、`question_request`、`question_resolved`、`tool_progress`、`subagent_update`、`job_update`、`queue_update`、`todo`、`goal`、`model`、`command`、`compaction`、`run_failed`、`run_stats`、`notice`。

辅助联合（`protocol-vocabulary.ts`）：`TurnPhase = idle|thinking|writing|tool|waiting_approval|waiting_question|compacting|retrying`；`NoticeCode = compacted|compact_fused|compact_alias_broken|compact_failed|surface_lagged|listener_failed`。

**一个 surface 只需 `switch (event.type)` 就能驱动整个产品**——凡不在协议里的都不可观测，这既让 surface 可替换，也让它们能针对同一个 reducer 直测。

- **`AgentSession`**（`core/kernel/session.ts`）是 surface 拿到的**唯一句柄**：`events`；`session` / `messages` / `status` / `running` / `currentPhase` / `lastUsage` / `lastPromptTokens` / `queued` / `approvalMode`；方法 `usageSnapshot()` / `setApprovalMode()` / `setApprovalPolicy()` / `pendingApprovals()` / `pendingQuestions()` / `subscribe()` / `notice()` / `announceCommand()` / `announceModel()` / `observeSubagent()` / `observeJob()` / `jobSnapshots()` / `stopJob()` / `prompt()` / `abort()` / `resolveApproval()` / `resolveQuestion()` / `cancelQuestion()` / `compact()` / `dispose()`。surface 不自己跑生成器、不自己落盘——「model-visible means logged」由内核 `consume()` 保证。
- **`Kernel`**（`plugins/runtime-types.ts`）：`agent` / `hooks` / `host` / `llm` / `models?` / `commands` / `runCommand()` / `permission` / `jobs` / `skills` / `allSkills` / `disabled` / `systemPrompt` / `rootDir()` / `sessionEnv()` / `buildFragment()` / `roster()` / `newAgentSession()` / `activateSession()` / `setWorkspace()` / `setPluginEnabled()` / `setSkillEnabled()` / **`pluginConfig(id)`** / **`pluginRpc()`** / `dispose()`。实现是 `runtime-facade.ts` 的活读门面（`models` 在没有 `modelCatalog` 时**整个键不出现**，而非空 object）。**契约里没有 `codeMode()` / `setCodeMode()`**：执行模式是 `@nova-agent/plugin-ptc` 那一行自己的 `config`（`pluginConfig(id)` 读它），一个插件的能力不该住进每个 surface 都要实现的契约——cli 的 `/mode` 就是这样按行 id 读回来的（`cli/src/command-runner.ts` 的 `codeModeInForce`，其显示词汇是 cli 自己的三态文案，因为它的依赖白名单里没有那个包）。
- **`EventPump`**（`kernel/pump.ts`）：`MAX_LAG = 2000`；落后消费者的窗口被清空并替换为一条 `surface_lagged` 通知；**抛错的监听器被隔离**（`listener_failed`）而不是把进程带走。
- **量测**：`RunMeter` / `RunStats`（`kernel/metrics.ts`）——`startedAt` / `durationMs` / `firstTokenMs?` / `llmMs` / `toolMs` / `requests` / `toolCalls` / `retries` / `promptTokens` / `completionTokens` / `cachedTokens`。

> **`AgentSession` 没有 `setModel`。** 切换是 `ChatProvider.setModel()`（原地改写同一客户端实例）→ `runtime-models.ts` 随后调 **`AgentSession.announceModel()`** 发 `model` 事件。

### 命令目录

斜杠命令也是插件缝：`core` 声明 `CommandRegistry`（`ctx.registerCommand`，与第三方插件同一条公共 API），**`plugins/kernel-commands.ts` 是其唯一生产者**。`commandRunner` 同时给出**活目录**（`catalog()` 每次读容器）与**唯一 runner**（`Kernel.runCommand(name, args)`）。

分工线画在**能力**上，不在名字上：需要界面才能完成的事（换主题、退出进程、打开模型选择器）**不进这个目录**，归那个界面。反之任何插件注册的命令——第一方或第三方——都自动出现在每个界面菜单里并由同一条 runner 执行，**没有第二份目录**。

runner 契约是「调用方永远拿到一条可渲染的结果」：开一条 `command` 行、收集命令自己 `log` 的行、以 `done` 行收尾（命令抛错**把原因写进同一行**，不中止会话）；未知名字同样留一行。前端「一份草稿意味着什么」是 `ui/src/composer/command-menu.ts` 的一组纯函数：注册表认得 `/name` 就发命令帧，认不得就**原样发提示词**。

REPL 壳保留自己的 `COMMAND_SPECS`（`/theme` / `/clear` / `/exit` 只有终端能做）；未命中壳条目的 `/name` **回落到内核 runner**（`command-runner.ts` 的默认分支先查 `kernel.commands` 再宣布未知）——于是 `/compact` 与 `/goal` 不再是壳里的第二份实现，但每个界面的菜单仍要认得它们：`commands.ts` 的 `mergedCommandSpecs(registry)` 把壳条目与注册表条目**合并成一份目录**（壳条目胜同名冲突，界面专属参数列不进通用行），`surface-host.ts` 的 `catalog()` 每次活读注册表，设置页保存后菜单无需重启即更新。

### 呈现意图词汇表（core 拥有形状，surface 拥有观感）

`core/presentation.ts`：`ToolCallKind`（`read|edit|write|search|execute|job|subagents|plan|question|other`）+ `card` 判别的 `ToolCallView` / `ToolResultView`。**core 只拥有调用的形状与语义**（无文案、无颜色、无列宽），**文案 / 颜色 / 列宽 / 降级档位一律归各 surface**。

**`kind` 在每一张 call view 上**（不只是 `generic`）：专用卡说的是「怎么画」（终端转录 / diff / 命中列表），`kind` 说的是「它做了什么」，而任何要**归类或汇总**工作的消费者（WebUI 的过程分组标题）需要的是后者。曾经 `kind` 只长在 `generic` 上，于是想要 bash 归类的汇总代码只能写 `name === 'bash'`——那就是同一张表的第二份、会漂的实现（它甚至猜了两个本仓不存在的工具名，并漏掉 `list_dir` / `jobs` / `get_time`）。

工具经 `ToolDefinition.presentCall?(args)` / `presentResult?(args, content)` 声明自己是什么，界面 `switch (view.card)` 消费，**不按工具名特判**。两者都是纯函数，且 `presentCall` **不得读盘**（它在授权前被调用，审批弹窗要能为尚不存在的文件画出 diff），故签名里没有 `ctx`。未声明的工具（含第三方、`jobs`、`run_code`）自动落 `generic` 卡——**永远不会不可渲染，只是不够具体**。

**视图解析归宿主，不归界面**：`callViewOf(tools, call)` / `resultViewOf(tools, call, content)` 从**活工具表**取声明，控制器在出站前把 `view` / `resultView` 附在帧上，`ready` 回放时对每个历史工具块做同一件事。于是浏览器侧零按名特判、零失败启发式。

**工具结果 `meta` 是一条单方向的缝**（2026-10-01，为 dsh-genui 风格插件开）：`ToolResultMessage` 增可选 `meta?: Record<string, unknown>`，由 `ToolDefinition.resultMeta?(args, content)` 在 `completeToolCall` 末尾（`afterToolResult` 钩子与截断**之后**）填入——把一份只给 surface 看的结构化数据（genui spec、校验态、typed payload）挂在结果消息上。**绝不进模型可见面**：它不改 prompt 前缀、不沾缓存键。传输上它**随 `tool_call_result` 事件对象整体到达浏览器**（`wireFrame` 只附 `view` / `resultView`，不剥 `result`），所以这不是「只下发到某个接收方」，而是「到得了、但没人读」——**仓内今天没有任何消费者**（`web/ui/src` 零 `result.meta` 读取，repl / exec 也没有），读取方是**第三方的 client bundle**。两个内置工具今天都不声明它，行为零变；声明了的工具，直测钉住「meta 进日志、content 不动」（撤掉 meta 写就会红）。

### 内核缝：插件 UI 能力（genui 准备）

为 dsh-genui 风格的第三方插件留的六条缝（2026-10-01，侦察报告的六项已全部落地；每条的判据都是「它在真实路径上被用了一次」，不是「类型/字段齐了」）：

- **系统提示 section 注册表**：`buildSystemPrompt(sections)` 把插件 section 追加在 persona 之后、各自 `## <name>` 小标题；同名后写覆盖**正文**但**保留首次出现的位置**（再注册读作更新而非搬家）；空正文/空列表退化为裸 persona。**关键约束**：section 在**装配时**一次性解析（`createEnvironment` 把 `opts.systemPromptSections` 喂进来），不是每请求重算——否则前缀字节能被一次钩子改写、命中缓存契约当场作废。`CreateKernelOptions.systemPromptSections` 是新的可选注入点。实现按职责分文件：`system-prompt.ts` 拥有 persona（「代理是什么」），`prompt-sections.ts` 拥有 section 注册表（「插件这次挂了什么」）。
- **fence 渲染注册表（前端）**：`chat/markdown/fence-renderers.ts` 是一个 `Map<lang, FenceRenderer>`——markdown parser 已经把 info string 小写化，注册表对小写键查找，未注册的语言回落到 `<pre><code>`（注册零个 = 逐字节复现之前的页面）。`blocks.tsx` 的 `renderCode` 在 CodeBlock 之前先问注册表；返回 `null` 表示放弃（renderer 自己判定 spec 不能用），同样回落。**这是插件 UI 能力的接口**：把插件组件拉进 markdown 叶子会倒置包依赖方向，registry 让叶层插件无关、插件从自己的模块注册自己。
- **turn-stopping 钩子（`turn/before-end` 事件）**：`agent/loop.ts` 在「无 toolCalls、即将 `done`」前先跑 `ctx.serial(beforeTurnEnd, …)`；插件返回 `{ action: 'steer', message }` 即追加一条 user/assistant 消息继续回合（受 `turn < maxTurns` 配额保护，配额耗尽仍按 `done` 收尾）。返回 `void` 即弃权，旧路径逐字不变。`AgentSession.prompt()` 之外有了「**回合将停**」的注入位，不依赖 surface 配合——服务端钩子在装配点接线，无人值守 surface 也吃得到。**机制五端齐备**（键 `capabilities.ts:549`、派发 `loop.ts:129`、组合 `hooks.ts:77` 的 `ctx.serial`、类型 `types.ts:389`、`test/agent.test.ts` 两条直测），但**仓内今天零生产者**：`ctx.on(beforeTurnEnd, …)` 在全部 `packages/*/src` 里一次也没有，那两条直测是**直接注入 `AgentHooks` 对象**、绕过容器与 `ctx.serial` 的。所以它是一条**为第三方插件留的缝**（与 `clientBundle` / `routes` 同族），**不是**任何内置实现的现役路径——`goal` 的跨轮续做走的是 `beforeLlmCall`（`builtin/goal.ts:261`；`beforeTurnEnd` 在该文件零命中）。按本节的判据，这一条**恰恰是又一个「类型/字段齐了、真实路径上还没被用一次」的例证**。
- **插件资产路由（`routes` 服务键 + `RouteRegistry`）**：`capabilities.ts` 增 `routes: ServiceKey<RouteRegistry>` + `PluginRoute`/`PluginRouteHandler`/`RouteRegistry` 接口；`plugins/services.ts` 的 `routeRegistryProvider(registry)` 把宿主建好的实例 provide 进容器；`web/route-registry.ts` 的 `WebRouteRegistry` 实现 register/routes/handlerFor（前缀精确与嵌套都匹配、**反向注册序**派发——同前缀后注册的胜，与容器 replace-by-key 同语义）。`web-mode.ts` 在 boot 时实例化并经 `routeRegistryProvider` 进 `extraPlugins`、同时随 `launchWeb({ routes })` 透传给 server。`server.ts` 的 `handleHttp` 在认证门**之后**、图片/静态**之前**问 `registry.handlerFor(relPath)`——**插件路由仍然是私有读**（与 `/manifest.webmanifest` / `/favicon.svg` / `/icons/*` 品牌资产例外不同），命中即交由 handler、未命中回落静态。headless（exec / qqbot）不 provide 这个键，插件 UI 能力按「读不到就降级」收场。
- **工具结果 meta 是一条单方向的缝**：`ToolResultMessage.meta` **绝不进模型可见面**；它随 `tool_call_result` 事件对象整体到达浏览器，但**仓内零消费者**（读取方是第三方 client bundle）；`ToolDefinition.resultMeta?(args, content)` 在 `completeToolCall` 内、`afterToolResult` 钩子之后调用——genui 的 spec、结构化校验态、typed payload 都走这条。两个内置工具今天都不声明它，行为零变。
- **浏览器侧插件装载器（boot graph + script injection）**：声明点是插件自己的 manifest —— `PluginManifest.clientBundle?`（core `plugin/types.ts`，`{ path?, rev? }`），**照抄到** `PluginRosterEntry.clientBundle?`（`runtime-roster.ts` 的 `describePlugins` 逐字段映射，缺席即纯服务端插件、键**不出现**而非 `null`）与 `WireRosterEntry.clientBundle?`——`roster-wire.ts` 再把它从 kernel 透传到 wire；`web/ui/plugins/client-loader.ts` 是浏览器侧装载器：`buildBundleUrl`（编码名字、默认 `client.js`、`rev` 转 `?rev=` 缓存击穿）+ `loadClientPlugin`（每个 `<name>` 一条 `<script>` 注入，记入 `window.__NovaPlugins__[name]`、按页记忆化、失败一次即终态不再重试）+ `loadBootGraph`（并行装载所有声明了 `clientBundle` 的启用插件，单个失败不阻塞其他）+ `registerClientPlugin`（host 内置插件短路）。**纯逻辑与 DOM 分层**：DOM 触碰只落在 `injectScript` 一处，其余全是纯函数 / UI 测试车道（node 环境、无 jsdom）直测——装载器有 15 条直测覆盖 URL 构建、记忆化、失败终态、boot graph 走查；DOM 注入器经 `setScriptInjector` 可换，让测试用 resolver helper 驱动结算。**生产入口已接上**：`App.tsx` 在 `[connection, rosterEntries]` 上单飞调一次 `loadBootGraph(rosterEntries)`，逐个报告 `error` 的走 `console.error`（此前装载器与它的 15 条直测都在，但 `loadBootGraph` 只被测试调用，`App` 从不读 roster 上的 `clientBundle`——「机制齐、接线缺」的假闭环）。所以插件 server 半经 `routes` 注册 `/plugins/<name>/*` 并在**自己的 manifest 里**声明 `clientBundle.rev`，浏览器在首次 `ready` 后就会去取它并注册到全局。**这一条曾第二次踩同一个坑**：消费端（`App`）与透传端（`roster-wire`）都在，而**生产者根本不存在**——`describePlugins` 从不写这个字段，于是 `entriesToLoad` 恒为空、`loadBootGraph` 恒为空转，`pnpm gates` 与手写 fixture 的直测都照样绿。判据是「一个有浏览器半的插件真的被浏览器取了一次」，不是「字段在类型里」。六条缝（meta / prompt-section / fence / turn-stopper / asset-route / boot graph）都已落地，但**每条的判据都同上**：它在真实路径上被用了一次——不是类型里有字段，也不是夹具里有值（`page` 是反例：投影端、消费端、帧透传端三处都在，生产者缺席了很久）。

### Web surface

`nova` 的默认形态 = 一个 Node 进程托管前端 + 一条 WebSocket 事件流，**没有第二套状态**：内核事件进，帧出。

- **持久日志是真相，`ready` 覆盖转录**。浏览器不累积「自己以为的历史」；挂上 socket 就收到 `ready` 基线（`rootDir` / `sessionFile` / 模型 / 审批档 / 模式 / `commands` / `history` / `historyTotal` / `runTotals` / 挂起审批 / 用量基线 / 窗口分母），**重连即重建**。回放块由服务端 `transcript.ts` 从 `deriveMessages()` 投影（跳过上下文片段、工具调用与结果按 id 配对）。
- **两个窗口，同一切点**：转录基线与轨迹（`session-pages.ts` 的两条 `LogWindow`）在同一时刻切。`ready` 带 `HISTORY_TAIL = 40` 与 `traceTotal`；`load_earlier` / `load_trace` 按 `{ have }` 向前翻页。`baseline.ts` 的**冻结快照**是游标所依（实时事件只追加在客户端活区，绝不进这个数组）；轨迹 `have: 0` 是重读，非零按已切窗口计数；「已全部持有」回空批而非报错。
- **流式渲染按帧、不按块**：provider 的 chunk 率不是渲染率——socket 入口的 `StreamCoalescer` 把 delta 缓冲到每个绘制帧至多释放一次（`requestAnimationFrame`；后台标签页零渲染，回前台一次性落定）。合并只发生在**相邻同 kind**（`text_delta` 另要求同 messageId——两段文本绝不能拼成一条；`reasoning_delta` 无 messageId 字段，按 kind 断）的 delta 之间，**任何非流帧到达前先 flush**，所以 reducer 看到的序列与内核发布逐字一致。渲染侧配套两条：**行组件全部 memo**（新增行组件必须 `memo`，回调传稳定引用——内联闭包会让 memo 永远失效），`App` 的 `flowRows`/`runningStatus` 走 `useMemo`——一次 delta 只重渲它自己那一行。**发送消息强制回底**（dsh `use-chat-scroll` 的 own-input 规则）：判据是**最后一条 user 行的 key 变化**（`scroll-follow.ts` 的 `lastUserKey`），**不是尾行是不是 user**——`flowRows` 在 user 行后必然追加 turn header，尾行判据永不成立（本仓曾如此，自动滚动从未发生）；own-input 到达时**压倒读者的阅读位**（滚动过也拉回），翻页 prepend 不改 key 故不误触。
- **线上硬上限**：客户端帧 ≤ 512 KiB，`have` ∈ `0..1e6`，WS 单条 ≤ 1 MiB（超限以 1009 关闭）；畸形帧拒绝并给出原因，不静默截断。
- **会话列表不参与「重建」**：`ready` 重置一切会话态，**唯独不清空侧栏列表**——切会话会广播 `ready`，而重列不是让面板眨眼的理由。**每会话的浏览器态随会话同寿**：面板视图（对话/轨迹/上下文）在切换时落回「对话」——view 若跨会话存活，新会话的 hero 会与旧面板同屏叠加（hero 相位下 tab 条不渲染，残留的视图没有回来的路）；而**同会话重连保持**视图（socket 抖动不该把读者从轨迹页踢走）。详情面板的选中 `callId` 同寿（存活的 id 会让右侧轨道为查不到的块保持空开）。契约：`ready` 只把 `sessionsStale` 置真，客户端在「陈旧且无请求在飞」时单飞补问，答到之前旧行继续渲染。服务侧对应地让重问便宜：`core/session-listing.ts` 并行 `stat` + 按 `mtime:size` 记忆化 `peekSession`（**键不能只有 mtime**：NTFS 时间戳约 15ms 一格，「换工作区后立刻重列」时前后 mtime 可能相同，旧 head 会被永久命中；size 每次追加都变）。
- **空白会话只是「待用」的那一个**：会话**在第一条提示词之前就已存在**（`Session.create` + 工作区标记 + 上下文片段），所以「开始了没有」是**内容问题**——判据是 core 的 `isBlankSession`（用户角色消息是否**全部**是 runner 播种的片段，与头部扫描共用 `isContextFragment` 同一份规则）。两条后果：①**已在空白会话上再点「新会话」不新建日志**（否则每按一次多一个空壳），只回一份新基线；②列表里**只有当前打开的那个空白会话成行**。头部扫描（`session-peek.ts` 的 `blank`）是同一判据的有界读法：缓冲区**读满即判非空**（截断的头部里「没看到提示词」不等于「没有提示词」，**失败要偏向显示**）。服务端为此多读 `BLANK_SCAN_SLACK` 个头部再裁页。
- **工作区归属：头扫描与完整投影必须给出同一个答案**。两者曾规则不同：前者取**第一个**标记并在首条提示词处 `break`，后者取**最新**一个——于是中途换过工作区的会话被列在它**已经离开**的目录下。如今两边都取**最新**标记，头扫描也**不在提示词处停止**（**标记追加在提示词之后是常态**）。
- **`ready` 基线要带齐「首绘就正确」所需的活读数**：`commands` 与 **`roster`** 都在 attach 时从活注册表读。这是同一条纪律的两次教训——设置导航由**活 roster** 派生（关掉的插件页必须从导航消失），而 `roster` 帧只由插件管理页请求，于是**重启后直接打开设置**会画出已被关闭插件的页；`ready` 带上 roster 后首绘即正确。凡「导航 / 菜单 / 分组的形状由某个列表决定」而该列表另有专用帧时，基线必须自带一份，否则冷启动与热路径给出两个答案。
- **`launchWeb` 整份透传 controller 选项，不逐字段手抄**：只解构出四个托管项，其余交给 controller——逐字段重建时**新加的可选字段会被静默丢掉**（可选属性不在类型里，编译不报错），而 controller 单测不经过这道缝。
- **模型记忆落在配置文件，不落在浏览器**：一次模型切换**跨进程**记住，写回 `~/.nova/config.json` 的 `provider.model`。**必须改写原始文本**（`cli/config-write.ts`）：`loadConfig` 会跑 `expandDeep` 把 `{env:MY_KEY}` 展开成密钥，**把解析后的对象写回去就等于用明文替换引用**。落盘用同目录 tmp + rename。**浏览器存不了这件事**：`NOVA_WEB_PORT` 未设时端口临时分配，而端口是 origin 的一部分——每次启动都是新 origin。写失败**不回滚已发生的切换**，按错误帧报给读者。
- **surface 触摸文件系统的四件事**：换工作区、删会话、查文件、浏览目录。四个帧都遵守同一条纪律——**校验先于变更，答复即状态**：
  - `set_workspace {dir}`：先经 **`resolveWorkspaceDir()`** 校验（不存在 / 不是目录 / 落在 `~/.nova` 内一律拒绝），**再**调内核。顺序不可颠倒：`setWorkspace` 会把 bash / search / fs 的根一次性改指。通过后广播新的 `ready`——`rootDir` 是客户端获知工作区的**唯一**来源。
  - `delete_session {file}`：`deleteSessionLog()` 复用 `sessionLogPath()` 的同一道边界（删除与 resume 的合法范围**逐字相同**），**真删**（日志即会话，文件还在就仍会被列出）。文件已不在时回一条 error 帧——这是正常竞态而非故障。前端删除按钮在会话行的悬停位（dsh `Rows.tsx` 规则：动作占用时间戳单元格），确认框的**取消键带 `data-modal-autofocus`**（误按 Enter 必须落在安全侧）。
  - `list_files {query}` → `files {query, items, truncated}`：**两种语义，dsh `file-reference-local` 的切分**——查询**带 `/`（或为空）= 活目录列表**：列出该目录自己的孩子（`src/` 列 `src`），目录在前（dsh `kindRank`）、按名字母序，点条目默认隐藏、查询以 `.` 开头才现身（敲 `.env` 找得到 `.env`，敲 `e` 找不到）；**裸词 = 模糊走**：广度优先按相对路径子串全工作区匹配（浅层优先）。两种模式都跳过 `.git` / `node_modules` / `dist`、**绝不跟随符号链接**、条目（200）与墙钟（1s）双上限；被截断时**明说**（"没有更多" 与 "没查完" 是两件事）。目录模式在 `core/file-listing-directory.ts`（`src/` 查询的答案必须是「所入之目录的孩子」，此前的全树子串匹配让下钻看到的是满屏散件）。前端菜单在**词首**的 `@` 处开启（邮箱地址不弹列表），空格结束未加引号的引用，`"…"` 让带空格的路径保持为一个 token；**下钻**（Tab / chevron / 面包屑）把 token 改写成 `@dir/` 并在菜单顶部钉出**面包屑头**（根目录→…→当前，当前步不可点；**只有下钻才有**——手打的路径上下文就在草稿里，dsh `ui-reference` 的 `crumbsFor` 同一规则），行带 folder/file 图标与「文件」节标题（dsh `MenuView` 同源；有面包屑时行不再重复父目录描述）。
  - `pick_file {}` / `pick_directory {}` → `picked {kind, path?, error?}`：**原生对话框优先**。浏览器的选择器给不了路径（`File.path` 是 Electron 扩展、`showDirectoryPicker()` 的 handle 也不带 `path`），而 `@` 引用与工作区都按**绝对路径**采纳——但宿主进程就跑在用户机器上（同一 launch token 认证，等同一句「坐在电脑前的人」），所以**让宿主开操作系统的对话框**：Windows 用 PowerShell + WinForms（`OpenFileDialog` / `FolderBrowserDialog`，零第三方依赖），POSIX 用 `zenity --file-selection`（`--directory` 选目录）；都没有则回 `picked.error`，前端**回落到下面的进程内浏览器**。**对话框弹出后由脚本自己把它顶到最前**：WinForms 定时器（跑在 `ShowDialog` 的消息循环里）找到本进程的 `#32770` 窗口，`SetWindowPos(HWND_TOPMOST)` + `SetForegroundWindow`，每 120ms 一次、约 1.7s 后自停——**轮询不是装饰**：窗口在 `ShowDialog` 进入之后才创建，试一次必然落空；`FolderBrowserDialog`（选目录那条）尤其如此，它自己永远不会激活。**刻意不用 dsh 的合成 Alt 按键**（它 `win32-dialog-worker` 就是这么做的）：Alt 是全球按键，会落到当前焦点窗口——火狐里直接弹出传统菜单栏（用户实测的「卡出旧版火狐菜单栏」）。本脚本零按键注入，测试里有一条断言钉住（`not.toContain('keybd_event')`）。**脚本经 `-EncodedCommand` 传入**（UTF-16LE 脚本的 base64），不是 `-Command`：脚本里有中文标题/描述，而这种形式是 PowerShell 自己定义的、对引号/转义/重编码免疫的通道——进程代码页与系统语言都不再参与（输出侧仍由 `[Console]::OutputEncoding` → UTF-8 保证 CJK 路径经管道不乱）。`picked` 的三种读法是三个事实：带 `path` = 选了；带 `error` = 这个宿主没有对话框可开（回落）；两者都无 = 用户取消（仍回一条裸 `picked`，前端读作「无事发生」，但单飞守卫照常落锁——守卫不能靠「不回帧」解除）。对话框是模态且用户-paced 的，**子进程不给超时**；取消与空输出是同一结果。前端两个入口（`+` 菜单「引用本地文件」与 hero「打开文件夹」）都**原生优先**，回落共用 `ui/src/shell/native-pick.ts` 的同一条缝（同一时刻只允许一个对话框在飞）。
  - `list_directory {dir?, files?}` → `directory {path, home, parent?, crumbs, roots, entries, truncated}` 与 `create_directory {dir, name}`：**工作区选择器与文件引用共用的目录浏览**（原生对话框的回落，也是无对话框环境的主路）。浏览器标签页没有能用的文件夹对话框——`showDirectoryPicker()` 在 `http://127.0.0.1` 上确实存在（回环算安全上下文），但它 resolve 出的 handle **不带路径**（`path` 是 Electron 扩展），而工作区按**绝对路径**采纳，所以**挑路径 = 问宿主枚举一层并画出来**（`core/directory-listing.ts`）。三条纪律：**默认只列目录**（`files: true` 才给文件，`kind: 'dir' | 'file'`）、**绝不跟随符号链接**、**拒绝与空列表是两种答复**（`directory_error` 帧 vs 空 `entries`：不可读的挂载不能看起来像空文件夹）。每条目带宿主拼好的绝对路径（浏览器永不自己 join）、home 面包屑裁剪到主目录、新文件夹名经 `isSafeDirectoryName` 校验（`.`, `..`, 分隔符, 控制字符, Windows 保留字符一律拒）。**`roots`（`directory-roots.ts`）是「只能选 C 盘」的正解**：Windows 上盘符是 `dirname` 的**死端**（`dirname('C:\') === 'C:\'`）而主目录只在一个盘上，所以光靠往上走永远到不了 `D:`——卷列表只有宿主知道，随每一层下发（Windows 逐个 `stat` 探活）；另配 dsh 的 `.crumbEditZone` 路径编辑框。前端 `DirectoryBrowser.tsx` 是进程内弹窗（portal + modal layer，另有 `DirectoryBrowserDialog` 无 portal 纯 markup 供无 DOM 的静态测试车道直接走）。**关闭即丢弃已取列表**（下次打开重问——宿主可能已经变了）。
  - **引用是文本，不是协议对象**：一次挑选写进草稿的是 `@path` / `@"path with spaces"`——用户本可以手打的那种文本。因此「model-visible ⟺ logged」不需要任何日志改动就仍然成立；模型用已有的 `read_file` 读取它。这也是 `files` 帧回传 `query` 的原因：落在旧文本上的迟到答案据此丢弃，而不是替换成没人正在问的候选。
  - **但显示成 chip**：草稿与已发出的消息都把 mention 画成药丸（dsh 的观感：品牌蓝字 + 圆角 + 浅底 + 文件/文件夹图标），文本本身一个字节不改。两处共用一条规则 `ui/src/mention-tokens.ts`（转写 dsh `ui-primitives` 的 `projectUserText`）——**消息气泡**是 `UserMessageRow` 的元素树，**输入框**没有 contenteditable（dsh 的编辑器是 Lexical），所以用**镜像层**：同字体、同内边距、同换行规则的一层画在 textarea 后面，textarea 自己的文字透明、只留光标（`.mirror` / `.mention`，见 `InputBar.module.css`；chip 的 padding 用等量负 margin 抵消，绝不允许装饰移动它装饰的字）。镜像与 textarea 的换行必须逐字一致，靠「同一份 CSS 值」保证，实测两者内容顶边同 y=340。**一处刻意的偏离**：dsh 的裸 token 是 `@[^\s]+` 再削尾部标点，而中文没有空格——`@a.ts，然后看` 会被整段吞进路径；这里让裸 token 在**中文标点处断词**（`@"…"` 内不受影响，需要中文标点的路径仍可加引号）。
  - **装了 PWA 也不会永远看旧界面**：安装后的窗口是「恢复页面」而不是重新导航，于是它一直跑着当初那个 bundle（用户的「打开的永远是旧界面」）。`ui/src/stale-build.ts` + `shell/stale-build-watch.ts` 在挂载时与每次页面重新可见时 `fetch('/', {cache:'no-store'})`，比对该文档指向的产物名与**自己正在跑的产物名**（`import.meta.url`），不同才刷新，且**每个产物只刷一次**（`sessionStorage` 记账）——否则一次拿不到新文档的 fetch 会让页面每次聚焦都重载。开发服务器直发模块、比不出名字时整条缝自动沉默。
- **引用本地文件（`@path`），不复制；粘贴图片例外，它必须上传**。两条规则是同一件事的两面，差别在于**字节到底住在哪里**：
  - **文件有路径**，模型用已有工具去读，所以附件是**指针**：一行卡片记住宿主报出的绝对路径，发送时把 `@path` 追加进草稿。**没有文件上传路由，没有上传目录。** 曾经的 `POST /api/upload` 把任意文件的字节流进 `~/.nova/cache/uploads/` 好让 `read_file` 够得着——而 `@path` 本来就是文件进提示词的通道，所以那份副本喂给模型的东西**从原路径一样读得到**，代价却是把用户的字节复制一份、且只增不减（实测 24MB 视频被白白复制）。
  - **粘贴的图片没有路径**：剪贴板只给字节（`File.path` 是 Electron 私有扩展），不落盘就**再也找不回来**。因此图片是**唯一**走字节的附件（`POST /api/image`）。`image/svg+xml` 刻意排除——文件类型表把它算作图片，但它不在请求路径接受的四种格式内。
  - **四条纪律**：①普通浏览器不给拖入/粘贴文件的真实路径，所以拿到真实路径的唯一途径是**宿主自己枚举**（`+` 菜单的「引用本地文件」）；②拖入/粘贴**仍然 `preventDefault`**（否则浏览器会导航到该文件、直接丢掉会话），非图片文件只回一句解释、**不静默复制**——静默正是当初被反对的行为；③目录行是「选择」不是「导航」（文件行点一下即采用，不进目录）；④路径是绝对路径，落在工作区外时走**正常审批门**，不再有 `trustedReadRoots` 豁免。
- **审批走事件，不走隐式等待**：`approval_request` 帧带完整请求，前端以 `resolve_approval` 回答（answer 就是内核的 `AskResult`，线上解析走 core 的 `parseAskResult` 单一解析器）；断连时挂起审批随内核 abort 收敛为 deny（fail-closed）。
- **认证只有一道**：启动打印一次性 `?t=<token>` 的 localhost URL，校验后落 **HMAC-SHA256 签名、host-only、HttpOnly、`SameSite=Strict`** cookie 并 302 到干净地址；HTTP 与 `/ws` 共用它（`timingSafeEqual` 比对），静态托管拒绝穿越。**唯一豁免**：`/manifest.webmanifest`、`/favicon.svg` 与 `/icons/*` 免认证——Chromium 的 PWA 安装管线在认证上下文之外取这些资产（可能不带 cookie），401 会静默杀死安装入口；它们是无机密的品牌资产，其余路径（含 `index.html`）一律 401。`web/src/index.ts` 强制回环绑定。**不引入任何第三方依赖**——RFC6455 服务端自写。**缓存策略按路径分**：`/assets/*` 是 Vite 内容哈希产物 → `max-age=31536000, immutable`；**其余（含 `index.html`）一律 `no-cache`**——缓存的文档指向上一次构建的资产 URL，重建后那个文件已不存在。
- **origin 持久化是 PWA 的前提，分两半各归其主**：**端口半**（`listen.ts`）——未显式指定端口时先试 `web-port.json` 记住的上次端口，占用即回落临时端口，绑定结果回写（损坏/越界读作「无偏好」，写失败只告警）；**配对半**（`auth-store.ts`）——`web-auth.json` 持久化 `cookieToken`+`secret`，cookie 落 `Max-Age=31536000`，于是**安装的 PWA 冷启动无需 URL 参数**；URL token 保持每进程随机（一次性配对性质不变），删掉 `web-auth.json` 即吊销全部已发 cookie。两半都是**尽力而为**：任何存储故障都不许挡住服务器启动。
- **前端分层与内核同构**：`state.ts` 是唯一 reducer（帧入、UI 块出，纯函数直测）；`state-events.ts` 归约事件；`card-view.ts` 是工具卡的**纯渲染模型**（六卡 × running/stale/ok/fail 四态，DOM-free 直测）；`chrome-view.ts` 是外壳视图模型；`flow.tsx` 是块 → 行的唯一映射；`format.ts` 是**主要格式化处**；`trace-view.ts` / `diff-lines.ts` / `session-groups.ts` / `context/context-model.ts` 同为纯函数。React 组件只做投影。markdown 走**元素树渲染**，全程无 `innerHTML` / `dangerouslySetInnerHTML`——XSS 靠构造不可能，而非转义正确。右栏（`rightbar/`：**标签条 + 开始页**，页面词汇表是变更 / 文件 / 任务 / 终端（+ **任意文件的只读标签页**），dsh `ui-sidebar-right` 与 dsh-better-sidebar 移植；2026-10-02 整体重写、2026-10-03 第三轮：**工具详情列整体删除**、文件页 → 纯树页 + 只读文件 tab、任务页 / 终端 / 变更页 diff 对齐 dsh 参照）是右列的第二居住者：头部角落座位开栏，**点开的工具不再有第二面板**（工具行的行内展开是唯一读法，`ToolPanel` 与 `openCallId` 全链删除）；它的树 / 只读查看器 / 变更 / shell 状态全是纯模型（`change-tree` / `git-diff-rows` / `diff-view` / `tasks-model` / `editor-model` / `terminal-model` / `tree-selection` / `git-marks`），帧协议用 `list_directory` / `read_entry` / `git_*` / `term_*`，变更页的「本会话」透镜是 `changesModel(blocks)` 的纯推导。**右列是真三分轨**：面板打开时**必占自己的网格轨道**、中间列让位（参照件 `ui-layout` 的 `track = shown && !autoFullscreen`），规则收在 `layout-store.ts` 的 `openRightbar`（没有 `track` 参数可传错：shown ⇒ 必占轨）——从 WebUI 首版起 `track` 恒上报 `false`，面板以 `position:absolute` 悬在会话之上（用户报告的「为什么是悬浮的」），2026-10-01 修正；窄到轨道放不下时由 `computeColumns` 解出 0 轨、面板转 `takeover` 占满。**停靠列不画投影**（参照件的 `--dsw-shadow-lv3` 只给浮动窗口，`style-guard.test.ts` 护栏钉住），投影正是「看着像悬浮卡片」的最后一个来源。**真实侧边栏（2026-10-01 融入主程序；2026-10-02 整体重写；2026-10-03 第三轮）**：①**标签条 + 开始页**（`RightbarStrip.tsx` 自带一张表，`StartView.tsx` 是空标签时的正文）——strip 画的是**已经打开的页面**：一页一枚标签（图标 + 标题 + ×，上限 160px 走省略号、右邻 hairline、活动标签用**填充色**而不是下划线），右侧粘一枚 `+` 菜单（只列**未打开**的页），最右是面板自己的全屏/关闭两钮——**标签条就是面板的上边缘**，不另画标题行。`rightbar/tabs.ts` 仍是页面词汇表的唯一定义处（变更 / 文件 / 任务 / 终端，顺序与 dsh `guide` 一致），但它定义的是**可开的页**，不是**在开的标签**（`RightbarTabId` / `readTabPreference` 未变）。关掉一枚标签即回落**开始页**：56px 罗盘水印 + 四张 380px 入口胶囊（26px 图标盒 / 14px 标题 / 11px 说明），几何逐条照抄参照 `ui-sidebar-right/tabs/guide/GuideBody`（含 `::after` 的 10% 上移、`--dsw-static-neutral-200/700` 的水墨档）——「清空面板」因此不需要关掉这一列。状态面在 `App.tsx`：`rightbarTabs`（已开集合，初值 = 记住的那一页）+ `rightbarTab`（在前的一枚，`null` = 开始页），`openRightbarTab` 一个入口保证「已开则置前、未开则加入并记住」。**文件页是纯树页，文件是只读标签页**（2026-10-03 第三轮）：点树里的文件开一枚**以路径为身份的只读 tab**（`FileTabView`：语法高亮 + 行号 + 换行开关 + 复制 + 重新读取；`.md` 走聊天同一条元素树 markdown 渲染器；超 `MAX_EDITOR_BYTES = 192 KiB` 给截断说明），重复点同一文件是**幂等 reveal**（已开即置前，不重发 `read_entry`）。**编辑能力整体删除**——textarea / Ctrl+S / dirty 概念连同 `write_entry` 帧与 `entry_saved` 一起删（树操作 `rename` / `remove` / `new` 保留；参照件的 documentpreview 本就是查看器）。「找文件」与「读文件」不再分居两个页签，树不再有页内停靠/拖宽。②**内核侧**——core 的 `file-io.ts`（绝对路径规范化、realpath 后越界检查、原子写 tmp+rename、符号链接跟穿拦截）、`git.ts`（仓库探测 / porcelain -z 含 R/C 重命名 / 分支探测 / stage / unstage / commit / log——「操作一个仓库」）与 `git-clone.ts`（`gitClone` / `repoNameOf`——「弄来一个仓库」，clone 的 URL 与派生目录名风险独立成模块，git runner 是两模块共享的一份实现），`plugins/src/builtin/fs.ts` 从 core 引入（一份实现）。③**wire 协议**——客户端帧 12 条（`read_entry` / `rename_entry` / `remove_entry` / `new_entry` / `open_entry` / `git_status` / `git_diff` / `git_stage` / `git_unstage` / `git_commit` / `git_log` / `list_jobs`；`write_entry` 随只读化删除）+ 终端 4 条（`term_open` / `term_input` / `term_resize` / `term_kill`）+ **`git_clone`（2026-10-02）**——上限 `MAX_EDITOR_BYTES = 192 KiB`（线上预算而非磁盘上限）/ `MAX_GIT_PATHS = 200` / `MAX_COMMIT_MESSAGE_CHARS = 2000` / `MAX_GIT_LOG = 100` / `MAX_GIT_CLONE_URL_CHARS = 2048` / `MAX_TERM_INPUT_CHARS = 16384`（键入/粘贴的控制字符是内容，只限长）/ `MAX_TERM_COLS = 500` / `MAX_TERM_ROWS = 500`。④**服务端**——`entry-frames.ts` / `git-frames.ts` / `job-frames.ts` / `term-frames.ts` 各收一类帧，**答复即状态**（写动作用一条 `git_status` 或 `entry_changed` 作答，不存在 notice 帧），删除/重命名把打开在编辑器里的同路径文档一起关掉；`list_jobs` 直接读 `host.jobs.list(sessionId)`（行里只带状态/进度，不带输出——第二个消费者会和模型的 `jobs` 工具竞争）；**`git_clone` 不进 `git-frames.ts` 而走 session-target 族**（`session-frames.ts`，与 `set_workspace` / `delete_session` 同族）：它改变「打开的是什么」，所以答复是重述的 `ready`（克隆进**当前工作区的父目录**成为兄弟目录，`setWorkspace` + 广播基线一条龙，失败走普通 error 帧、工作区原地不动），不是一条新帧；`git_status` 走 `GitStatusCache`（**TTL 2s + 单飞去重 + 变更即失效**）——「正在读取 git 状态…」的卡顿来自每次开页冷启一次 git，缓存让开页、翻页、暂存后的复查共用同一次读取，而写动作自己调 `invalidate`，所以「刚暂存完还看旧状态」不会发生。⑤**终端是真 PTY（2026-10-02 重做，用户裁定「造假的」不可接受）**（`term-session.ts` + `term-frames.ts` + node-pty）：每会话**一个真伪终端**——宿主经 node-pty（**惰性 import**，原生插件缺席时按 `unavailable` 答复而不崩服务器）spawn `sessionEnv().shell` 的**交互 shell**（与模型命令同一解析，Windows 带 `.exe`——ConPTY 不解析裸名），stdin 是真键盘、stdout 是真 ANSI 字节流，**vim / top / Ctrl-C 全部真实工作**；`cd` 与 job 因为进程常驻而保留。**宿主不解析终端序列**：输出按 chunk 原样广播（`term` 帧 `data` 字段，仅在字节间拆散了 UTF-8 代理对时由 `holdSplitSurrogate` 收尾），浏览器侧 xterm.js（`@xterm/xterm` + addon-fit，**动态 import** 进懒加载 chunk——SSR 测试车道零 DOM 不受累）负责画。**协议只有四个客户端帧**：`term_open {cols, rows}`（确保 pty 并**以应答重放保留的 scrollback `reset:true`**——重挂/重载整屏重建）、`term_input {data}`（按键/粘贴原样，控制字符是内容）、`term_resize`（SIGWINCH）、`term_kill`（杀树并广播 reset）。**退出的 pty 绝不静默替换**——它的 scrollback 是「为什么死」的最后读数，重启是显式的 kill+open（状态条的「重开终端」）。**开始页的终端入口卡带 shell 下拉**（打开菜单才发 `discover_shells`）——win32 的探测除 PATH 外补 **MSI 标准安装位**（`%ProgramFiles%\PowerShell\<ver>\pwsh.exe`、`%LocalAppData%\Microsoft\WindowsApps\pwsh.exe`；「pwsh 不在列」的根因就是 MSI 不加 PATH），选中 = 记偏好 + 重开终端；**页脚是状态条**（连接中 / 运行中 / 已退出(码) / 失败 / 不可用 + 主按钮重开 / 重试，没有 `<select>`）；xterm 逐值对齐参照（`minimumContrastRatio 4.5` / `cursorBlink` / `fontSize 13` / 同款字体栈，调色板随页面主题的 computed style 同步——主题属性一变即跟随）。面板的 `terminal-model.ts` 是纯折（bytes 进 `feed` 槽按 `seq` 递增、status/exitCode/error 三读数），**不再渲染文本**——模拟器才是屏。⑥**两条归约纪律**（都是真机报障的根因，各有 killing test）：**答案不能开对话框**——文件页自己问的 `list_directory` 答案曾被工作区选择器当成自己的答案，于是每次打开面板都弹出「选择工作区文件夹」；现在 `directory` 槽位只在**手势**（`directory_open`）之后存在（`state.directory === null ? null : …`），答案只填树。**请求出发处拥有「打开」**——`read_entry` 一发出，`sent` 归约就把文档放进编辑器（`loading`），`entry` / `entry_error` 只结算**已经存在**的文档；此前 `editor_open` 动作全仓没有派发者，点树里的文件只发帧、预览永远空着（用户报的「文件预览要点开才有」其实一次也没开成）。**「界面比宿主新」要说出操作**——宿主对不认识的帧回 `unknown frame type: X`（`client-frame.ts` 的解析拒绝），而 server.ts 每请求重读静态产物，旧进程会一直服务新 bundle；state.ts 的 error case 经 `host-messages.ts` 的 `hostErrorText` 把这句话转写成「请重启 nova 进程」，其余错误保持宿主原话（用户报障的原话就是裸帧名，谁也不知道该重启）。⑦**前端**——`rightbar/kit.tsx` 原语（28px IconButton / 22px chip / 28px 段头 / 文本 Notice / StateDot 环）之上，一页一文件：`FilesView`（**纯树页**：过滤框 + 树工具，树行悬停给 `@` / 复制路径）+ `FileTabView`（只读查看器，见 ①）、`ChangesView`（未暂存/已暂存双树 + diff 面板 + 提交条 + 最近提交 + 「本会话」透镜；**工作区没有 git 时是 `GitSetup` 空态卡**——参照件源代码管理的「源代码管理 + 说明 + 打开文件夹 / 克隆仓库」，打开文件夹复用 hero 的原生对话框选择器（`onOpenWorkspace` → `pickNative('directory')`），克隆仓库展开 URL 表单发 `git_clone`，按钮的进行中态挂在 `clonePending`（随请求置位、由 ready 或 error 结算——克隆的成功答复就是新基线））；**diff 面板对齐参照**（2026-10-02 第三轮，操作者点文件后报「达不到预期」）：未跟踪文件不再是一句「用文件页打开它看内容」——宿主在 `git_diff` 里换成**全文件「全部新增」diff**（core `gitUntrackedDiff`：有界读 1 MiB + 二进制探测，二进制/超限答空文本、面板才显示说明），diff 行经 `diff-highlight.ts` 语法高亮（**复用**聊天代码块的扫描器 `chat/markdown/highlight.ts`——整文件内容一次扫描再 zip 回行，块注释跨行状态不断；未知语言照旧纯文本），行悬停多一个**「打开文件标签页」**动词（→ 发 `read_entry` + 开/置前该文件的只读 tab，打开仍由请求出发处拥有）。**diff 工具行（2026-10-03 第三轮，对齐参照 `ReviewTab`/`FileDiff`）**：38px 头带 = 文件选择菜单（改动文件列表，选中即换 diff）+ `+N −N` 计数 + **统一/并排切换**（`[aria-pressed]`，图标随之转向）+ **换行切换**（标签名说动作：自动换行 / 不换行）+ 打开文件标签页；几何逐值移植（22px 行高、统一视图 grid `3.5em 3.5em 1.2em 1fr`、gutter 填充 + `inset 3px` 色标、**文字保持阅读墨色**——参照只给 gutter 上色），并排视图是 `splitRows` 纯函数（删除段与随后新增段配对、短边留空、上下文两侧同文），偏好落 localStorage（`nova.diff.layout.v1` / `nova.diff.wrap.v1`），行帽回到参照值 `MAX_RENDERED_LINES = 5000`。`TasksView`（2026-10-03 对齐 `ui-jobs`）：行 = **StateDot**（running→ongoing 环 / completed→done / killed→warning / failed→error；唯一实现 `tool/StateDot.tsx`，本页曾自带第二份已删）+ kind + 标签 + `detail ?? 状态词` + 时长（最多两级单位），**结算行按 `finishedAt` 倒序**（`JobSnapshot.finishedAt` 为此在 core 新增、wire 透传；live 行按开始正序、时长随 1s 钟走），live 行是填充卡片且带**两段式停止**（arm 3s 自动解除、`data-kill-state`、pending 期按键惰性），chevron 展开元数据面板（进度 / 开始 / 结束 / 任务 ID）；**被杀的任务不写 detail**——退出码被刻意置空，写出来只会是「exit code: null」，行回落本地化的「已取消」。`TerminalView`（xterm.js 模拟器 + 状态条）。旧树整体删除：`FilesWindow` / `FilesPanel` / `TreePanel` / `TreeMenu` / `ChangesPanel` / `GitLens` / `EditorPanel` / `TerminalPanel` / `TasksPanel` / `terminal-model`（**旧的同名文本渲染模型**——真 PTY 重做后的同名文件是纯字节折模型，见 ⑤，两者不是一回事） / `tree-menu-model` / `tree-rows` / `session-files` / `web/src/terminal-frames.ts`。记名偏离：**docking kit 只搬了外观、没搬机器**（标签条是固定顺序的单行 strip：无拖拽换序、无中键关闭、无右键菜单、无分裂/浮动多 pane——参照件那套对接机器服务于十几页可插拔 tab 类型，本仓四个固定页撑不起它）、**开始页胶囊不挂快捷键 chip**（参照每枚胶囊右侧画 `ShortcutKeys`：Ctrl+P / Ctrl+\` / Ctrl+T；本 surface 没有全局快捷键系统，宁可不画也不画一枚按了没反应的药丸）、无 diff 面板拖拽手柄、无每类活动图标（组头只有 chevron + 标题）、任务页不给输出窗（要看得用模型的 `jobs` 工具）、每会话单一终端（参照件多标签；dsh 宿主侧 headless 屏幕恢复未移植）、无 shimmer 最短展示时长；**diff 并排用单个滚动容器**（参照同步滚动两个独立列——单容器让配对永不漂移、机器更少）、**变更页文件选择菜单只带路径不带每文件计数**（参照的菜单行带 `+N −N`）、**diff/换行偏好落 localStorage**（nova 无 per-tab store）、**文件 tab 只读**（编辑能力删除，见 ①）。
- **视觉系统 = deepseek-harness 移植（MIT，样式文件逐份署名）**：三层 token（`--dsw-static-*` → `--dsw-alias-*` → 组件局部 `--dsh-*`），明暗双档同一级联（`body[data-ds-dark-theme]`，`index.html` 内联脚本首帧前解析，暗为默认）；三栏 AppFrame（280px 默认、264–420 可拖、<1024px 收为图标轨道）；转录由 `.root` + `.scroll` + `.column` 三层展开，`.scroll` 撑满剩余高度保证 composer 座**恒贴底**。图标全部手写内联 SVG（设计盒写进元素本身的 `width`/`height` 属性——只有 `viewBox` 的 SVG **没有内在尺寸**，在 flex 行里对父级宽度贡献为零）。护栏 `ui/test/style-guard.test.ts`：**零字面色（含注释）、零 ANSI、每个内联 `<svg>` 都声明设计盒、每个 CSS 类都有消费者**。**动效词汇同源**（`base.css` 的 `--ds-transition-duration: 0.2s` + `--ds-ease-in-out`）：可点面 hover 一律走这组 token 的四属性过渡（color/background-color/border-color/opacity/box-shadow，按需取用），浮层入场走 dockkit 的 `140ms ease-out` 缩放渐入——没有过渡的可点面是本仓的缺口（28 张样式表曾整体如此），新增可点样式**必须带上过渡**；全部动效包 `prefers-reduced-motion` 静默档。
  > **CSS 变量的类型要当心**：`--dsw-font-xxs-12` 是 `font` **简写**（`12px/18px …`），写成 `font-size: var(--dsw-font-xxs-12)` 是**无效声明、被静默丢弃**（实测两个子代理摘要类因此一直继承 13px 而非参考的 10px）。用 `font:`，或直接用 `font-size` 的字面值。

### 模型端（三种权威，一条优先级）

- **id 由端点拥有**：`ChatProvider.listModels()` → `GET /models`。**大小写敏感是单个站点的命名怪癖**（`deepseek-v4-flash` → 503 而 `DeepSeek-V4-Flash` → 200），所以请求用的名字必须**按当前端点的名单对账**，绝不靠改配置去凑：`core/model-id.ts` 的 `resolveModelId(configured, available)` 三趟匹配（精确 → 唯一大小写无关 → 唯一标点无关，歧义则保留原样），`sameModelId` 是同一规则的判等。**绝不把某个站点的拼写硬编码进代码或配置。**
- **能力有三级优先级**（`core/model-catalog-rules.ts`）：配置 `models[].<field>` → models.dev → 未知（**未知是合法答案**，占用环不画百分比而不是猜一个窗口）。合并是**逐字段**的（`??` 而非 `||`，所以显式 `false` / `0` 存活），且是**覆盖而非重述**：只写 `id` 的条目照样从 models.dev 拿到窗口与模态。
- **配置 `models[]` 非空即「全量接管」菜单**（`catalogIds`）：站点没公布的 id 也能选，被移除的不会再出现；**在役模型永远在列**（菜单得答得出「我在跟谁说话」）。读**活取**而非捕获数组，否则设置页保存后菜单要到重启才变。设置页编辑能力时同时显示「当前生效」与「自动值（占位）」，两者的差就是操作者在偏离什么。
- `set_model` 走 `ChatProvider.setModel()`，**原地改写同一客户端**（不重建 provider——会话句柄、子代理工具、缓存亲和绑定都还指着这个实例）→ 会话发 `model` 事件 → 控制器把它变成给所有客户端的 `state` 帧：**座位跟着事件走，不跟点击的乐观值走**。失败是**答案**（空列表 + 重试）而不是断线；窗口未知时**清空分母**而不是沿用上一个模型的数字。

### 观测面自己算不出来就去内核要

轮次 header 与底部统计条全部来自内核的 `run_stats`（`RunMeter` 在 `consume()` 里量），**表面一个数都不测**。**轮 header 就是参考实现的那一行**（dsh `TurnProcessNodeView`：满宽按钮 + `[label][chevron]`）——它**不承载任何读数**（dsh 样式表里根本没有 detail 类）：时钟 / TTFT / TPS / 工具时间住在**统计 pill 的弹窗**与**轨迹表**里，印在 header 下面既重复了 label 自己的「用时」，又把数字塞进参考实现空着的位置（本仓曾如此，已删）。过程组是 dsh `ChatGroupSeat` 的 body：`min(400px, 50vh)` 上限、组内自滚（`overscroll-behavior-y` 阻断链式滚动、`scrollbar-gutter: stable`），并在**还能继续滚的那一端**盖 24px 渐变遮罩——上限不让四十步的回合把答案顶出屏幕，遮罩让「被裁掉」与「到头了」可区分；**运行中的回合不设限**。推理行读 stepProcess 语义词汇（流式「正在分析请求」+ 思考实时尾行，落定「已完成分析」）。答案尾行带**用量 pill 与消息时钟**——同一份 `RunStats` 走两个出口：header 管时长、统计 pill 管 token，**读数不重复出现在第三处**。统计条读数取 dsh `stats.counts` 模板（`N 轮 N 步 · X tok/s`），用量段有计费输入即报「缓存命中 N%」；上下文占用环与统计 pill 同排挂 composer dock 行（hero 阶段无读数不渲染）。**占用环的分母来自内核**：`AgentSession.lastPromptTokens` 在进程内跑过时读内存锚点，否则从日志投影取**最后一条 assistant 消息自己的 `usage.promptTokens`**——这里曾读 `ready` 里的 `run/stats.promptTokens`，而那是**一轮内所有请求的求和**（`RunMeter` 刻意累加），不是「窗口现在多满」：实测一轮两请求报 25,268 而真实最后一次是 12,920（**+96%**）。工具行是按钮，点开右侧详情侧板看完整参数/结果原文/时间；后台 job 是转录里的**一行一处、原地改写**的活动行；状态点（solid 10px `::after` 芯 / ongoing 14px 旋转环）是 dsh `StateDot` 的移植，运行中的环由 `animation.startTime = 0` 相位锁定。

**量测是持久的，不是进程内的**：同一份 `RunStats` 以 **log-only `run/stats` 事件**追加进会话日志（`afterMessageId` 锚定它收尾的那条消息）——否则续接/重载的会话会丢掉每一轮的轮 header 与统计条。回放时 `transcript.ts` 用 `anchoredRunStats` 把锚点还原成 `meta` 块（同一锚点后者胜），折叠值随 `ready.runTotals` 下发（内核、服务端与前端共用 `web/totals.ts`）。**时长只有一个主人**：轮 header 拥有它；尾行的时钟是消息落地的墙钟戳，不是第二轮计时。

> **`run_stats` 的时序契约**：它在 `done`（或 `run_failed`）**之前**发出——终结符是消费者等的最后一帧，统计跟在它后面就一定会被只等终结符的消费者漏掉；**落盘先于广播**，所以「崩在这一帧之后」不会留下一轮没有量测的运行。

> **统计条不因缺 `usage` 而整行消失**（本仓曾如此）：轮/步计数由 `run_stats` 独立供给，量测项各自决定在不在。缺 `usage` 时该缺席的是**缓存命中那一段**，不是整行——让一个可选字段决定必需信息的存亡，等于丢掉本来拿得到的事实。

**「工作步骤展示」是设置项，不是固定设计**（dsh `presentation-policy.ts` 的移植）：设置 → 通用里的四档（简洁 / 标准 / 详细 / 完全展开）各对应一条 `ChatPresentationPolicy`（`chat/transcript-view.ts` 是**唯一**的 policy 表，`flow.tsx` 只读它），落在 localStorage（未知值回落标准）。四档的差异只有四个开关：`foldCompletedTurns`（已完成回合是否折进 header）、`stepGrouping`（`collapsed`=所有回合都带组框 / `history`=只有已完成的带、运行中的平铺 / `none`=从不成组）、`liveProcessDetail`（运行中标题是否带任务细节）、`settledReasoningPreview`（已落定思考行是否留一行预览；**流式尾行不受此门控**——它是正在被看的进度，不是摘要）。组框的闭标题由 `chat/process-summary.ts` 从回合成语料**纯推导**：按类别计数降序排名（Map 保首次出现序）取前三，一个直呼其名、两个用「并」连接（**两个都以「已」开头才削第二个的前缀**）、三个及以上用逗号连接、**超过三个类别才补「等」**；空活动读「已完成分析」。运行中的标题读 `RUNNING_LABEL` 加当前调用的任务细节（`DETAIL_KEYS` 优先级取第一个有值键、160 码点截断、畸形参数回落工具名）。`flow.tsx` 经 `chat/process-span.ts` 投影（**工具块的结果未落地即在途**——reducer 的工具块没有 `running` 标志）。**记名偏离**：组头不带每类活动图标（参照的 `ChatGroupSeat` 有）；无参照的 shimmer 最短展示时长守卫；该偏好落 localStorage 而非宿主设置文档——它是**界面观感**而不是插件设置，插件设置走行自己的 `config` 与自己的设置页（见 §5 插件设置页）。

### 上下文洞察（`context` 插件 + 上下文视图）

会话窗口的读法：**现在装了什么、怎么长起来的、为什么变了、它对文件做了什么**。四问一次日志走查回答，落在一个 `advanced` 档插件（`plugins/src/context/`）提供的 **`contextInsights` 能力服务**上，由中心列的 **上下文** 视图消费。

- **插件只提供能力，渲染归界面；它的在场就是开关**。`context` 是第一个**没有工具、没有命令、没有钩子**的内置插件——它 `ctx.provide(contextInsightsKey, …)` 一个折叠器。消费方（`web/src/context-follow.ts`）读不到这个键就**什么都不做**，帧里是 `null`，界面上没有那个 tab。所以「设置里那一行的开关」与「数据在不在」不可能各说各话：**没有第二个标志位**。它归 `advanced`（`subagent`/`ptc`/`qqbot` 同档）的理由与它们一致：回答这四问要**走一遍整个会话日志**，新装的机器不该为此付费。
- **折叠器是有状态的、原地累加的**：`fold(events, surface)` 开一个游标，`apply(event)` 一次一步。会话是 append-only 的流，若每来一个事件就返回一份新对象，每个工具结果都要复制整张元素表而没有任何读者受益。`view()` 才产出可序列化的读数。
- **元素列表 + 点列表**（移植自 dsh-context 的 timeline fold，MIT）：**元素**是窗口里的一个计价单位（一条工具 schema、一节注入片段、一条消息），带**入场的日志位置** `seq`；**点**是**一次已完成的模型请求**，其组成 = 入场早于它的元素中尚未被压缩移走的那些。于是一张元素表解释了每一次历史请求，**线宽与会话成正比而不是与请求数成正比**。
- **请求的组成算在点之前**：一条 assistant 消息**不是**它自己那次请求的一部分。`syncSurface` 把系统提示与工具 schema 盖在 `seq - 1` 上，正是为了让「`element.seq < point.seq`」这**一条规则**足够——不需要为 schema 开例外。
- **压缩后窗口真的会缩小**：`compaction/summary` 用的是 core 自己的 `compactionSurface`——**与活路径和回放投影同一个函数**，所以面板读的折叠与转录读的日志不可能对「留下了什么」有分歧；被移走的元素打上 `gone = seq`（仍留在列表里，因为**过去的请求仍要用它解释**），净回收量取日志的 `shadowedTokenCount`。
- **估算是估算，账单是账单**：分类用 core 的 `estimateTextTokens` / `estimateMessageTokens`（**与自动压缩门同一个估算器**，两处不可能对「一条消息多贵」有分歧）；每次请求的 `prompt` / `cached` / `output` 直接来自 provider 的 `usage`，原样并列。**占用环的分母只有一个来源**：`ready` 携带的 `contextWindow`（`state.contextWindow`），与 composer 的环同源——折叠器**不**自己存窗口，否则同一个数字会有第二个会过期的读法。
- **文件活动只记真的发生过的**：工具调用先入 `pending`，**结果落地且没报错**才记账（被拒绝或失败的写入没有碰文件，给它一行就是这张卡唯一能撒的谎）；行数增删从 `edit_file` / `write_file` 的**参数**读出；`run_code` 内部的派发日志里只有预览串，够不着结构化路径，**宁可不记也不编**。
- **帧的纪律**：读数随 `ready` 基线首绘（不额外等一次往返），`context` 客户端帧按需刷新（打开 tab / 视图重挂），并在**每次 `run_stats`**（一次请求的结束就是一轮的结束）与**每次 roster 翻转**后推送。**`null` 是一个真实值**：插件被关掉时推的就是它，面板据此清空并撤掉 tab——`ready` 上则表现为**缺字段**，两种拼法各表一意。翻转的检测放在 `handle()` 的帧处理之后（一次 map 查找）：**「哪一帧翻转了它」正是会腐烂的知识**。
- **前端按问题分文件**：`web/ui/src/context/` 下 `context-model.ts`（类别词汇表 + 构成条/占用率/统计格）、`trend-model.ts`（趋势柱/堆叠/轴刻度）、`element-model.ts`（窗口元素分组）、`file-model.ts`（文件行徽章）四份纯模型（无 React、无 DOM），卡片组件一卡一文件（`TrendCard` / `ElementCard` / `FileCard` / `EventsCard` / `TimingCard` / `DashboardCard` / `DnaCard`；`ContextCards.tsx` 只剩统计条与当前上下文；`HeatmapCard` 与 `BrowserCard` 已按操作者裁定删除，见 `docs/dsh-parity-inventory.md` 第 17 轮），`ContextView.tsx` 只剩「怎么装这个面板」。**上下文事件卡**曾在第 9 轮按操作者裁定删除（理由：面板只答两问），**第 14 轮接回**（2026-10-01）：读数一直在 `ContextTimeline.events` 与 fold 里，把「为什么变了」当第三问接回是面板姿态的修正，不是数据面扩张；同轮还加了**趋势明细的 Δ 与缓存命中行**（`TrendDetail.tsx`：悬停/钉住非最新请求时每类别行追加带符号 Δ 药丸；底部给 `cached/prompt` 命中率）与**热力图**（`HeatmapCard.tsx`：最近 8 周请求/token/输出三档日格，**单会话**口径——跨会话归并归仪表盘，未做；该卡后于第 17 轮按操作者裁定删除）。分类色取自 token 层的静态色阶（`--dsw-static-*`，本次为 indigo/purple/teal 三族补了声明），**不允许拼字符串造 token 名**——护栏只跟得上它读得懂的名字。几何取值（16px 分段条、130px 画布/18px 头、14px 柱宽、5 档轴刻度）对齐第三方 dsh 插件 `dsh-context`（Apache-2.0），取舍与未移植项记在 `docs/dsh-parity-inventory.md` 第 9–14 轮。**趋势图全面对齐 dsh 插件**（2026-10-01，第 13 轮三次裁定后的终态）：Y 轴按**最高一次请求**缩放（参照 `maxTotal`）而不是模型窗口（1,050,000 的窗口曾把约 22K 的会话压成贴地线）；柱子固定 14px、2px 节奏、**左堆叠**（密了横向滚动，稀疏时的右侧留白是参照件本身的行为）；悬停气泡按**索引解析定位**（`syncTip`：`left: 0` + 每次提交/滚动重写 transform，随滚动黏住柱子）；明细是**参照的分类行**（色点 + 5px 轨道 + `≈N` + 占比，第 14 轮追加 Δ 药丸与缓存命中行）；**自适应开关**（参照 `.lc-gran` chip，默认关）按可视柱峰值重算轴。面板根 13px 基级（参照 `.lc-root`）。未跟项（轮次条、步旗、总量/变化）记在 inventory。**请求 DNA 卡（`DnaCard.tsx`，第 15 轮 2026-10-01）**：DNA 是 dsh-context 的「这次请求的组成占比」读法（堆叠条 + 类别条）。它按 `ContextPoint.seq` 拉回该次请求窗口的元素快照（同源的浏览器卡 `BrowserCard.tsx` 后于第 17 轮按操作者裁定删除；协议前置由 DNA 继续消费，故保留）。**快照契约只有一份**（`core/src/context-insights.ts` 的 `ContextWindowSnapshot`），`plugin-context` 的 `ContextReading.windowAt(seq)` 是唯一实现——规则与 `compositionBefore(seq)` 逐字相同（`element.seq >= seq` 截断、被压缩移走的元素按 `gone <= seq` 跳过），`plugin-context/src/index.ts` 再导出 `windowAtSeq(events, seq, surface?)`。**`web` 因此进 `plugin-context` 的依赖白名单**（`scripts/dep-direction.mjs`）——`web/src/context-window.ts` 的 `GET /api/context-window?session=<id>&seq=<n>` 在认证门后静态 import 它跑一次 fold，会话 id 经 `sessionLogPath` 校验、`seq` 解析为非负整数。DNA 卡只读 `point.cats` 不需要宿主——条本身不依赖 `sessionFile` 也照画（点开拉快照时才需要它）。**动效是移植的词汇，不是各卡自编**：入场横扫（`lc-stacked-in`/`lc-bar-in`，`--lc-i` 槽位 × 40ms/15ms 逐列延迟，**封顶 20**——长日志也要在一秒左右落定，`staggerStyle` 是唯一的槽位计算处）、悬停联动（本段提亮 `brightness(1.18)`、邻段压暗 `opacity` 成对出现）、气泡 `tip-in` 渐入；全部包 `prefers-reduced-motion` 静默档。**tooltip 两套词汇不可混用**：外壳 chrome 提示（`--dsw-alias-tooltip-bg`）**恒暗**；**面板内数据气泡跟随主题**（`bg-layer-2` 底 + `label-primary` 字，dsh-context `.lc-tip` 的做法）——本仓曾把恒暗底配主题字，亮色下黑底黑字（用户报告的「悬浮弹窗黑的看不清字」）。**滚动归共享 rollport**：上下文 / 轨迹两面板**不自开滚动条**——面板跟着内容长高，内层 `overflow:auto` 没有范围，而 `overscroll-behavior: contain` **不把带不动的滚动链给父级**，滚轮会被就地吞掉（实测：修复前滚不动、注回旧 CSS 又滚不动）；`scrollportOf()` 是找共享端口的**唯一实现**，上下文面板挂载时把端口回锚到自己的顶部（转录离开时它停在转录底部）。卡住的文件列表（`max-height: 320px`）也**不写 `overscroll-behavior`**：到底后滚轮照常链给外层的共享端口。**窗口元素一类别一张卡**（可折叠；卡头给项数/token/占比，卡内按占用降序）——平铺表会被十几个 ~1% 的工具 schema 淹没。**请求时序卡（`TimingCard.tsx`）**：每完成请求一行，给 TTFT（首 token 时长）与总用时两列、底部平均条；数据面只有一个来源——内核 `RunMeter` 把每请求的 `startedAt`/`firstTokenAt`/`finishedAt` 落进 `RunStats.requestTimings`，`run/stats` 事件持久化它，fold 用 `afterMessageId` 锚点把时序合并到对应 `ContextPoint.timing`（一次 run 的请求按后缀匹配分到锚点之前的连续点），面板与轮 header 因此不可能对「这一请求多久」有分歧。**无时序即不渲染**（旧日志 / 未完成请求），不画一张「无数据」空卡。**跨会话活动卡（`DashboardCard.tsx`）**：唯一一张读 corpus 而非当前会话的卡——14 天活动 sparkline + 工作区 top-5 排行 + 底部 tokens 合计。数据面只有一个来源：`core/session-aggregate.ts` 的 `aggregateSessions(root)` 一次走遍 `~/.nova/sessions`（沿用 `listSessionFiles` 的 2000 文件上限），逐文件流式读 `run/stats` 折成按日与按工作区桶（`workspace` 标记最新者胜，缺则记 `__none__`）；`GET /api/dashboard` 在认证门后、静态服务前把结果返回，前端**挂载时自取**（corpus 读数与打开的会话无关，不该每次 `ready` 重算）。**加载中 / 失败 / 空语料时不渲染**——新装机器零日志不会冒空卡。

### 上下文与缓存命中率（核心差异化）

目标：**稳定前缀 = 高缓存命中**。四层机制：

1. **前缀冻结**：系统提示字节稳定；环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改。环境信息切「静态/动态」两节。注入片段带**权威指令帧**（`<user_instructions>` / `<project_docs>` 标注为「操作者写入的活跃指令，按字面执行」），同时**保留数据/指令二分**——从文件读到的文本仍是不信数据，防恶意仓库内嵌指令劫持。**项目文档预算以 token 计，不以字节计**（`projectDocMaxTokens`）：估算器对中日韩字符约 1 token/字、其余约 1 token/4 字，按字节设限会让**同一份中文文档被静默按数倍计价**。截断点由同一估算器二分求得。
2. **追加式日志**：对话严格 append-only；工具结果超 **40KB** 时全文落盘 `~/.nova/cache/tool-outputs/<sessionId>/`，消息体保留头部 **60%** + 尾部 **40%**（尾部常带失败详情，提示行预留 200 字节，head+tail+提示恒守预算）；落盘用 `flag:'wx'`（不覆盖、不跟随植入的符号链接）、**永不落进工作区**。**请求级中间压缩**：`assembleRequest` 在 hook 链之后、ephemeral 尾之前做纯函数修剪（`request-trim.ts`，**先 snip 后 micro**）——snip 按**原子工具组**裁中段（保头 3 组），micro 把「最近 3 工具组之前」的旧结果正文换占位符（调用名/参数/id/配对全保留、可重跑取回）；修剪只产出新数组、**永不原位 splice 活日志**，也不进 `deriveMessages` 投影。
3. **compact**：`/compact` 与自动阈值（`autoCompactTokenLimit`，以最近一次 usage 为锚点在发请求**前**预判）共用同一实现；压缩**原位追加** `compaction/start → summary → end` 三事件，模型可见面由 `deriveMessages()` 重建，**原始历史永不改写**；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）。**压缩保真**：摘要提示词是 codex 式**七节**结构（Task / Progress / Decisions / Current state / Issues / Next steps / References）、**无字数上限**；摘要输入的工具结果按 4000 字符/条截断；保留预算 32000 字符。**全文存档**：压缩前的完整 transcript 落 `pre-compact-*.txt`（trusted read root 内，`read_file` 免审批），摘要尾部附 `<archive>` 指针。**token 预估计入 assistant 的 tool call 参数**（`rawArgs`），`estimateMessageTokens` 带 `WeakMap` 记忆化。headless（exec）的轮内预检逐请求全量估算，并带**熔断**：一次压缩后仍超阈值即停用本任务后续自动压缩并告警一次。
4. **供应商对齐**：请求携带 `prompt_cache_key` 与 `x-session-id` / `x-session-affinity` 亲和头，让网关把同一会话固定路由到同一缓存节点。指标目标：会话第 3 轮起缓存命中率 ≥ 90%。

> **工具数组顺序**：主工具数组发给 provider 前按**工具名字典序稳定排序**（`ai/client.ts`，不改动调用方传入数组）——即使中途禁用 bash 或切换 code mode 导致注册顺序重排，工具槽位顺序也保持稳定。PTC SDK binding 亦按 schema 字典序生成。

### 会话日志 v2（不可变事件流 + 投影）

`SessionEvent` 共 **10 个变体**：`message`、`compaction/start`、`compaction/summary`、`compaction/end`、`todo/write`、**`goal/change`**、`approval`、**`workspace`**、`code-dispatch`、`run/stats`。其中 `compaction/start` / `compaction/end` / `todo/write` / `goal/change` / `approval` / `workspace` / `code-dispatch` / `run/stats` 是 **log-only**（永不进模型可见面）；`workspace` 标记供会话切换时恢复工具根与列表分组。

压缩不重开会话；v1 旧会话打开时原子升级（`upgradeToV2`）。`appendEvent` **先写盘后入内存**——写失败时内存与磁盘不再发散。**抗损坏**：进程被杀导致的末尾半行在 `Session.open` 时自动截断修复（不告警），中段真损坏行跳过并告警。`compactionSummaryMessage()` 让压缩的活路径与回放投影构造**逐字节相同**的摘要消息。

会话目录 API 在 `session-index.ts`（目录遍历 / 头扫描 / 列表记忆化 / `workspace` 标记各自成文件），列表按**工作区**分组（`workspace` 标记 / 旧日志回落 `<environment>` 的 `cwd=`）。**surface 传来的字符串 → 会话存储认的路径**归 `session-target.ts`（`sessionLogPath` / `deleteSessionLog` / `resolveWorkspaceDir` / `isInsideNovaHome`）：目录枚举只列不抛，目标校验必须拒绝并说明原因，两者失败模式不同所以按职责分开。**缺失工具结果的补齐只有一份实现**（`session-repair.ts` 的 `missingToolResults`）。

### 审批与权限（轻量版，对标 codex）

三档：`read-only`（默认，只读自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）。execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 默认按**命令程序前缀**记忆（`git status` 放行后续 `git …`，不波及 `rm`），复合命令只整条记忆；该粒度**可交互调节**（WebUI：选中「总是允许」行按 ←/→ 挪授权词数；REPL 侧无此交互。引擎按**词前缀匹配**放行，越界/复合自动回落默认粒度）。「拒绝」行打字即补充理由，经 `{answer:'deny', reason}` → hook verdict 一路回流成工具结果 `Permission denied: by user: <理由>`——**拒绝从死路变成一次指令**。

**答案解析只有一个实现**：`core/approval.ts` 的 `parseAskResult(value)` 把**任何不可信来源**的答案（WebUI 帧、插件 asker 返回值、REPL 行）转成内核 `AskResult`——同时接受 tagged 与 bare 两种形状，fail-closed（畸形一律 `undefined`），scope 词数与拒绝理由长度有界，拒绝理由里的控制字符被拒（`core/text.ts` 的 `hasControlChars`，多行字段允许换行）。此前每个 surface 各带一份，三份的「什么算合法」各不相同。

ask 路径的每次决定写入 `approval` 审计事件（log-only，可回放；自动放行不记事件，防只读工具刷屏）。审批弹窗上方实时渲染 `edit_file` 的 diff、`write_file` 的目标+首行预览（工具经可选 `preview(args)` 声明）。

### 工具执行

- **文件工具硬化**：`write_file` / `edit_file` 越界检查跑在 **realpath 规范化路径**上（堵死符号链接跟穿逃逸）；写用同目录 tmp + rename 原子替换；`edit_file` 带按文件版本的陈旧检测；`read_file` / `edit_file` 共用 `READ_MAX_BYTES = 8 MiB` 上限，另有二进制探测。`countLines()` 不把尾换行当一行。
- **`@path` 是工作区相对路径，提示词明说**：`system-prompt.ts` 有一条「按原样交给 read_file，不得增删路径段」——实测缺这一条时模型会自行「归一化」路径：工作区根是 `D:\下载\codex-main (1)`（根下只有一层 `codex-main/`），用户写 `@codex-main/docs/agents_md.md`，模型读成 `docs/agents_md.md` → 找不到 → 又花了四步侦察才找回原路径。
- **`read_file` 找不到时给出最近的同后缀路径**：`closestWorkspacePath()`（`builtin/fs.ts`）复用 `@` 菜单的列举策略（有界、跳过 `.git`/`node_modules`/`dist`、不跟随符号链接），返回**最短的同后缀命中**，附在 `file not found` 之后（没有任何相近项时只报找不到，答案保持原样）。上例中这一步就把四步恢复压缩成一步。
- **bash 结果第一行是 `cwd:`**：命令实际跑在哪个目录，是结果自身无法推断的那个事实——一旦它与 `<environment>` 的 `cwd` 不一致，这一轮所有相对路径的命令都答错了树，而省略 cwd 的结果从日志里看不出来（2026-10-01 那条 `find` 返回 `exit: 0` + 空输出、同命令在工作区根下却能列出文件，正是这类无从判断的情形）。
- **并行执行**：工具可声明 `isConcurrencySafe` 纯同步分类器，相邻多个 opt-in 调用整段并行（审批仍逐个串行），结果按原调用顺序写入保持确定性；并行段用 `Promise.allSettled` 收敛避免 unhandledRejection。
- **输出截断防御**：`finish_reason=length` 的截断消息中**所有 tool call 一律不执行**（流式参数可能静半截），整批以错误结果回填让模型重发；未解析成 JSON 的畸形参数**只失败那几条**，其余照跑；两条拒绝路径同样**成对发 `tool_call_start`**（只发结果则现场不显示）。
- **search_files**：`content_regex` 与 `name_glob` **至少一个必填**，两个都给时 `content_regex` 优先；默认跳过 `.git` / `node_modules` / `dist` 与点目录、绝不跟随符号链接、单文件 1 MiB 上限。**回溯隔离**：`content_regex` 先经宿主预检（长度 ≤ 512、量词总数 ≤ 32、嵌套量词组拒绝），再进**全新 worker 线程**执行；墙钟预算默认 30s、中止信号透传 `terminate()`。
- **专用工具优先于 shell**：系统提示与工具 description 双侧写排他句（`Use read_file — not shell commands like cat/head/tail`、`Use search_files — not shell grep/rg/find`）。
- **工作区切换（switch_workspace）**：第一方 `workspace` 插件（opt-in）校验目标目录后经 runner 回调 `env.reroster()` 重建工具宿主——fs/bash/search 根、技能列表、环境片段 cwd 一致重指。

### PTC / Code Mode（对标 Cloudflare/dsh run_code 简化版）

**执行模式是插件自己的一项设置，不是宿主的配置段**：`native|ptc|both` 三态（`PtcMode` 定义在 `packages/plugin-ptc/src/settings.ts`，与它自己的 `Config`、`PTC_SETTING_KEYS`、`ptcPage(...)` 同处）住在 `plugins.entries` 里 `@nova-agent/plugin-ptc` 那一行的 `config.mode`。宿主因此不认识「代码模式」这个词：没有 `tools.code` 段、core 里没有 `PtcMode`、`Kernel` 契约里没有 `codeMode()`，`/mode` 按**那一行的 id** 读回它的 config（`cli/src/command-runner.ts` 的 `codeModeInForce`）。插件按 mode 决定注册不注册 `run_code`，并在**自己的设置页**渲染那个下拉（模式为 `native` 时 RPC 命名空间**先注册再返回**——关掉工具不等于连设置也不能改）。开启后模型获得 `run_code {code, description}`：写一段 async TypeScript 程序，`await tools.name(args)` 即子调用，**穿过与原生调用完全相同的管线**（审批门 + 钩子 + 超时/中断）。只有程序 print/return 的策展输出进入上下文，中间结果只落 `code-dispatch` 审计事件。执行基底是**每 run 全新 worker 线程**（信任姿态等同 bash）：剥型、空环境、堆/busy-time/墙钟/输出四类预算。

### Subagent（隔离子代理）

`subagent` 工具（opt-in）：嵌套 `runAgent` 跑**全新消息面**（上下文隔离——子代理看不到父对话，prompt 必须自包含），最终 assistant 报告作为工具结果回流父会话（父日志保持「model-visible means logged」；子代理自身对话是瞬态、不落盘）。嵌套工具集活读取并**过滤 subagent 自身**（结构性禁止递归）；透传父 abort signal 与**同一 hooks 链**。**编排姿态**三层注入（系统提示 + 工具描述 + 嵌套 `SUBAGENT_POSTURE`）：默认 1–2 个只读侦察、brief 不重叠、报告给 `path:line` 证据指针；设计/复杂实现留在主代理。嵌套报告首行约定 `complete/partial/blocked`。

**进度回调在装配点接线，不留给 surface**（与 job 的 `jobs.setListener` 同一条纪律）：嵌套循环的 `start` / `tool_call` / `usage` / `done` 是内核事实，每个 surface 都要，所以 `runtime-builtins.ts` 的 `kernelPlugins()` 自己把它接到当前会话的 `observeSubagent()` 上（surface 给了 `onSubagentProgress` 则优先）——`runtime-roster.ts` 只是它的调用者。此前它被留给调用方，而四个装配点一个都没传，回调链在此断掉——`subagent_update` 在协议里声明着、前端为它写好并测过一整行，**全仓却没有任何地方发布过这个事件**，那一行是死代码。**新增「每个 surface 都想要」的内核事件时先问生产者在哪**：声明与消费者齐全而生产者缺席，测试会照着手写 fixture 一路绿。

### 后台 jobs / todo

`bash { run_in_background: true }` 立即返回 `bash-N` 句柄，`jobs` 工具（list/output/stop）读写增量输出。job 自然结束时**下一次 LLM 请求自动注入一行通知**（`drainFinished()`，以克隆消息数组追加临时 user 消息——**不落日志、不破坏投影不变量**；**送达性至少一次**：请求失败/中断时经 `requeue()` 回队），模型无需空转轮询。

`todo_write` 整表替换、last-write-wins，快照持久化为 log-only 事件，不占模型上下文；**计划面板**（composer dock 上一块默认折叠的卡，无计划不渲染）由内核 `todo` 事件驱动、续接时随 `ready.todos` 恢复；**计划失活提醒**：连续 3 轮无 `todo/write` 快照时，下一次请求经**同一请求级临时通道**注入 `STALE_TODO_NAG`（与 job 通知共用 at-least-once 簿记）。两个尾注都排在 hook 链**之后**——`beforeLLMCall` 的原地压缩假设 `request.messages` 与 `opts.messages` 同引用，提前克隆会吞掉它的 splice。

### 目标模式（goal）

`create_goal` / `update_goal` 工具与 `/goal` 命令。`/goal` 是 dsh 的完整语法：`<目标>` 建立、`edit <目标>` 修改、`pause` / `resume` / `clear` 控制、空参数查看（输出带随状态变化的可用命令表）；语义在 `plugins/goal-command.ts`，命令目录里只留一行注册。输入框在 `/goal ` 参数为空时画 claim 提示（`composer/claim-hint.ts`），并按**是否已有目标**在 `hint.goal` / `hint.goal.active` 之间消歧——dsh 的 `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}` 同一条规则，提示语与命令互为承诺。目标与 `todo_write` **同构**：整份快照、last-write-wins、log-only 的 `goal/change` 事件（`null` 记「已清除」，所以「没有目标」只有一种拼法），续接时随 `ready.goal` 恢复，模型不为它付上下文。

**跨轮续做复用已有的请求级临时尾通道**，core 不为它新增机制：`goalPlugin` 的 `beforeLLMCall` 钩子往正在组装的请求追加一条临时 user 消息（与 job 通知、计划失活提醒同一条通道，不落日志、每请求重算 ⇒ at-least-once）。由**插件侧**产出是刻意的：core 否则要认识 goal 才能硬编码第三个生产者。`rounds` 就在这个钩子里递增（唯一递增点），所以「模型读到第几轮」和「续接时恢复的计数」必然同源。轮次用尽即转 `blocked` 并写明原因——不是无限续做，也不是静默停下。前端是 dsh `ui-goal/GoalBar` 的移植：**36px 单行条**（目标字形 + 阶段词 + 截断目标 + 悬停动作：暂停/恢复/编辑/清除，编辑为条内联表单 `GoalEditRow`），挂在计划面板**之上**（目标是更长久的意图，计划是它当前这一步）；它是 composer 栈三张卡（队列面板 / 目标 / 计划）之一，同宽同 36px 同菜单材质。**动作走与输入框同一条 `/goal` 命令帧**（`{type:'command', name:'goal', args:'pause'}`）——点击与手打命令是同一个事实，不新增宿主动词；失败原因落在转录的命令行，条内不复制一份错误行（答案的单一所有者）。

`AgentSession.announceGoal(goal)` 是**工具之外**的调用者（`/goal` 命令、续做钩子）唯一的门口：它先 `appendEvent` 再 `publish`。工具路径不需要它——`goal/change` 由 `agentOptions` 的 log-watch 拾取（与 `todo/write` 同一条）。

### Skills / 数据落盘

Skills 只把 name+description 注入索引，命中触发词才加载正文——模型可自调用 `skill` 工具，也可 `/skill <name>` 手动触发（发现根与优先级见 §3）。

```
~/.nova/
├─ config.json              # 唯一配置来源
├─ skills/                  # 用户级技能
├─ plugins/                 # 用户插件根：第三方插件的 node_modules（`nova plugin add` 装到这里）
├─ sessions/YYYY/MM/DD/     # JSONL 会话（append-only，可回放，按日期归档，全局不分项目）
└─ cache/
   ├─ tool-outputs/<sessionId>/   # 工具输出溢出 + 压缩前全文存档
   ├─ images/<sha256-hex>         # 粘贴图片的字节（内容寻址，见 §5 模型端）
   ├─ web-port.json               # 上次绑定的 WebUI 端口（下次优先复用，origin 稳定）
   ├─ web-auth.json               # WebUI 配对（cookieToken+secret；cookie 跨重启有效）
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
- **测试必须隔离 `~/.nova`，且隔离由配置保证而非靠记忆**：`vitest.config.ts` 的 `setupFiles` 指向 `packages/test-setup.ts`，它在任何测试模块加载前把 `USERPROFILE` / `HOME` 指向临时目录。此前隔离靠各测试自己记得调 `withFakeHome`，而**五个套件忘了**（含建真内核跑在临时工作区、会话日志却写进真实 `~/.nova/sessions` 的 `plugins/test/runtime.test.ts`），于是每次 `pnpm test` 都在污染真实主目录，累积了 600+ 个垃圾会话。**会被人忘掉的规则等于没有规则**——凡是「每次都必须做对」的事，一律做成机制。**隔离目录也要处置**（2026-10-01 补）：临时家起初「故意留下、交给 OS 回收」，但 Windows 不回收 `%TEMP%`，实测累积 14.5 万个 `nova-*` 残留。现在的分工：**绿色运行自清理**（test-setup 的 `afterAll` 删自己的家；文件内**有失败则保留现场**——失败状态的检查窗口不是漏洞），各测试文件自建的其余 `nova-*` 家族由 **`pnpm clean`**（`scripts/clean-test-temp.mjs`）按年龄清扫（默认 >6h 才删——正在飞的并发会话永远建新目录，年龄下限保证不误删）。
- **路径/跨平台**：一律 `node:path` + 抽象层；bash 工具 Windows 优先 Git Bash、回落 PowerShell 并强制 UTF-8（`POWERSHELL_UTF8_PREFIX` / `powershellInvocation` / `bashOnPath` / `resolveShellName` 是共享原语）。
- **文档即真相**：机制变了同步改本文件；决策理由写进 commit message 与机制条目。
- **写代码时就要为拆分留位**：新增能力时**先**判断它属于哪个文件、那个文件离上限还有多远，**再**落笔；而不是写完一大坨后等门禁报红再回头拆。判据是**职责**而非行数——一个文件同时回答两个不同问题时（「哪条规则」与「谁来提供」、数据形状与运行时行为、读取与写入），**当场**分成两个文件。返工拆分的时间与 token 成本远高于一开始就分开。
- **门禁与 verify 分层**：快环 `pnpm check`；全环 `pnpm verify`。`pnpm gates` 是两件套**结构护栏**：`dep-direction.mjs` 机检包间 import 方向、`structure-budget.mjs` 管逐文件行数上限（超限即失败；新文件没有上限条目也会失败；陈旧条目亦失败，跑 `pnpm gates:update [子串]` 同步——上调逐条打印 `RAISED`，增长必须显式发生过）。**单文件超长是设计失败**：行数天花板就是「拆它」的指令。治巨型闭包的真正手段是 oxlint 的长函数/复杂度警告（存量警告即重构靶单）。
- **上限带余量，且必须随时可见**：上限 = `当前行数 + max(10, 10%)`，**不是**当前行数。曾经钉成当前行数，于是每个文件一落地就在 100%：门禁只会在收尾时说「你已经超了」，说不出「你快超了」，结果每次都要为十几个文件做**批量返工拆分**——而拆分成本本可以在写的时候就顺手摊掉。配套两条：①每次运行（默认的只读检查）末尾打印剩余不足 10 行的文件，作为**前瞻**信号而非失败，因此它出现在 `pnpm check` 快环里；②纯转出桶（只含 `export * from` / `export { … } from`，无任何声明）不计行数——它的长度是**模块条数**而非设计属性。
- **两道门禁的扫描范围**：`dep-direction.mjs` 与 `structure-budget.mjs` 都扫 `packages/<包>/src` **及其嵌套工作区成员的 `src/`**，所以 `packages/web/ui/src`（全仓最大的一块代码）**已经被覆盖**——它有逐文件行数上限，import 也按**宿主包 `web`** 的白名单（只允许 `@nova-agent/core` / `plugins` / `react`）机检。此前这一层是盲区（只扫单层 `packages/*/src`），文件再长、引了别的包都无人报警；若某包子目录**不是**工作区成员却有自己的 `src/`，它同样会被收进预算——「这是别人的目录」不再是一个可用的豁免理由。
- **断言粒度**：测试断**契约与不变量**（宽度守恒、结构顺序、关键字段存在、降级行为），不断完整文案串——观感微调不该触发红测试。**UI 测试车道无 DOM**，用 `renderToStaticMarkup` 或纯函数；**`readFileSync` 读源码做断言是反模式**。
- **绝不能动真实 `~/.nova/config.json`**，除非用户明确要求；实机检查一律用临时 home（`mkdtemp`）。

## 7. 状态与开放问题

**版本现状**：**0.4.0 已发行**（附注标签 `v0.4.0`；锁步组基线 0.4.0；`qqbot` 独立升到 **0.3.0**，记录在其自身 CHANGELOG）。0.y.z 期破坏性变更升次版本（§8）。**TUI 源码已删除（工作区；v0.4.0 仍含 TUI，删除随下一版发行落地）**（`packages/tui` / `packages/tui-app` 源码与 `--tui` flag、引导错误已移除，磁盘残留的 `dist/` + `node_modules/` 随后清理）：恢复后仍受三件事拖累——渲染层与产品逻辑纠缠、TTY 归属接缝反复出洞、真机验收无法自动化，而浏览器界面已是富界面，终端保留 readline REPL 即可。**`docs/` 只放对齐清单 `dsh-parity-inventory.md`，其余会漂移的副本不要加。**

1. **OpenAI 兼容接口缓存语义不一致**：DeepSeek 自动前缀缓存、部分网关需显式参数。已落地 usage/命中率统计；按 provider 的能力探测表留待后续。
2. **外部插件加载**：`plugins.entries` 的一行即可加载本地路径或包名模块，`nova plugin add` 负责安装与写行；尚无 registry 与 git URL 安装。
3. **容器化建议**：v1 不做进程沙箱，重隔离建议容器化运行。
4. **（已解决，待下一版发行落地）TUI 源码已删除**：`packages/tui` / `packages/tui-app` 的源码（工作区已删、v0.4.0 仍含）与 `--tui` flag、引导错误一并移除，「帧真的画对了、退出真的还原了终端」这类无法自动化验收的问题随包消失；`pnpm smoke:web` 是唯一真机档。若未来重做终端全屏界面，应作为第三方 surface 插件另立包（`surfaces` 配置行即可加载），不回本仓。
5. **（已解决）`pluginLoaded` 死缝已删除（2026-10-01）**：它自始只有声明、全仓无 `ctx.on`/`ctx.emit` 的消费者；按「新增能力键的前提是已经有人消费它」的纪律，随本批 minor 删除（`EventKey` 导出与 `plugin/loaded` 事件名一并移除）。`surfaces` 服务键**有提供者**（见 §5 能力服务缝）。
6. **装配点的一致性（`userQuestions` / `onSubagentProgress`）已收口**（装配合一后全仓只有一个调用点，见 §4）：`userQuestions` 的**推导规则**收成一个 core 纯函数 `deriveUserQuestions(caps)`（`answersQuestions ?? interactive ?? false`），`runtime-env.ts` 的服务端 provider 每次调用对 `registry.current()` 求值——注册表现在对每一类 surface 都有赢家，所以规则的唯一读者就是它；`buildSurfaceRuntime` 的同名调用只覆盖没有注册表的装配（内核测试 / 嵌入方）。`onSubagentProgress` 已由 `runtime-builtins.ts` 的 `kernelPlugins()` 在装配点接线（§5 Subagent）。**剩余**：没有注册表的装配仍回落到 `opts.userQuestions`（内核测试 / 嵌入方显式传），这是「嵌入方的规则」而不是「装配点的规则」，不是缺陷。

7. **插件发行模型迁移（进行中，2026-10-01 定规）**：基础能力（`bash` / `jobs` / `todo` / `goal` 等）**留主程序**——可开关、不可删除；扩展能力（`subagent` / `ptc` / `context` / `qqbot`）**按第三方对待**——独立包、按 spec 装载、缺失不影响整体应用。**进展**：`subagent` / `context` / `ptc` 已出包（`@nova-agent/plugin-*`），由 `plugin-tree.ts` 的 `SHIPPED_PACKAGES` 声明为随产品发行，装载失败只在该行留 `error`、不伤启动；**QQ 包刻意移出这份名单**——它是第三方编写示范，包只依赖 core（不是 plugins 反过来依赖它），凭据与设置住在它自己那一行的 `config` 里，所以 `nova qqbot` **要求配置里有那一行**（行不给就点名拒绝，见 §2/§3）；cli 对包零静态依赖（`qqbot-surface.ts` 里一处 `await import('@nova-agent/qqbot')`，缺失时 `nova qqbot` 报错、`nova --web` 降级）；`SurfaceRegistry.resolve` 生产者已补（适配器认领经注册表裁决并记录赢家）；web 装配合一（并入 `bootKernel`，见 §4）；surface 契约归一与注册表唯一解析（见第 8 条）。

8. **surface 合流已完成（2026-10-01 第二批）**：内置四家实现同一份 `AgentSurface`（各工厂），`SurfaceEntry` 形状删除；全部 surface 注册进同一注册表、解析只剩一次 `registry.resolve`（赢家记录进 `current()`，`userQuestions` 由此单一来源）；`onWorkspaceChanged` 接线（`repl` 首个实现方）、`CommandPorts` 并入 `AgentSurfaceUi`；装配收敛为唯一入口（见 §4）。**qqbot 物理搬包已落地（第三批）**：surface 半只剩 `packages/qqbot/src/surface/mode.ts`（认领 + 常驻 + 「通道没起来」的点名拒绝），通道本体、凭据、探针、设置页与 `qqbot_send` 工具全在包内的 `src/plugin.ts`；cli 只剩 `qqbot-surface.ts`（一处动态装载 + 认领 + 装配贡献）——凭据的 raw 文档读法留在 cli（那是配置层的规则）。**本项无剩余**。（设置页「扩展缺失」行内提示、`pluginLoaded` 死缝删除与设置页连接读数平铺→嵌套的存量修复均已在同批完成。）

9. **（记入待办、未立项）带真实凭据的 QQ 通道在外部网络失败时以 `exit 13` 退出**。**现象**：`plugins.entries` 里有 `@nova-agent/qqbot` 这一行、且它的 `config` 里 `appId` / `clientSecret` 非空（真实凭据）时，`nova qqbot` 在拨号拿不到可用 token / 网关的情况下，打印完横幅后以 **`exit code 13`** 结束——Node 的 *unsettled top-level await* 检出（验收方照抄的输出：`Warning: Detected unsettled top-level await at …cli/dist/index.mjs:4053` 紧跟 `await main();`，即 `packages/cli/src/index.ts:115` 的那一句），而不是给出一句可读的错误；那次真机日志里唯一的相关提示是 `[nova:warn] qqbot: access token request failed (200)`（`packages/qqbot/src/token.ts:108`）——**读法上的一个细节**：这句 warn 是 `token.ts:107` 的判据之一，`200` 说明 HTTP 回了 200、而响应体里没有可用的 `access_token`，所以它**不等价于**「TCP 连接被拒」；验收方对这一格的定性是「外部网络失败」，观测到的却是这一条 warn。**机制**：`packages/qqbot/src/surface/mode.ts:45` 的常驻是 `await new Promise<never>(() => undefined)`——它**故意永不 settle**，靠通道的 socket 持有事件循环（`mode.ts:44` 的注释就是这么写的）；而凭据非空时通道对象确实存在（`plugin.ts:227` 那道门只问「凭据填了没有」——非空、`{env:NAME}` 已兑现，判定在 `settings.ts:64` 的 `qqBotCredentialProblem`；`token.ts` 自身完全不校验，`credentials()` 只在字面值与 getter 之间选），`plugin.ts:244-260` 随即登记 `activeChannel` 并异步 `channel.start()`，**拨号失败只是页面读数**（`started.failure` + 一条 warn），既不卸载通道也不解绕常驻。于是这一格是「通道进入了失败态：既不退出，也没有 socket 守事件循环」，Node 的 unsettled-top-level-await 检出因此接管。**它与哪些已知行为不同**：凭据**空/未设**时走的是另一条路，且那条**是对的**——`plugin.ts:227` 直接返回 → 不建通道 → `runningQqBotChannel()` 为 `undefined` → cli 侧 `qqbot-surface.ts:84` 与包内 `mode.ts:24-30` 点名拒绝 → `runSurface` 拆掉这次装配（`surface-host.ts:101-106`）→ 一句可读的中文错误；**只有「凭据非空 + 网络失败」这一格**是这个形状。**状态：记入待办、未立项**——它是「常驻靠永久 pending 的 await、由 socket 持有事件循环」这一**已声明设计**在**外部网络失败**这一外部条件下的表现，真实部署有网即常驻，且不在本轮交付范围内；所以它**不是**「缺陷已修」（没修），也**不是**被证据判定的缺陷——证据只够说明「这个形状存在」。**证据强度**：本条出自**独立验收方的真机观测**（真凭据、该变体真的尝试了拨号），**未经编排者用真凭据复现**，也**没有回归测试**，请读作**观测事实**而非复现过的回归。**若要收口，方向**是让「通道进入了失败态」这件事**令常驻解绕**（以可读原因退出），而不是依赖事件循环被 socket 意外持有。

## 8. 版本与发布（SemVer 2.0.0）

版本号遵循 **Semantic Versioning 2.0.0**。规范第 1 条要求升位必须有公共 API 判据——本节即**本项目的公共 API 定义**。

### 公共 API 面

凡改变以下任一面的可观察行为或签名，即为公共 API 变更；未列入清单的内部实现（模块私有函数、错误文案、事件内部字段等）不构成版本约束。

1. **CLI 用法与参数**：`nova` / `nova exec` / `nova qqbot` 的全部 flags 与形态、`--json` 事件流 schema、进程退出码。
2. **配置 schema**：`~/.nova/config.json` 的字段名、类型与语义（§3 清单，含 `models[]`、`{env:NAME}` 引用形式与 `plugins.entries` 每行 `{ id, enabled?, config? }` 的加载语义）。
3. **JSONL 会话日志 v2 格式与投影语义**：`SessionEvent` 的 10 个事件类型、字段结构、`deriveMessages()` 投影规则、压缩语义。
4. **插件 API**：core `Plugin`（`{ name, manifest?, inject?, Config?, apply(ctx, config) }` + 函数 / 类两种形式）、`PluginManifest`（`title` / `description` / `tier` / `page?`）与 `PluginPageDescriptor`、`registerTool(ctx, def, permission)` / `registerCommand(ctx, def)`、`ToolDefinition`（含 `presentCall` / `presentResult` / `preview`）、`ToolExecuteContext`、钩子签名、审批档位与 `permission` 声明；**容器公共面**（`Context` / `ctx.provide` / `ctx.scope({isolate, intercept})` / `ctx.labelled` / `key<T>()` / `ctx.on` / `ctx.effect`）、**能力服务键**（`loader` / `pluginRpc` / `pluginConfig` / `executionEnvironment` 与既有键的语义）与 `plugins.entries` 能加载的插件形态。
5. **内核协议（surface 契约）**：`AgentSession` 句柄的方法集、`KernelEvent` 的变体与字段、`Kernel` 的成员（含 `models?` / `commands` / `runCommand()` / `roster()` / `pluginConfig()` / `pluginRpc()`）、`createAgentKernel` 的装配签名——凡实现一个 surface（官方或第三方）所依赖的都是公共面。
   > **`surfaces` 服务键已有提供者**（§5 能力服务缝）：注册表在容器之外先于内核装配存在（`plugins/src/surface-registry.ts`），装配方把它连同已加载的 surfaces 交给 `createAgentKernel({ surfaces })`，容器把**同一个**实例 provide 成 `surfaces` 服务——所以 `AgentSurface` / `AgentSurfaceKernel` **是行为契约**（有人实现、有人加载、有人装配）。`pluginLoaded` 事件键已删除（2026-10-01，见 §7.5）。它们仍是 `core` 的导出，签名变更照样要升位。
6. **各 `@nova-agent/*` 包公开导出**：每个包 `exports` 只有 `"."`。`core`（agent 循环 / 消息模型 / 会话 / kernel 句柄与事件协议 / 审批与呈现词汇表 / 插件容器与能力键 / 插件 manifest、设置页描述符与 `objectConfig` / 模型 id 对账与目录选择规则 / 文件与目录枚举 / 跨会话活动聚合 `aggregateSessions`；**`session-peek.ts` 不在其中**）、`ai`（`client` + `sse`）、`plugins`（容器门面 / 审批 / 内置工具 / 命令目录与 runner / 内核装配；`fs.ts` 与 `bash.ts` 只做**窄化具名再导出**）、`web`（surface 后端与帧协议：`list_models` / `set_model` / `list_model_config` / `save_models` / `command` / `load_earlier` / `load_trace` / `set_workspace` / `delete_session` / `list_files` / `list_directory` / `create_directory` / `pick_file` / `pick_directory` / `set_plugin_enabled` / **`plugin_request`** 客户端帧与 `parseClientFrame` 判据、`models` / `model_config` / `state` / `sessions` / `files` / `directory` / `directory_error` / `picked` / `roster` / **`plugin_response`** / `ready` 的字段、`server.ts` 的静态缓存策略与 `GET`/`POST /api/image` 字节路由、`GET /api/dashboard` 的 `aggregate` 字段、`GET /api/context-window` 的 `snapshot` 字段）、`qqbot`（渠道插件示范：默认导出即 `Plugin`（凭据 schema、`qqbot_send`、探针与设置页描述符全在包内），surface 半只余 `src/surface/mode.ts` 的认领与常驻）、`cli`（`config` / `surfaces` / `command-runner`——**`"."` 是 bin 脚本，零 export**）。

### 升位映射

| 变更类别 | 判定 | 升位 |
| --- | --- | --- |
| 不兼容 | 破坏以上任一 API 面的行为或签名（如日志 v2→v3、插件钩子签名变更、删除一个 surface 形态） | 升**次版本**（0.y.z 期）/ 主版本（1.0.0 后），并在 changeset 正文里点名迁移方式（生成的 `CHANGELOG.md` 即发行说明） |
| 向后兼容新增 | 新增 flag / 字段 / 工具 / 导出，既有行为不变 | 升**次版本** |
| 仅修正 | 只修复错误结果，公共 API 面不变 | 升**修订号**（x>0 时） |

### 发布流程（changesets）

- monorepo **fixed 锁步组**：5 个 `@nova-agent/*` 工作区包（`core` / `ai` / `plugins` / `web` / `cli`）恒一致、共享单一版本号（`.changeset/config.json` 的 `fixed` + `privatePackages: { version: true, tag: true }`、`access: "restricted"`）；`qqbot` **刻意留在组外**（第三方插件示范，按自身改动独立升位）。根包 `nova-agent` 是 private 且非 workspace 成员，由 `scripts/sync-root-version.mjs` 在 release 中读 `packages/cli/package.json` 同步。**锁步组与磁盘上的工作区包必须一致**：`cli/test/version.test.ts` 从磁盘发现包并校验——组里写了不存在的包会让 `changeset version` 直接失败。
- 每项面向用户改动提交一份 changeset（`.changeset/*.md`，标注 minor / patch）。**变更集在发行前可合并**：被后续重写取代的条目应并入取代它的那一条，而不是留成悬空记录。
- 发行：`pnpm changeset` → `pnpm changeset version` → 提交 → `changeset tag` → `pnpm release` 一条龙。
- **已发行版本内容不可变**（规范第 3 条）：绝不 amend / 移动既有 tag；一切修改以新版本向前发行。
- tag 形式：附注标签 `vX.Y.Z`——v 前缀是 tag 名，版本号本体为无前缀的 `X.Y.Z`。

### 0.y.z → 1.0.0 门槛

当前处于 **0.y.z 初始开发阶段**：基线 `0.1.0`，每次发行递增次版本号。升至 **1.0.0** 的判据：软件用于正式生产环境、且上述公共 API 六面稳定（变更频率从「随时可能」降至「仅经慎重评估才破坏」）。`0.y.z` 期的每次发行均视为完整发行——遵守不可变 tag 规则、有 changeset 记录、可回溯。
