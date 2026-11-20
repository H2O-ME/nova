---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
'@nova-agent/web': minor
'@nova-agent/plugin-ptc': minor
---

**宿主不再认识「代码模式」这个词**，插件也不再把自己的 UI 住进宿主的界面。

- **契约瘦身**：`Kernel.codeMode()` / `setCodeMode()` 从 `packages/plugins/src/runtime-types.ts` 删除，`AgentSurfaceKernel` 同步不再声明它们——一个插件的能力不该住进每个 surface 都要实现的契约。取而代之的是 `Kernel.pluginConfig(id)` 与 `Kernel.pluginRpc()`（活读门面 `runtime-facade.ts`）。`PtcMode` 与 `tools.code` 配置段一起从 core 移除，cli 的 `/mode` 改为按**行 id** 读回那一行的 config（`cli/src/command-runner.ts` 的 `codeModeInForce`，默认 `both`），显示词汇是 cli 自己的三态文案 `cli/src/lines.ts`——它的依赖白名单里没有 `@nova-agent/plugin-ptc`。
- **界面按名特判全部删除**：WebUI 的 `codeMode` 状态、`set_code_mode` 客户端帧、`CODE_MODES` 表与 `CodeModeSelect` 组件，以及按插件名硬编码的专用帧族与请求族。取而代之的是 `plugin_request` / `plugin_response` 这一对通用帧与一个通用页渲染器：**界面里没有一行按插件名分支的代码**。
- `packages/plugins/src/runtime-switch.ts` 的 `setPluginEnabled` 只写 `{ id, enabled }`，不再按档位分派到不同的名单；`packages/cli/src/config-read.ts` 的渠道专用读法一并删除（凭据的 raw 文档读法留在配置层，因为那是配置的规则）。
