# mimosa —— 从 ZCode 插件移植

本目录是 ZCode 官方插件 **mimosa** 的原样移植（vendored），用于验证并交付「Nova 的插件包（pack）体系兼容 ZCode 插件格式」这一能力。

## 来源

| 项 | 值 |
| --- | --- |
| 上游 | `https://github.com/kael-odin/zcode-plugins-zh`（官方 ZCode 市场同源） |
| 版本 | `1.0.4` |
| 许可证 | MIT · Copyright (c) 2026 Mimosa（见同目录 `LICENSE`） |
| 移植方式 | **逐字节复制**，未修改任何文件 |

## 为什么原样复制而不重写

本仓 `AGENTS.md` §3 的 ZCode 参照纪律要求「禁止拷贝代码入库（确需移植：重写为本仓风格 + Apache 2.0 来源标注 + 向用户说明）」。

mimosa 是这一纪律的**例外**，理由是它的形态：它不是本仓要吸收的**实现**，而是一个要被**加载的输入**。

- 外壳（`plugin.json` / `hooks.json` / `commands/` / `skills/`）遵 MIT。
- 载荷（`payload/dist`、`payload/assets`、`payload/rules`）是 Mimosa 的加密分发产物（`DELIVERY-MANIFEST.json`：`AES-256-GCM`、`keyEmbedded`、`plaintextShipped: false`）。**重写它既不可能（源码不在包内）也没有意义（本仓不打算维护一套安全扫描引擎）。**
- 本仓的角色是**宿主**：`packs/mimosa` 是「一个第三方 ZCode 插件包」的样本与默认随附能力，通过 `plugins/src/pack-loader.ts` 加载，与本仓源码解耦——升级只需替换这个目录。

因此：**原样 vendored，许可证与版权声明随包保留**，本仓源码不含任何 mimosa 代码。

## 提供的贡献

| 面 | 内容 |
| --- | --- |
| Skill | `mimosa-security-scan`（1 个） |
| Commands | `/mimosa-deep-audit`、`/mimosa-scan`、`/mimosa-status` |
| Hooks | `PreToolUse`×2（Edit/Write/MultiEdit、Bash）、`PostToolUse`×2、`UserPromptSubmit`、`SessionStart`、`Stop` |
| 变量 | `engine`（`userConfig`，默认 `native`；MCP 深扫引擎） |
| MCP | `.mcp.json` 声明 `mimosa` stdio 服务（**本仓的 MCP 集成尚未实现**，该声明当前不被消费） |

## 运行要求

- **Node.js 必须在 PATH 中**：所有 hook 都是 `node <root>/hooks/run-hook.cjs …`，与 ZCode 一致。
- hook 以**当前用户权限**执行本地代码 —— 这正是 `hooks.enabled` 默认关闭的原因（见 `AGENTS.md`）。
- 首次使用时扫描引擎会向项目内 `.mimosa/` 与用户数据目录写状态；不写插件安装目录。

## 与上游的差异（本仓侧适配）

包文件**零改动**。适配全部在宿主侧：

| 差异 | 说明 |
| --- | --- |
| `${ZCODE_PLUGIN_ROOT}` | 解析为本目录（`hook-run.ts` 同时认 `CLAUDE_PLUGIN_ROOT` / `NOVA_PLUGIN_ROOT`） |
| `${user_config.engine}` | 由 pack 的 `userConfig.default` 提供；当前 MCP 未实现，值仅作为 `${engine}` 变量暴露给 hook |
| 工具 hook 的 `additionalContext` | 本仓暂拼进工具结果文本（ZCode 走独立附件通道），已在 `hook-bridge.ts` 注明 |
| `updatedInput` | 本仓不改写工具参数（未实现二次 schema 校验），hook 给出该字段时按「拒绝」处理 |

## 启用与关闭

本包在 `packs/` 里，属**随产品发行**的一级，所以**默认关闭**——产品携带不等于要跑它，
而它确实会往扫描根旁边写 `.mimosa/` 状态（见上文），默认开就破坏了「工作区零写入」。

启用：在 `~/.nova/config.json` 写一行

```json
{ "plugins": { "entries": [{ "id": "pack:mimosa", "enabled": true }] } }
```

停用：把该行改成 `"enabled": false`，或删掉该行（停在默认关闭）。

- 单条 hook 关闭：在 `hooks/hooks.json` 里给该定义写 `"enabled": false`（runner 真跳过，不是 UI 置灰）。
- **`hooks.enabled` 只管配置文件的 hooks，不管插件的**：与 ZCode 一致（`docs/hooks-runtime-contract.md` 契约 3
  「插件 hooks 只在插件启用时注入 runtime」/ 契约 2「单个受信配置来源的 enabled:false 只禁用该来源内的 hooks，
  不能关闭其他来源」）。装了本包并给了 `enabled: true`，它的 hooks 就会跑——**这是插件的授权模型，不是配置模型的**。
