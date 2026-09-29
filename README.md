![NovaAgent —— 自研、插件化、轻量化的跨平台本地智能体框架](assets/readme/hero.svg)

# NovaAgent

自研、插件化、轻量化的跨平台本地智能体框架——一个在**当前工作目录**运行的 agent 运行时：通过任意 OpenAI 兼容端点对接模型，内核收拢为**插件容器 + 事件流句柄**（`Context` / `AgentSession` / `KernelEvent`），工具、斜杠命令、生命周期钩子、Skills 与**能力服务**全部经插件注册，界面只是同一内核事件流的消费者（浏览器 UI / readline / headless / QQ bot 地位相同）。所有数据（配置 / 会话 / 缓存 / 技能）集中在 `~/.nova/` 下，**运行目录零写入**。

![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-339933)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6)
![ESM-only](https://img.shields.io/badge/ESM--only-green)
![Tests 2018 passing](https://img.shields.io/badge/tests-2018%20passing-2ea44f)
![Version 0.4.0](https://img.shields.io/badge/version-0.4.0-e8a13c)

> 完整设计、约定与里程碑见 [AGENTS.md](./AGENTS.md)（人机共读的**唯一权威文档**）；版本号遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)，公共 API 定义见其 §8。

## 快速开始

```bash
pnpm install
pnpm build
pnpm nova            # 交互运行：TTY 上起浏览器界面（打印带 launch token 的 localhost URL）
```

配置写在 `~/.nova/config.json`（唯一来源，`apiKey` 支持 `{env:NAME}` 引用环境变量）：

```jsonc
{
  "provider": {
    "baseURL": "https://api.example.com/v1",
    "apiKey": "{env:MY_KEY}",
    "model": "model-name"
  },
  "approval": "read-only",          // read-only | auto-edit | full
  "plugins": {                       // 配置层的能力选择与扩展：不改源码即可增删能力
    "disable": ["todo"],             // 关掉内置插件
    "extra": ["./my-plugin.mjs"]     // 加载自己写的插件
  }
}
```

任意 OpenAI 兼容端点均可对接——填好 `baseURL` 与 `model` 即跑。之后：

```bash
nova                               # 浏览器界面（本机单进程 HTTP+WS，打印带 token 的 URL）
nova --tui                         # 终端全屏界面（alternate screen + 原始键盘；需 stdin/stdout 都是 TTY）
nova --repl                        # 只用终端（readline）
nova -- --approval auto-edit       # 临时覆盖审批档位
nova -- --resume ~/.nova/sessions/2026/09/23/<id>.jsonl
nova exec "修复测试" --json         # 非交互单次执行（JSONL 事件流，CI 友好）
nova qqbot                         # QQ 机器人通道
```

## 形态与架构

| Surface | 形态 | 说明 |
| --- | --- | --- |
| **浏览器 UI**（默认） | `nova` | 单 Node 进程：HTTP 静态托管 + 单 WebSocket 内核事件流；launch token → HMAC 签名 HttpOnly cookie（仅本机）；前端 React 18 + Vite，状态归一处纯 reducer，视觉系统整体移植 deepseek-harness（三层 token / 明暗双档 / 三栏 AppFrame / composer 胶囊 / 真 diff 工具卡） |
| **终端 TUI** | `nova --tui` | 终端全屏界面：alternate screen + 原始键盘 + 一条内核订阅，与浏览器面**同构**（事件进、帧出）；批准与提问都是接管卡；**管道下自动回落 `--repl`**（绝不朝管道画帧），显式 opt-in |
| readline REPL | `nova --repl` | 终端最低保障（非 TTY 自动回落）：斜杠命令、审批 y/n/a + 拒绝理由、流式进度行 |
| headless | `nova exec --json` | 非交互单次执行，`KernelEvent` JSONL 事件流，never 审批（未放行即拒绝） |
| QQ bot | `nova qqbot` | 渠道插件示范：每对端独立会话，只依赖 core/plugins 公共 API |

![架构](assets/readme/architecture.svg)

九个包（八个受依赖白名单管辖）、依赖严格单向（`pnpm gates` 机检）：`core`（内核 + 插件容器，零上游）← `ai` / `plugins` ← `web` / `tui-app` / `qqbot` ← `cli`（唯一 IO 与装配点）；`tui` 是**零依赖**的渲染底座（字符格 + 按键，不认识内核），所以任何包都能依赖它而不产生环。内核装配收口在 `plugins` 的 `createAgentKernel()`，**有三个调用点**：cli 的 `bootKernel()`（exec / repl / qqbot 经它装配）、`packages/web` 的 `WebController.create()`、以及 `packages/cli/src/surface-host.ts` 的 `buildSurfaceRuntime()`（任何动态 surface 插件——含 `--tui`——经它装配）。后两者**自己装配、不经 `bootKernel`**——浏览器面需要 `modelCatalog` 与 provider 的模型标签/窗口，终端面需要装配期间的 holder 绑定，两者 `BootOptions` 都装不下。所以「`nova` 默认形态走 `bootKernel`」是错的：默认形态恰恰是绕过它的那个。**有一个装配项需要每个 surface 都在场**：`userQuestions`（默认 false 且 fail-closed），否则 `ask_user_question` 只会回模型一句「没有接收者」——工具在、UI 在、提问永远不发生。动态 surface（含 `--tui`）由 `buildSurfaceRuntime` 从 `surface.answersQuestions ?? surface.interactive` 推导，不用手抄。

- **一切皆插件**：工具 / 命令 / 钩子 / 能力服务（approval、llm、sessions、compaction、jobs、spill、skills、tools、commands）全部经 Cordis 式容器注册，可按键替换；`plugins.disable` / `plugins.extra` 让开发者**不改源码**就能选择、替换或扩展任一能力。
- **运行有迹可循**：`/plugins` 打印插件 roster（名字 / 状态 / 注入的服务）；每次运行都是一条 `KernelEvent` 流，每轮以 `run_stats` 收尾（时长 / 首 token / 吞吐 / 缓存命中）。
- **稳定前缀 = 高缓存命中**：系统提示字节稳定，动态内容按 append-only 注入会话首条片段；请求级修剪（snip/micro）+ 原位压缩 + 供应商会话亲和头。

![一轮任务的流转](assets/readme/turn-flow.svg)

![上下文与缓存](assets/readme/context-cache.svg)

## 常用脚本

```bash
pnpm test        # vitest（无网络：ai 层注入 fetch + SSE fixture）
pnpm verify      # build + typecheck + test + gates（提交前）
pnpm check       # lint + gates + 变更相关测试（秒级快环）
pnpm smoke:web   # 真机冒烟浏览器界面（走真 provider，21 项）
```

## 许可

MIT
