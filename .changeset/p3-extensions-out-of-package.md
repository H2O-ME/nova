---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
'@nova-agent/plugin-subagent': minor
'@nova-agent/plugin-context': minor
'@nova-agent/plugin-ptc': minor
---

扩展能力出包（2026-10-01 定规的首批落地）。`subagent` / `context` / `ptc` 从 `@nova-agent/plugins` 拆成独立包（`@nova-agent/plugin-subagent` / `plugin-context` / `plugin-ptc`），由内核按 spec 表**在启用时**动态装载：包缺席或加载失败只在该插件行上留一条 `error`（`origin: 'extension'`），启动与重排照常。同批渠道面去静态化：cli 源码对渠道包零静态 import，装载只剩一处动态 import——缺失时明确报「扩展不可用」，`nova --web` 静默降级并把原因显示在设置页。

- `core` 新增 `registerTool` / `registerCommand`（注册原语搬到能力 key 旁边，使扩展包只依赖 core，避免 plugins ⇄ 插件包的依赖环）与 `typeStrippingAvailable`（search 与 PTC 两个 worker 共用的唯一探测）；`plugins` 原样 re-export 两个注册函数，既有公开面不变。
- `CreateKernelOptions.extensionSpecs`：覆写扩展包的模块 spec（测试注入缺失模块；操作者替换实现）。
- 插件行新增 `origin: 'extension'` 与可选 `error` 字段；`plugins.disable` 的错名告警把扩展名视为已知。
