---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
'@nova-agent/plugin-ptc': patch
---

PTC 保存改为**逐键补丁**，并把三处小缺陷一并收掉。

- **`@nova-agent/plugin-ptc`（主修）**：设置页的 `save` 原来把展开后的**整份** config 交给 `PluginConfigPort.setEntry`，而端口的契约是**逐键**合并进磁盘上的原样行（「操作者手写的 `{env:NAME}` 引用不会被展开后的密钥顶掉」）。整份提交让这个保证在 PTC 这一行失效——今天它的两个键都不是秘密所以无症状，加任何 secret 类设置即踩。现在 `ptcSavePatch(fields)` 只校验并解出**表单真正提交的键**（空串仍是「不改」，未知键照旧点名拒绝），`setEntry` 收到的是补丁；页面回显仍用合并后的视图（`ptcSaveSettings` 保留为纯合成函数）。直测：只提交 `mode` 时，落盘补丁恰为 `{ mode }`，未提交的 `maxParallelSubCalls` 不被写入。
- **`@nova-agent/core`**：`ctx.plugin()` 的数组形态原来**静默只加载第一个元素**——成员无声消失、无任何报错，正是本仓到处拒绝的缺陷形状。现在单元素数组照旧收下，长度非 1 一律点名抛错（全仓无调用方传数组，仅封住陷阱）。
- **`@nova-agent/plugins`**：`setSkillEnabled` 一次翻开关跑两遍全量技能扫描——`skills` 服务的 `reload()` 内部就是同一次 `loadWorkspace`，删掉调用点重复的那次。
