---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
---

第三方插件有了可安装的落点与安装命令：**用户插件根** `~/.nova/plugins/` + `nova plugin add|remove|list`。

- **解析规则一处**（`plugins/src/module-spec.ts`）：路径按工作目录解析；裸包名先交给 Node；**只有产品解析不到的名字**才落到用户插件根——这是**回退而非遮蔽**，升级不会被用户几个月前装的同名旧副本静默顶掉。`plugins.extra` 与配置的 `surfaces` 行共用这一条规则。
- **`nova plugin add <包名>`**：npm 装进用户插件根 → 用 boot 同款检查（`loadExtraPlugins`）确认这个包真的导出了插件 → **最后**才写 `plugins.extra`；任一步失败都不留配置行（半装的插件不会把下次启动搞挂）。`remove` 顺序相反：先撤配置行、再卸包（剩下的包是惰性的，剩下的行会让启动失败）。`list` 逐行说明它会在哪被找到（用户插件根 / 随产品解析 / 本地路径 / 缺失）。
- **该命令在建内核之前、加载配置之前执行**：它要修的就是「`plugins.extra` 里一行加载不了 → 启动失败」这件事，所以不能依赖一次成功的启动。
- 新增公开导出：`resolvableFromProduct(spec)`（诊断某行是否随产品解析）、`isPlugin(value)`（插件形状检查，与 boot 同一实现）；core 新增路径 `userPluginsDir(homedir?)`。
- 装包走 `npm`（随 Node 自带，不假设用户用的是产品自己的包管理器）；仓库测试全程注入假安装器，不联网。
