# packs/ —— 随产品发行的 ZCode 插件包

本目录每个子目录是一个 **pack**：ZCode 目录格式的插件包（`.zcode-plugin` / `.claude-plugin` /
`.nova-plugin` 三种 manifest 目录名任选其一，内含 `plugin.json` + `skills/` + `commands/` +
`hooks/hooks.json`）。加载器在 `packages/plugins/src/pack-loader.ts`，发现与开关在
`pack-install.ts`，hooks 执行在 `hook-run.ts` / `hook-bridge.ts`。

## 发现顺序

`packages/cli/src/kernel-boot.ts` 的三级根：

1. `~/.nova/plugins/<name>/` —— 已安装的包（安装器写这里，用户也可手放）
2. `plugins.dirs[]` —— 操作者指到 checkout 的额外根
3. **本目录（`<repo>/packs`）** —— 随产品发行；打包后是 `<resources>/runtime/packs`

前两级里出现的包同名覆盖第三级：操作者自己装的那份优先，产品自带的让位。

## 开关（两级不同默认，务必分清）

| 根 | 缺省状态 | 理由 |
| --- | --- | --- |
| 已安装 / `plugins.dirs` | **开** | 把包放进这两个根，本身已经表达了「我要用它」 |
| 随产品发行（本目录） | **关** | 产品携带 ≠ 用户要跑。包的 hooks 以当前用户权限执行本地命令，且有的（如 mimosa）会往扫描根旁边写状态——默认开就会破坏「工作区零写入」这条产品不变量 |

所以随包发行的包要**显式安装**才生效，一行即可：

```json
{ "plugins": { "entries": [{ "id": "pack:mimosa", "enabled": true }] } }
```

安装后要停用，把同一行改成 `"enabled": false` 或删掉那一行。

一个包同时贡献四种面，各有各的门控：

| 面 | 门控 |
| --- | --- |
| skills | 包被加载即注册 |
| commands | 同上 |
| hooks | **包开着就执行**——与 ZCode 一致，`hooks.enabled` 是配置文件 hooks 的总闸，不是插件 hooks 的 |
| 单条 hook | 该定义写 `"enabled": false` 即跳过（runner 真跳过，不是 UI 置灰） |

## 当前随包发行

| 包 | 版本 | 来源 | 说明 |
| --- | --- | --- | --- |
| `mimosa` | 1.0.4 | ZCode 官方市场（MIT） | 安全扫描器。见 `mimosa/VENDORED.md` |

## 加一个新包

把 ZCode 插件目录整个拷进来即可，不用改本仓源码：

```bash
cp -r <某 ZCode 插件目录> packs/<name>
```

要求：`plugin.json` 里 `name` 与目录名可以不同（发现以 manifest 的 `name` 为准做开关匹配）。
本仓不消费包的 `mcpServers` / `.mcp.json` —— **MCP 集成尚未实现**，这类声明会被忽略而不报错。
