---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
---

`wrapAutoCompact` 幂等化——修「**每次重排都再包一层自动压缩门，fuse 后一层门一次总结压缩**」的潜伏缺陷。

**根因**：组合后的 `AgentHooks` 按容器根缓存（`composeHooks` 的 WeakMap），身份跨重排稳定；而 `reroster`（工作区切换、插件开关、插件保存都会走）每次都调 `wrapHeadlessCompact` → `wrapAutoCompact`，后者直接 `hooks.beforeLLMCall = …` 叠层，没有任何防重标记。平时无害（内层压完外层看到低于阈值就跳过），但一旦进入 `compact_fused` 状态（压缩后仍超限），各层各持自己的 `fused` 标志——**N 层包装 = 一次请求跑 N 次总结压缩、写 N 套 compaction 日志事件**。

**修复**：`wrapAutoCompact` 对同一 hooks 对象只包一次（模块级 `WeakSet`，已包即早退）。压缩上限来自内核自己的 config、在内核生命周期内不变，所以第一次包装就是它需要的全部；headless 自动压缩的语义（请求内原位压缩 + fuse 停用）逐字不变。

直测：`packages/cli/test/auto-compact.test.ts` 新增断言——同一 hooks 对象 wrap 两次后，超限请求只压一次、fuse 后第二次请求不再压。
