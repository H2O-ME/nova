---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
---

写清楚装载器的**能力边界**，免得被当成缺陷：`PluginLoader` reconcile 的是**配置树**——行的增删改、服务的替换与包裹、fiber 的挂载与卸载，并且 `id` 是身份，跨 reconcile 不变，所以重 roster（换工作区、一次开关、一次保存）是一次 **diff 而不是重建**（plugin 与 config 都没变的行保留它的 fiber，工具、服务与监听器不会被拆掉再装一遍）。**它不做 Node 模块代码热替换**——模块解析、`import()` 缓存失效、旧模块实例的回收都不在它的职责里（`packages/core/src/plugin/loader.ts` 头部与 `docs/plugin-architecture-refactor.md` 都已写明）。

因此「改一行插件的 `config` 或开关立刻生效」与「改一个插件模块的源码后不重启就生效」是两件事，只有前者成立。把「配置重载」误读成「代码热载」，会让人以为改完源码立刻能被验收——而 `pnpm dev`（tsx 直读源码）之外的场景必须重启进程。

同批钉住「插件出错是数据，不是崩溃」：导入与激活失败记在该行的 `error` 上并写日志，**绝不从 `create` / `update` / `reconcile` 抛出来**（与 dsh `vendor/loader/src/config/entry.ts` 的 `_init()` 同一条）。只有**编程错误**才抛：未知 id、重复 id、未知父行、一个没有插件的 group 行——这些是宿主自己的 bug，静默才是错的。
