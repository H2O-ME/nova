---
'@nova-agent/cli': minor
---

渠道实现出仓：`@nova-agent/qqbot` 迁出为独立产品（`D:\web\noa`，数据根 `~/.noa`），本仓不再发行任何渠道实现。

- cli 删除 `qqbot` 子命令与渠道 surface 的装配（`qqbot-surface.ts`、按行动态装载的 `qqbot-api.ts`），`nova` 的内置面只剩 web / repl / exec 三家；依赖白名单与行数预算同步去掉 `qqbot` 条目。
- 内核的**渠道位**不变：`surfaces` / `plugins.entries` 配置行与 `userQuestions` 推导照旧——第三方渠道包写一行即可接入，cli 源码不点名、白名单里也没有条目。
