# NovaAgent 架构模型 — 证据索引

生成：system-modeler + c4model/graphviz（architecture-visualization 插件），2026-09-18；
按 M11 surface 拆分刷新，2026-09-20。
视图状态：全部为 **current-state**；置信度定义见 AGENTS 共享规范（high=代码/配置直证）。

## 节点证据

| 节点 | 类型 | 置信度 | sourceRefs |
| --- | --- | --- | --- |
| `core` | module（内核） | high | `packages/core/src/`（`agent/` 六模块、`kernel/`{protocol,pump,session}.ts、`session.ts`、`estimate.ts`、`request-trim.ts`、`jobs.ts`、`compact.ts`、`auto-compact.ts`、`context-fragment.ts`、`approval.ts`、`paths.ts`、`session-index.ts`、`presentation.ts`）；`scripts/dep-direction.mjs`（`core: []`） |
| `tui` | module（内核） | high | `packages/tui/src/`（screen/keys/width/caps）；`scripts/dep-direction.mjs`（`tui: []`）；实测 src 内 0 处 `@nova-agent/*` import |
| `ai` | module | high | `packages/ai/src/client.ts:1`（`import type ... from '@nova-agent/core'`，types-only）、chat/completions 与 /models 两处端点 |
| `plugins` | module | high | `packages/plugins/src/{host,permission,skills,types}.ts`、`builtin/`（fs/bash/jobs/todo/search/subagent/workspace）、`ptc/`（5 模块）、`runtime.ts`（`createAgentKernel` 装配单源） |
| `tui-app` | module（surface） | high | `packages/tui-app/src/`（15 个模块：`blocks`/`entries`/`render`/`panels`/`frame`/`keys`/`scrollback`/`app` 等）；package.json deps = tui+core+plugins；`dep-direction.mjs` 白名单 |
| `web` | module（surface） | high | `packages/web/src/`（ws/auth/protocol/transcript/controller/server/options/index）8 模块 + 前端子包 `ui/src/`；`packages/web/package.json` dependencies **只有** core+plugins（零第三方依赖） |
| `qqbot` | module（渠道插件） | high | `packages/qqbot/src/{protocol,runtime,plugin}.ts`；AGENTS.md §4「第三方插件编写示范」 |
| `cli` | module（产品壳） | high | `packages/cli/package.json` `"bin": {"nova": "./dist/index.mjs"}`；`src/` 18 模块（含 `command-runner.ts` 命令语义单源、`tui-mode.ts`/`web-mode.ts`/`repl.ts`/`exec.ts`/`qqbot-mode.ts` 五个 surface 装配） |
| `~/.nova/` 数据目录 | data store | high | `packages/cli/src/config.ts`（唯一配置源、sessions 按日期归档、工作区零写入） |
| LLM provider 端点 | external system | high | `packages/ai/src/client.ts`；URL 由用户 `provider.baseURL` 配置（AGENTS.md §3） |
| models.dev | external system | high | `packages/cli/src/model-meta.ts`（`MODELS_DEV_URL`）、缓存 TTL/回落逻辑 |
| QQ 开放平台 | external system | high | `packages/qqbot/src/protocol.ts`（token endpoint / REST baseUrl / WS 网关状态机 op10/op2/op6） |
| 浏览器（本机） | external system | high | `packages/web/src/auth.ts`（launch token → HMAC cookie）、`server.ts`（静态托管 + `/ws` upgrade 门，穿越拒） |
| 用户/操作者 | actor | high | AGENTS.md §1（当前工作目录运行的 agent CLI/TUI/WebUI）；`nova` bin 入口 |

## 边证据（import 实测 = `grep -rho "@nova-agent/*" packages/*/src` 计数）

| 边 | 类型 | 置信度 | sourceRefs |
| --- | --- | --- | --- |
| cli → {core ×11, plugins ×8, tui ×4, ai ×3, web ×2, tui-app ×1, qqbot ×1} | depends-on | high | 实测计数 + `packages/cli/package.json` dependencies + `dep-direction.mjs` 白名单三方吻合 |
| ai → core（仅类型） | depends-on(types) | high | `client.ts:1` `import type`，源码实测 1 处 |
| plugins → core ×26 | depends-on | high | 实测 + `packages/plugins/package.json` |
| tui-app → tui ×6, → core ×8 | depends-on | high | 实测 + `packages/tui-app/package.json`（白名单含 plugins，当前 src 尚未使用） |
| web → core ×4, plugins ×2 | depends-on | high | 实测 + `packages/web/package.json` |
| qqbot → core ×2, plugins ×2 | depends-on | high | 实测 + `packages/qqbot/package.json` |
| core/tui → ∅（零上游） | 结构约束 | high | `dep-direction.mjs`（`ALLOW.core/tui = []`）+ `pnpm gates` 机检 + 实测 0 import |
| browser → web | calls（HTTP static + WS frames） | high | `server.ts`（静态托管与 `/ws` upgrade 共用同一 cookie 门） |
| ai → provider | calls（HTTP+SSE，sync/stream） | high | `client.ts` |
| cli → models.dev | calls（HTTP，后台拉取+落盘缓存） | high | `model-meta.ts` |
| qqbot → QQ 平台 | calls（WS async + REST sync） | high | `protocol.ts` |
| core → sessions JSONL | writes（先写盘后入内存） | high | AGENTS.md §5 会话日志 v2；`core/src/session.ts` |
| core → tool-outputs 溢出/存档 | writes | high | AGENTS.md §5（`~/.nova/cache/tool-outputs/<sessionId>/`） |

## 假设与低置信项

- **无**。本次模型中所有包间边均有 manifest + 白名单 + 实测 import 三重直证。
- 待验证（结构性 unknown，非缺陷）：
  - provider 侧缓存语义差异（DeepSeek 自动 vs 网关显式参数）——AGENTS.md §9.1 开放问题，属行为面而非结构面。
  - 外部插件加载（本地路径/git URL）——roadmap，未实现，图中未画。

## 交叉一致性检查

`scripts/dep-direction.mjs` 的 `ALLOW`、8 个 `package.json` 的 `workspace:*` 依赖、源码 import 实测——三者**完全一致**，无漂移。`packages/web/ui` 是 `web` 包内的前端子包（private、不在依赖图里），归 `web` 一档。