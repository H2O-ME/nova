# NovaAgent —— 目标模式文档（v0.2，随实现同步更新）

> 定位：自研、插件化、可拓展、轻量化的跨平台本地智能体框架。
> 参照系：pi（分层工具包 + 差分渲染 TUI）、deepseek-harness（一切皆插件 / Cordis 组合式内核）、openai/codex（AGENTS.md、审批与沙箱、单二进制 CLI）。

---

## 1. 一句话目标

`pnpm` 管理的 TypeScript monorepo，产出一个在**当前工作区根目录**运行的 agent CLI/TUI：所有数据（配置、会话、缓存、skills、插件）默认落在项目根目录的 `.nova/` 下，不占用 C 盘用户目录；通过 OpenAI 兼容接口对接任意模型；以"一切皆插件"的内核支撑 MCP、Skills、工具、命令、UI 的统一拓展。

## 2. 调研结论（设计决策的来源）

| 来源 | 采纳的核心思想 | 明确不采纳的部分 |
| --- | --- | --- |
| **pi** | 分层包结构：`core`（agent loop + 状态）/ `ai`（多供应商统一 API）/ `tui`（差分渲染终端 UI）/ `coding-agent`（产品壳）；扩展即代码（extension 直接注册工具/命令/UI 块） | pi 无权限系统、依赖 npm；我们改为 pnpm + 内置轻量审批层 |
| **deepseek-harness** | "Everything is a Plugin"：工具、命令、服务、UI 全部是插件单元，通过统一内核（Cordis 式依赖注入 + 生命周期事件）组合；monorepo + pnpm + tsdown 构建 | 不引入 Cordis 本体，自写约 300 行的微型容器（避免重型范式依赖） |
| **codex** | AGENTS.md 项目指令发现链、turn 内审批（approval modes）、会话持久化为可回放 JSONL、`--version`/非交互 exec 双模式 | 不用 Rust；不做系统级沙箱（v1 用审批确认 + 目录白名单代替） |

## 3. 技术栈与运行环境

