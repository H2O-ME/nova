---
'@nova-agent/core': minor
---

删除 `pluginLoaded` 事件键（`plugin/loaded`）：它自始只有声明、全仓无生产者与消费者。按本项目「新增能力键的前提是已经有人消费它」的纪律收口——`packages/core/src/plugin/index.ts` 不再导出 `pluginLoaded`，用 `plugin/loaded` 字符串订阅的插件需一并删除（此前也收不到任何事件）。
