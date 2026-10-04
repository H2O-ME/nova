---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': patch
---

关掉的 surface 行不再被认领——修「**面板里关掉的 surface 插件，重启后仍被拉起来执行 `start()`**」这一用户可见缺陷。

这是「关掉插件后 nova 启动时还在用它」的**同族**缺陷，不是用户最初报告的那个实例。报障走的是**另一条路**：`plugins.entries` 里那一行（例如 `@nova-agent/qqbot`）的开关 → 插件树的判定 → 不建 fiber → `apply` 不跑 → 没有 socket；**本次修复不覆盖那条路**（它已由插件树自己的开关负责）。本次修的是**配置声明并加载的 `surfaces` 行**——同一个形状（开关只决定面板显示，不决定谁在跑），另一处实现。`surfaces` 与 `plugins.entries` 是**两个配置字段**：前者是动态 surface 插件的模块 spec 列表，后者是内核插件的行；用户配置里没有 `surfaces` 键时本次修复对他不可见，因此这份改动主要是**面向第三方 surface 插件**的。

**根因：注册发生在装配之前，而开关只影响装配之后的那一次注册。** `cli/src/index.ts` 在**建内核之前**就把每个配置的 surface 注册进容器外的注册表，并在同一处 `registry.resolve()` 出赢家。某个 surface 自己的插件行（`surfacePlugin` 里 `ctx.effect(() => service.register(surface))`）只是**第二次**注册同一个实例，而且发生在装配之后——**对本次 `resolve()` 已经太晚**。于是 `enabled: false` 只产出 `options.disabled`（不建 fiber、不跑 `apply`），**没有任何东西把它从注册表里移除**：它仍然认领这次调用、`start()` 照跑（socket / HTTP 全起）。设置面板写下的开关因此只决定了「面板上显示什么」，从不决定「什么真的在运行」。旧行为还有一个次生缺陷：同一实例被注册**两次**，卸载时 disposer 的 `indexOf` 会摘掉**另一份**——一个已经 `resolve()` 并启动的 surface 会被静默摘出注册表。

**修复：注册之前先问「这一行是否启用」。**

- **`packages/cli/src/surfaces.ts`（主修）**：改为 `if (surfaceRowEnabled(surface, registry, entries)) registry.register(surface);`——关闭的行**不注册**，因此不参与 `resolve()`、不会被选中、`start()` 不执行。它不再认领之后，调用正常落到 `tail` 的内置默认面（浏览器面 / REPL），**启动不失败**（内置 `head`/`tail` 四家仍无条件注册，所以「无人认领」不会成为新的失败形态）。
- **`@nova-agent/core` 新增并导出 `rowEnabled(manifest, override?)`**（`PluginSwitch` 接口一并导出）：`isRequiredTier(tier) ? true : (override?.enabled ?? enabledByDefault(tier))`——「一行是否启用」的**唯一实现**，与它组合的两个档位谓词（`enabledByDefault` / `isRequiredTier`）住在一起。`plugins/src/plugin-tree.ts` 的三处判定（普通行、贡献行的 intent 覆盖、模块加载失败的占位行）改为调用同一个函数，于是「面板的开关」与「启动路径的录取」不再是两份会漂的实现。
- **`@nova-agent/plugins` 新增导出 `surfaceRowEnabled(surface, registry, entries)`**：用装配期**同一份** `surfacePlugin(surface, registry)` 造出那一行、套 `manifestOf`，再问 `rowEnabled`——判定对象逐字就是 roster 会为这个 surface 建的那一行，override 取 `plugins.entries` 里 id 等于 `surface.name` 的那一条（重复 id 取最后一条，与 `buildTree` 的读法一致：手写的重复行不能让两个读者得到两个答案）。surface 行不声明 manifest，因此按 `standard` 档默认。
- **`register` 按实例身份幂等**：同一实例再次注册不再追加，`all()` 不会把一个 surface 列两遍，fiber 卸载时的 disposer 也摘不掉**另一份**（先注册者保留它的优先级槽位）。两个**同名但不同实例**的 surface 仍然分别列出——那是配置错误，应当被解析器看见，而不是被去重吞掉。

**修复后的行为契约：**

- 操作者关掉的 surface 行**不注册** → 不参与 `resolve()` → `start()` 不执行；调用落到 `tail` 的默认 surface，启动不失败。
- 关掉的行**仍然出现在面板上**（可以再打开）：`SurfaceRows.loaded` 照带它，roster 仍为它画一行——**注册**与**建行**是两件事，在这里删掉它等于藏起那个把它打开的开关。
- **下次启动生效**：`resolve()` 每个进程只选一次，运行期关掉**当前正在服务**的那个 surface **不会**热停——这是一条明写的边界，不是缺陷。
- 同一实例在注册表里只出现**一次**。
- **内置认领行不受这道门管辖**（明写的边界）：`qqbot` / `exec` / `web` / `repl` 四家仍是无条件注册的内置行——它们没有一行配置可以关掉；`nova qqbot` 的通道开关是它那一行插件自己的 fiber，这个 surface 只认领并常驻，在 `start` 前按 roster 读数拒绝并点名「该打开哪一行、该填哪些字段」。本次修复管的是配置声明并加载的 `surfaces` 行。

契约在 `packages/cli/test/surfaces.test.ts` 里有直测断言：关掉的行不在注册表里、`loaded` 仍带它、`--web` 回落到内置 web；开启的行被认领；同一实例二次注册后该名字仍只有一条且 `resolve()` 仍选得中它。
