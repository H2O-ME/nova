---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
'@nova-agent/web': minor
'@nova-agent/plugin-ptc': minor
'@nova-agent/qqbot': minor
---

**宿主不再认识「代码模式」这个词**，插件也不再把自己的 UI 住进宿主的界面。

- **契约瘦身**：`Kernel.codeMode()` / `setCodeMode()` 从 `packages/plugins/src/runtime-types.ts` 删除，`AgentSurfaceKernel` 同步不再声明它们——一个插件的能力不该住进每个 surface 都要实现的契约。取而代之的是 `Kernel.pluginConfig(id)` 与 `Kernel.pluginRpc()`（活读门面 `runtime-facade.ts`）。`PtcMode` 与 `tools.code` 配置段一起从 core 移除，cli 的 `/mode` 改为按**行 id** 读回那一行的 config（`cli/src/command-runner.ts` 的 `codeModeInForce`，默认 `both`），显示词汇是 cli 自己的三态文案 `cli/src/lines.ts`——它的依赖白名单里没有 `@nova-agent/plugin-ptc`。
- **界面按名特判全部删除**：WebUI 的 `codeMode` 状态、`set_code_mode` 客户端帧、`CODE_MODES` 表与 `CodeModeSelect` 组件；QQ 专用的 `QqbotSection` / `QqbotGuide` / `qqbot-view.ts` / `qqbot.*` 文案键，以及 `qqbot` / `save_qqbot` / `test_qqbot` 三个帧（`packages/web/src/qqbot-frames.ts`）与 `packages/cli/src/qqbot-api.ts` 的对应请求族。取而代之的是 `plugin_request` / `plugin_response` 这一对通用帧与一个通用页渲染器：**界面里没有一行按插件名分支的代码**。
- **`qqbot` 的导出面因此只剩两件事**：包内默认导出的 `Plugin`（凭据 schema、`qqbot_send` 工具、探针、设置页描述符，全在 `src/plugin.ts` 起的 fiber 内）与 `src/surface/mode.ts` 的 `nova qqbot` 认领 + 常驻。`createQqBotSurface` / `startQqBotBridge` / `qqBotRuntimeSeam` / `testQqBotConnection` / `QqBotLiveReading` 不再是公共面。**认领 ≠ 启动通道**：QQ 的通道是那一行插件自己的 fiber，行关着就没有 socket，所以这个 surface 起来后先问「通道在不在」，不在就报出该开哪一行、该填哪些字段（`QQ 机器人通道未启动：…`）。
- `packages/plugins/src/runtime-switch.ts` 的 `setPluginEnabled` 只写 `{ id, enabled }`，不再按档位分派到不同的名单；`packages/cli/src/config-read.ts` 的 QQ 专用读法一并删除（凭据的 raw 文档读法留在配置层，因为那是配置的规则）。
