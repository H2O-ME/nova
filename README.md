# NovaAgent

自研、插件化、轻量化的跨平台本地智能体框架。一个在当前工作目录运行的 agent CLI/TUI——通过任意 OpenAI 兼容端点对接模型，以"一切皆插件"的内核统一扩展工具、命令、钩子与 Skills；数据全部落在 `~/.nova/`，工作区零写入。

> 📖 **完整文档见 [AGENTS.md](./AGENTS.md)**（架构、设计、命令、约定、里程碑的唯一权威来源）。本 README 仅作门面。

## 快速开始

```bash
pnpm install
pnpm build
pnpm nova            # 交互运行（TTY 全屏 TUI；非 TTY 回落 readline）
```

配置在 `~/.nova/config.json`（唯一来源，`apiKey` 支持 `{env:NAME}`）：

```jsonc
{
  "provider": { "baseURL": "https://api.example.com/v1", "apiKey": "{env:MY_KEY}", "model": "model-name" },
  "approval": "read-only"          // read-only | auto-edit | full
}
```

```bash
pnpm nova -- --approval auto-edit                 # 临时覆盖审批档位
pnpm nova -- exec "修复失败的测试" --json          # 非交互单次执行（CI 友好）
```

## 常用命令

```bash
pnpm dev        # tsx 直跑 cli（免构建）
pnpm test       # vitest
pnpm lint       # oxlint
pnpm verify     # build + typecheck + test
```

更多：命令面板（`/` 唤起）、Tab 循环执行模式、PTC 代码模式、后台 jobs、Skills、模型元数据（models.dev）等——见 [AGENTS.md](./AGENTS.md)。
