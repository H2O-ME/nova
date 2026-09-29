---
'@nova-agent/core': minor
'@nova-agent/cli': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
---

**模型端重做：大小写无关的 id 对账、配置 `models[]` 名单、设置页能力编辑器。** 起因是一个真实的断线：端点对模型 id **大小写敏感**（`deepseek-v4-flash` → 503，`DeepSeek-V4-Flash` → 200），于是「模型列表打不开、切换无效」。

- **id 按当前端点的名单对账，绝不硬编码拼写**（core）。`core/model-id.ts`：`resolveModelId(configured, available)` 三趟匹配（精确 → 唯一大小写无关 → 唯一标点无关），歧义时保留调用方原样而不是猜；`sameModelId(a, b)` 是同一规则的判等（空串先短路，`''` 不等于 `''`）。`kernel-config.ts` 异步化（`createProvider` → `resolveProviderModel`），先问端点再决定请求里写什么名字。**大小写是单个站点的命名怪癖，不是可写进配置的事实。**
- **能力有三级优先级**（core）。新增 `core/model-catalog-rules.ts`：配置 `models[].<field>` → models.dev → 未知。合并**逐字段**（`??` 而非 `||`，所以显式 `false` / `0` 存活）且是**覆盖而非重述**——只写 `id` 的条目照样从 models.dev 拿到窗口与模态。**未知是合法答案**：占用环不画百分比，而不是继承上一个模型的数字或猜一个窗口。
- **配置新增顶层 `models[]`**（cli / core）。非空即**全量接管**菜单（站点没公布的 id 也能选，被移除的不会再出现），`catalogIds` 保证**在役模型永远在列**（菜单得答得出「我在跟谁说话」）。读写落在新的 `cli/src/config-models.ts`（从 `config-read.ts` / `config-write.ts` 按职责拆出）：读**活取**而非捕获数组（否则设置页保存后菜单要到重启才变），写整份替换、空列表删除该键、`{env:MY_KEY}` 引用在往返后保持为引用（改写原始文本，不写回展开后的对象）。
- **设置页可增删模型、逐字段改能力**（web/ui）。新增 `ModelConfigEditor`：自动值为占位符（「自动」），手动填写的值覆盖它——两者的差就是操作者在偏离什么。id 用 `<datalist>` 从**端点公布的名单**里选，避免把命名怪癖抄错。协议新增客户端帧 `list_model_config` / `save_models` 与服务端帧 `model_config {models, published, automatic}`。
- **`AgentSession` 仍没有 `setModel`**：切换依旧是 `ChatProvider.setModel()` 原地改写同一客户端 → `announceModel()` 发事件。窗口未知时**清空分母**而不是沿用上一个模型的数字。

**测试**：新增 `core/test/model-catalog-rules.test.ts`（15 条：逐字段合并、显式 `false` 存活、配置全量接管、拼写对账、在役模型恒在列、去重）。`core/test/model-id.test.ts` 补 13 条。

**同批修掉的两个过程性缺陷**（不是产品行为，但每次开发都在付代价）：

- **`pnpm test` 不再污染真实 `~/.nova`**（根）。此前隔离靠每个测试自己记得调 `withFakeHome`，而**五个套件忘了**——含建真内核跑在临时工作区、会话日志却写进开发者真实主目录的 `plugins/test/runtime.test.ts`，累积了 600+ 个垃圾会话。现在 `vitest.config.ts` 的 `setupFiles` 指向 `packages/test-setup.ts`，在任何测试模块加载前把 `USERPROFILE` / `HOME` 指向临时目录。**会被人忘掉的规则等于没有规则。**
- **结构棘轮的行数上限带余量**（根）。上限原是「当前行数」，于是每个文件一落地就在 100%：门禁只会在收尾时说「你已经超了」，说不出「你快超了」，结果每次都要为十几个文件做**批量返工拆分**。现在上限 = `当前行数 + max(10, 10%)`，且每次运行都会打印剩余不足 10 行的文件（出现在 `pnpm check` 快环里，写代码时就能看见）。纯转出桶（只含 `export *` / `export { … } from`）不再计行数——它的长度是模块条数而非设计属性。