- **运行时**：Node.js ≥ 20（LTS），单仓库 `pnpm workspace`；可选 Bun 编译单二进制（v2 目标）。
- **语言**：TypeScript（strict），ESM-only；构建用 `tsdown`（或 tsup），测试 `vitest`，lint `oxlint` + `prettier`。
- **平台**：Linux / Windows（macOS 顺带兼容，不作为测试目标）。所有路径操作走 `node:path` + 独立抽象层，禁止硬编码 `/` 或 `\`。
- **零强制全局写入**：默认只读写 CWD 根下的 `.nova/`；仅在用户显式配置时才使用 home 目录。

## 4. Monorepo 结构

```
nova/
├─ packages/
│  ├─ core/          # agent loop、会话状态、上下文管理、工具调度（无 IO 副作用假设）
│  ├─ ai/            # OpenAI 兼容供应商层：流式、工具调用、重试、缓存指纹
│  ├─ plugins/       # 插件加载器与 API（注册工具/命令/MCP/skill/hook）
│  ├─ mcp/           # MCP 客户端：stdio + Streamable HTTP（remote）
│  ├─ tui/           # 差分渲染终端 UI（自写，React-free，~2k 行以内）
│  └─ cli/           # 产品壳：交互 TUI + 非交互 exec 模式 + 配置发现
├─ docs/
├─ pnpm-workspace.yaml
└─ package.json
```

依赖方向强制单向：`cli → {tui, plugins, mcp, ai, core}`，`plugins → core`，`core` 不依赖任何上层包。

## 5. 内核：一切皆插件（对标 deepseek-harness）

自研微型容器（`packages/plugins`），三要素：

1. **Service 容器**：命名服务注册 + 异步初始化 + 依赖声明（`inject: ['config','logger']`）。
2. **插件单元**：每个插件是一个 `(ctx) => void | Promise<void>` 的激活函数，通过 `ctx` 注册能力：
   - `ctx.registerTool(def)` —— agent 可调用工具
   - `ctx.registerCommand(def)` —— 斜杠命令（`/compact` 等）
   - `ctx.registerHook(event, fn)` —— 生命周期拦截（beforeLLMCall、afterToolCall、contextCompact…）
   - `ctx.registerProvider(def)` —— 模型供应商
   - `ctx.registerUI(def)` —— TUI 面板/状态栏组件
3. **事件总线**：同步 emit，hook 按 `before → around → after` 包裹，任何工具调用/LLM 请求均可被插件改写或拦截。

内置能力（chat、文件工具、bash、MCP、skills、compact）全部实现为**第一方插件**——与第三方插件走完全相同的 API，保证内核最小。

## 6. MCP 支持（对标用户给出的配置格式）

`packages/mcp` 实现客户端：

- **传输**：`stdio`（本地进程）与 `remote`（Streamable HTTP，SSE 降级）。
- **配置发现顺序**：`./.nova/mcp.json` → 上级目录向上查找 → `~/.nova/mcp.json`（仅显式存在时）。格式与用户示例完全一致：

```json
{
  "mcp": {
    "fathom": {
      "type": "remote",
      "url": "https://fathomsearch.xyz/mcp",
      "enabled": true,
      "headers": { "X-API-KEY": "{env:FATHOM_API_KEY}" }
    }
  }
}
```

- 支持 `{env:NAME}` 与 `{file:path}` 两类引用展开；`enabled: false` 优雅跳过。
- MCP 工具注册进统一工具表，与本地工具同权重参与调度与审批；`list_engines`/`search` 等按 server 隔离命名（`mcp__fathom__search`）。
- 工具列表变更时使上下文中的 tools 指纹失效（见 §9 缓存策略）。

## 7. Skills（对标 Anthropic/ZCode 模式）

- 目录：`.nova/skills/<name>/SKILL.md`，YAML frontmatter（`name`、`description`、触发条件）+ 正文指令 + 同目录辅助脚本。
- **渐进加载**：启动只把所有 skill 的 name+description（约 50–100 token/个）注入系统提示；命中触发词时才把正文注入（或作为 skill 工具调用读取），避免系统提示膨胀破坏缓存。
- `/skill <name>` 手动调用；`skill` 注册为一个 agent 工具，模型可自调用。
- 支持项目级 `.nova/skills/` 与用户级 `~/.nova/skills/` 双层，项目级优先。

## 8. CLI + TUI 双形态

- `nova`（无参）→ 交互 TUI（TTY 下全屏；非 TTY 自动回落 readline，`--repl` 强制 readline）；`nova exec "<task>"` → 非交互单次任务执行（受 `maxTurns` 约束，CI 友好，codex 模式）。
- TUI 自写差分渲染（对标 pi-tui）：alternate screen + 行级 diff 重绘，避免 ncurses/React 依赖；支持流式 markdown、工具调用折叠块、审批弹窗、状态栏、PageUp/PageDown 滚动、Ctrl+C 中断当前轮（空闲时两段退出）。
- 斜杠命令（已落地）：`/help /init /model /approvals /plugins /mcp /skill /session /new /compact /clear /exit`（TUI 中输入 `/` 弹出面板，↑↓ 选择、Tab 补全、输入历史）。
- AGENTS.md 发现链（已落地）：从工作区根到当前目录逐层收集（根在前），共享 32KB 字节预算，注入会话首条 user 上下文片段 `<project_docs>`（非系统提示，保持前缀字节稳定）；`/init` 生成初版。

## 9. 上下文管理与缓存命中率（核心差异化目标）

目标：**稳定前缀 = 高缓存命中**。机制分四层（前三层已按 M4/M6 实现落地）：

1. **前缀冻结原则（已落地）**：系统提示字节稳定（persona + 工作方式 + 工具规则），环境信息、AGENTS.md、用户指令、技能索引注入为**会话首条 user 消息片段**，append-only 不回改——稳定前缀 = 高缓存命中。
2. **追加式消息日志（已落地）**：对话严格 append-only，中间不改写历史；工具结果超限（默认 40KB）时全文落盘 `.nova/cache/tool-outputs/<sessionId>/`，消息体内保留头部 60% + 尾部 40% 并附读取提示——截断发生在新消息上，绝不回改旧消息。
3. **compact（已落地）**：`/compact`、自动阈值（`autoCompactTokenLimit`，以最近一次 usage 为锚点发请求前预判）共用同一实现；压缩**原位追加** `compaction/start → summary → end` 三个事件，模型可见面由 `Session.deriveMessages()` 投影重建，原始历史永不改写；crash 半路的压缩留下可检测的孤儿锁（自动丢弃并告警）。
4. **供应商对齐（待做）**：针对需显式参数的网关按 provider capability 探测加 `cache_control` 等价参数（当前 DeepSeek 式自动前缀缓存已够用）。每轮 `cached_tokens` 已在状态栏/`/session` 实时显示，并附带缓存浪费审计（missTokens，噪声底 1024 tok）。

指标：会话第 3 轮起 prompt cache 命中率目标 ≥ 90%（可在 `/session` 中查看）。

## 10. 安全与权限（轻量版，对标 codex 审批）

三档模式（已按 M2/M6 落地）：`read-only`（默认，只读工具自动放行）/ `auto-edit`（工作区内写自动放行）/ `full`（全放行）。execute/write/network 类工具交互确认，支持 `y / n / a(lways)`——bash 的 "always" 按**命令程序前缀**记忆（`git status` 放行后续 `git ...`，不波及 `rm`），其余按工具名+类型记忆；asker 抛错一律拒绝（fail-closed）；exec/CI 走服务内 `never` 策略，确定性拒绝；每次决定写入 `approval` 审计事件（log-only，可回放）。v1 不做进程沙箱，文档明示"容器化建议"（借鉴 pi 的 containerization.md 思路）。

## 11. 数据落盘布局（不占用 C 盘）

```
<项目根>/
├─ .nova/
│  ├─ config.json        # 模型/供应商/审批档位
│  ├─ mcp.json
│  ├─ skills/
│  ├─ plugins/           # 本地插件（TS/JS 单文件或目录）
│  ├─ sessions/          # JSONL 会话（append-only，可回放）
│  ├─ cache/             # 工具输出、模型响应指纹缓存
│  └─ logs/
```

`node_modules`、构建产物由 pnpm 虚拟 store 管理；`.gitignore` 已排除 `.nova/`（会话含代码上下文）。无安装器、无注册表、无 AppData 写入；config.json 中的 `apiKey` 支持 `{env:NAME}` 引用环境变量（已落地），避免明文密钥进仓库。

## 12. 里程碑

| 阶段 | 交付物 | 验收标准 |
| --- | --- | --- |
| **M1（已完成）** | `core` + `ai` + 基础 CLI（REPL，无 TUI） | 连接任意 OpenAI 兼容端点完成多轮工具调用；会话 JSONL 落盘 |
| **M2（已完成）** | 插件容器 + 内置文件/bash 工具 + 审批三档 | 第一方能力全部走插件 API；`/plugins` 可见 |
| **M3（已完成）** | MCP（stdio + remote）+ Skills | 用户示例的 fathom 配置可直接跑通 `search` |
| **M4（已完成）** | TUI（差分渲染）+ compact + 缓存指标 | 1000+ 轮长会话流畅；第 3 轮起命中率 ≥90% |
| **M5（已完成）** | `exec` 非交互模式 + 跨平台打磨（Windows 终端/路径/信号） | Linux + Windows CI 全绿 |
| **M6（已完成）** | 借鉴 deepseek-harness 六项改进：会话日志 v2（不可变事件流 + 投影压缩 + 孤儿锁检测）、token 锚点压缩预判、并行工具执行（isConcurrencySafe）+ 工具级超时、后台 jobs（bash 后台 + jobs 工具，预留 subagent 扩展位）、todo 工具（log-only 整表替换）、审批收紧（bash always 按命令前缀 / fail-closed / never 策略 / approval 审计事件） | 全部测试绿；v1 会话自动升级；投影面 == 日志投影不变量（NOVA_DEBUG 校验） |

## 13. 风险与开放问题（请审批时一并定夺）

1. **TUI 自研 vs 采用 ink/blessed**：~~自研差分渲染更轻、无 React 依赖，但工期 +1 周。**建议自研**（pi 已验证该路线）。~~ **已决策并落地**（M4 自研 `packages/tui`）。
2. **OpenAI 兼容接口的缓存语义不一致**：DeepSeek 自动前缀缓存、部分网关需显式参数。→ **部分落地**：usage/缓存命中率已统计展示；按 provider 的显式参数能力探测表留作后续。
3. **Windows 信号与 PTY**：bash 工具在 Windows 走 `cmd/powershell` 还是要求 Git Bash？→ **已决策并落地**（M2）：自动探测，Windows 优先 Git Bash，回落 PowerShell 并强制 UTF-8 输出编码；`tools.bash.shellPath` 可显式指定。
4. 插件分发方式 v1 是否需要 registry？**建议否**——v1 只支持本地路径 + git URL 安装到 `.nova/plugins/`（尚未实现外部插件加载，当前仅有第一方内置插件）。

---

*M1–M6 已全部交付（详见 §12 与 README 里程碑）；§13 开放问题已逐项标注决策状态，§14 为 M6 后的遗留扩展点。*

## 14. M6 后的遗留扩展点（源自 deepseek-harness 调研）

1. **subagent 能力**：复用 `JobRegistry` 的 owner/cancel/通知契约（`JobKindMap` 已预留 `subagent` kind），参考 dsh 的多 provider 注册 + `prepareContinuable` 可续接子代理设计。
2. **后台任务完成通知**：jobs 目前为轮询式；下一步在 `beforeLLMCall` 钩子注入完成通知（dsh inbox 注入语义），避免模型反复拉取。
3. **token 逐节点定价**：当前为整条消息粒度的启发式估价 + usage 锚点；dsh token-meter 的节点级 surface 定价（含图片 route pricing）留待需要精确计费时引入。
4. **设计决策笔记**：采纳 dsh 的 `.agents/notes` 实践，重大机制改动（如本次压缩语义切换）附决策记录。
