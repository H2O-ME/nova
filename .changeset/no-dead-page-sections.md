---
'nova-web-ui': minor
---

设置导航不再给出**永远答不了的页**：一个声明了 `page: true` 但 `apply()` 抛错的插件，此前仍会在设置导航里得到一节，点进去永远没有答案。

- **现象**：`roster` 那一行是 `{ state: 'failed', enabled: true, page: true }`——`enabled` 仍为真（操作者确实要它开），`page` 声明也在（它确实提供页），而 `apply()` 已经抛错。`pagePlugins()` 旧判据只看前两个字段，于是这一节照画；点进去界面发一条 `plugin_request`，`op` 为 `page`，收到的是 `no loaded plugin answers "…"`——`pluginRpc` 命名空间挂在 fiber 上，而那个 fiber 已经不在了。用户看到的是一个**不可达的入口**，且它不会自愈。
- **修法**：`pagePlugins()`（`packages/web/ui/src/settings/plugin-state.ts`）的判据从「声明了页且没被关掉」收紧为「声明了页、没被关掉、**且真的活着**」——白名单 `state === 'active'`，不是 `state !== 'failed'` 黑名单（`pending` / `loading` 还没跑 `apply`、`disposed` 已拆、未知相位同样证明没有命名空间，「没报故障」≠「有活 fiber」）。`enabled` 仍是**操作者意图**的事实，保持不改：「关着」与「开着但坏了」在插件管理面板上仍是两件不同的事，面板必须能说出后者，而导航只给活着的页。这是与「关掉插件仍在跑」**同族**的形状（一处呈现读了半个事实），但**不是**那一个实例——本次是「一行失败后仍提供不可达的入口」，管的是**设置导航的入口集合**。
