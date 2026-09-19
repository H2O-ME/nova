# NovaAgent 架构模型 — 证据索引

生成：system-modeler + c4model/graphviz（architecture-visualization 插件），2026-09-18。
视图状态：全部为 **current-state**；置信度定义见 AGENTS 共享规范（high=代码/配置直证）。

## 节点证据

| 节点 | 类型 | 置信度 | sourceRefs |
| --- | --- | --- | --- |
| `core` | module（内核） | high | `packages/core/src/`（agent/ 六模块、session.ts、estimate.ts、request-trim.ts、jobs.ts）；`scripts/dep-direction.mjs:13`（`core: []`） |
| `tui` | module（内核） | high | `packages/tui/src/`（screen/keys/width/caps）；`scripts/dep-direction.mjs:14`（`tui: []`）；实测 src 内 0 处 `@nova-agent/*` import |
| `ai` | module | high | `packages/ai/src/client.ts:1`（`import type ... from '@nova-agent/core'`，types-only）、`:225`（chat/completions）、`:300`（/models） |
| `plugins` | module | high | `packages/plugins/src/{host,permission,skills,types}.ts`、`builtin/`（9 工具模块）、`ptc/`（5 模块） |
| `tui-view` | module | high | `packages/tui-view/src/`（15 个纯视图模块）；package.json deps = tui+core |
| `qqbot` | module | high | `packages/qqbot/src/{protocol,runtime,plugin}.ts`；AGENTS.md §4「第三方插件编写示范」 |
| `cli` | module（产品壳） | high | `packages/cli/package.json` `"bin": {"nova": "./dist/index.mjs"}`；`src/` 23 模块 + `src/tui/` 11 模块 |
| `~/.nova/` 数据目录 | data store | high | `packages/cli/src/config.ts:7,94-106,158`（唯一配置源、sessions 按日期归档、工作区零写入） |
| LLM provider 端点 | external system | high | `packages/ai/src/client.ts:225,300`；URL 由用户 `provider.baseURL` 配置（AGENTS.md §3） |
| models.dev | external system | high | `packages/cli/src/model-meta.ts:15`（`MODELS_DEV_URL`）、缓存 TTL/回落逻辑 `:9-11` |
| QQ 开放平台 | external system | high | `packages/qqbot/src/protocol.ts:27`（token endpoint）、`:313`（REST baseUrl）、`:7`（WS 网关状态机 op10/op2/op6） |
| 用户/操作者 | actor | high | AGENTS.md §1（当前工作目录运行的 agent CLI/TUI）；`nova` bin 入口 |

## 边证据（import 实测 = `grep -rho "@nova-agent/*" packages/*/src` 计数）

| 边 | 类型 | 置信度 | sourceRefs |
| --- | --- | --- | --- |
| cli → {core ×29, tui-view ×30, plugins ×11, tui ×8, qqbot ×2, ai ×1} | depends-on | high | 实测计数 + `packages/cli/package.json` dependencies + `dep-direction.mjs:19` 白名单三方吻合 |
| ai → core（仅类型） | depends-on(types) | high | `client.ts:1` `import type`；`:370` 注释明示 types-only 意图 |
| plugins → core ×20 | depends-on | high | 实测 + `packages/plugins/package.json` |
| tui-view → tui ×8, → core ×3 | depends-on | high | 实测 + `packages/tui-view/package.json` |
| qqbot → core ×2, plugins ×2 | depends-on | high | 实测 + `packages/qqbot/package.json` |
| core/tui → ∅（零上游） | 结构约束 | high | `dep-direction.mjs:13-14`（`ALLOW.core/tui = []`）+ `pnpm gates` 机检 + 实测 0 import |
| ai → provider | calls（HTTP+SSE，sync/stream） | high | `client.ts:225` |
| cli → models.dev | calls（HTTP，后台拉取+落盘缓存） | high | `model-meta.ts:15` |
| qqbot → QQ 平台 | calls（WS async + REST sync） | high | `protocol.ts:7,27,313` |
| core → sessions JSONL | writes（先写盘后入内存） | high | AGENTS.md §5 会话日志 v2；`core/src/session.ts` |
| core → tool-outputs 溢出/存档 | writes | high | AGENTS.md §5（`~/.nova/cache/tool-outputs/<sessionId>/`） |

## 假设与低置信项

- **无**。本次模型中所有包间边均有 manifest + 白名单 + 实测 import 三重直证。
- 待验证（结构性 unknown，非缺陷）：
  - provider 侧缓存语义差异（DeepSeek 自动 vs 网关显式参数）——AGENTS.md §9.1 开放问题，属行为面而非结构面。
  - 外部插件加载（本地路径/git URL）——roadmap，未实现，图中未画。

## 交叉一致性检查

`scripts/dep-direction.mjs` 的 `ALLOW`、7 个 `package.json` 的 `workspace:*` 依赖、源码 import 实测——三者**完全一致**，无漂移。
