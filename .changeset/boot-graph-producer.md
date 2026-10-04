---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
---

补齐「浏览器侧插件 bundle（boot graph）」的**生产者那一半**。

**根因**：这条缝的消费端（`App.tsx` 调 `loadBootGraph(rosterEntries)`）与透传端（`web/src/roster-wire.ts`）都在，但**插件无处声明 `clientBundle`，`describePlugins` 也从不写这个字段**——`PluginManifest` 只有四个键（`title` / `description` / `tier` / `page`），于是 wire 上永远是 `undefined`，`entriesToLoad` 恒为空，`loadBootGraph` 恒为空转。类型齐全、`grep` 有 15 处、直测全绿、`pnpm gates` 绿——静态证据与真闭环长得一模一样，这正是本仓「只写不读 / 假闭环」缺陷族在同一处连栽两次的第二踩。

- **`core`**：`PluginManifest` 增可选 `clientBundle?: PluginClientBundle`（新类型 `{ path?: string; rev?: string }`）。**英文 JSDoc** 明说语义：这是插件的浏览器侧 bundle；**缺席＝纯服务端插件（多数情况）**；声明了就会被 boot graph 带给浏览器装载器。形状只有一个定义（`PluginClientBundle`），manifest 的声明与 roster 行的 boot-graph 条目**同形**，不各写一份。
- **`plugins`**：`PluginDescriptor` 增同名字段（`page` 一并补上——`describePlugins` 早就在写它，类型却漏了），`describePlugins` 按本文件既有风格**条件展开**映射 `row.manifest.clientBundle`：声明的照抄，没声明的键**不出现**（不是 `null`、不是空对象）。宿主仍**不认识任何插件名**——不知道谁有浏览器半，只认识「一行」。

**证据**（临时 home + 固定 `NOVA_WEB_PORT`，绝不碰真实配置）：一个从用户插件根按包名加载的第三方插件（真 kernel 的真 `roster()`）声明 `clientBundle: { path: 'client.js', rev: 'rev-r1' }` 并用自己的 `ctx.must(routes)` 在 `/plugins/<name>/` 下提供 `client.js`。`ready` 帧里该行原样带出 `{"path":"client.js","rev":"rev-r1"}`；headless Edge（CDP）打开界面后，浏览器**自己**发出 `GET /plugins/<name>/client.js?rev=rev-r1`（HTTP 200，插件自己的 handler 记到 hit），`window.__NovaPlugins__["<name>"]` 被填。对照插件（`todo`，未声明）该键**缺席**、其 `/plugins/todo/client.js` 为 404。直测一条（`packages/web/test/manage-frames.test.ts`：真 kernel → 真 `WebController` → `ready` 基线），撤掉 `describePlugins` 那一行即变红（已跑过变异验证）。
