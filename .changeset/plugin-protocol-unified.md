---
'@nova-agent/plugins': major
'@nova-agent/qqbot': minor
'@nova-agent/web': patch
'@nova-agent/cli': patch
---

**插件协议统一：删除 legacy `{ name, activate(ctx) }` 门面，唯一协议是 core 的 `{ name, inject?, Config?, apply(ctx) }`。**

历史上有两套公共插件 API 并存：core 容器的 `Plugin`（`{ name, inject, Config, apply }`）与 Nova 自有的 `{ name, activate(ctx) }` / `PluginContext`（`registerTool` / `registerCommand` / `registerHook`）。后者在 `plugins/host.ts` 适配到容器上，形成「同一种能力、两套写法」。本次把它连根删除：

- **`packages/plugins/src/types.ts` 删除**，`host.ts` 的 legacy 适配层删除；`{ name, activate(ctx) }` 形态在任何类型、运行时分派、roster 校验里都不再被接受——只导出 **core 协议**的插件（函数 / 类 / `{ apply }` 对象）。
- **注册 idiom 收敛到一处**：`plugins/toolbox.ts` 的 `registerTool(ctx, def, permission)` / `registerCommand(ctx, def)`（每个注册都是容器 effect，卸载时逆序拆除）。所有内置插件（fs / search / bash / jobs / todo / workspace / subagent / ask-user / skills / goal / ptc）、qqbot 第三方示范、`plugins.extra` 的加载校验与测试夹具全部改走这条路。
- **`plugins.extra` 的模块契约相应收紧**：`extra` 导出的默认导出必须是一个 core `Plugin`，「带 `activate` 的旧形状」会被 `loadExtraPlugins` 明确拒绝（报错点名协议已换代），不再提供任何转换垫片——写自写插件的人改一行即可。
- **钩子改走容器事件缝**：goal / ptc 的 `beforeLLMCall` 从旧 `PluginContext` 钩子改为 `ctx.on(beforeLlmCall, (req, next) => …)`，与容器内其他监听器同一条 waterfall 派发。

### 顺带修掉一个真实运行时 bug

`core/plugin/events.ts` 的 `waterfall`：`next` 的类型与文档都说「spread 改写」`next(...rewritten)`，运行实现却一直是数组式 `next([...rewritten])`——于是按文档写的 `next({...req})` 会把**一个裸对象当整包参数**传下去、改写被静默丢掉，跑过链尾回收的是未改写版本。现实现改为 spread 语义，且在**链尾**（没人接管、也没人再 delegate）时返回**链上最后一个值**——「改写后放行」的委托在链尾也成立。`core/test/plugin.test.ts` 新增常驻回归用例钉住该语义（改回旧行为必红）。