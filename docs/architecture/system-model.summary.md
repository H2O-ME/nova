# NovaAgent 架构理解（current-state 摘要）

生成：system-modeler（architecture-visualization 插件），2026-09-18。
范围：`D:\web\agent` 全仓；不含 `.reference/codex`（vendored 参照系）。

## 系统边界

NovaAgent 是一个在**用户当前工作目录**运行的本地智能体：单一可执行入口 `nova`
（`packages/cli` bin），配置/会话/缓存全部集中在 `~/.nova/`，工作区零写入。
用户经 TUI / readline / `nova exec` / `nova qqbot` 四种形态驱动它；对外只有三个
跨信任边界的集成：**OpenAI 兼容 LLM 端点**（SSE 流式）、**models.dev**（模型目录）、
**QQ 开放平台**（WS 网关，仅 qqbot 模式）。

## 分层与依赖方向（核心架构事实）

七包 monorepo，依赖严格单向，且被 `pnpm gates`（`scripts/dep-direction.mjs`）机检：

- **内核层（零上游）**：`core`（provider 无关 agent 循环 + append-only 会话 JSONL v2 + 工具调度 + token 估算/修剪）、`tui`（零依赖终端原语）。二者不 import 任何 `@nova-agent/*`——实测 0 处，白名单 `[]` 强制。
- **能力层（只依赖内核）**：`ai`→core（**仅类型**，保持 provider 无关）、`plugins`→core（宿主+审批+内置工具+Skills+PTC）、`tui-view`→{tui, core}（零 IO 纯视图）。
- **渠道层**：`qqbot`→{core, plugins}——刻意做成"第三方插件示范"，只用公共 API。
- **产品壳**：`cli`→全部六包，是唯一 IO/装配点（TUI 壳层、三 runner、config 发现、exec）。

`ai` 与 `plugins` 互不依赖，都锚在 `core` 的类型契约上——这是"内核最小、一切皆插件"
的结构性落地：换 provider 不动宿主，加工具不动循环。

## 关键运行时关系

- `core.agent` 每轮经 `ai` 客户端向 provider 发 SSE 请求；`prompt_cache_key` + 会话亲和头把同会话钉在同一缓存节点（前缀缓存是核心差异化）。
- 工具调用全部穿 `plugins` 同一条管线（审批门 + 钩子 + 超时），PTC `run_code` 子调用经 `ctx.dispatch` 回流同一管线——结构性无特例。
- 会话日志先写盘后入内存（JSONL append-only）；工具溢出与压缩存档落 `~/.nova/cache/tool-outputs/`。

## 证据强度

包间每条边都有三重直证（dep-direction 白名单 = package.json = 源码 import 实测计数），**完全一致、无漂移**——见 `system-model.evidence.md`。

## 未知项（不作为已证事实呈现）

1. 各 provider 缓存参数语义差异（AGENTS.md §9.1 开放问题）——行为面，静态图不表达。
2. 外部插件安装（本地路径/git URL）——roadmap，未实现，未画入。

## 文件清单 / 重生成

- `system-context.dsl` — Structurizr：L1 上下文 + L2 容器（Canvas DSL 预览）
- `system-dependencies.dot` — Graphviz：包间依赖 + 外部集成（`dot -Tsvg` 渲染；边标签含 import 实测次数）
- `system-model.evidence.md` — 节点/边证据索引
- 依赖面变化后重跑 `pnpm gates` + evidence 文件中的 grep 命令即可校验本模型是否过时（或路由 `architecture-health` 做常态化校验）。
