---
'@nova-agent/core': patch
'@nova-agent/plugins': patch
'@nova-agent/cli': patch
---

把「这个 surface 有没有人可回答 `ask_user_question`」的推导收口成一个 core 纯函数 `deriveUserQuestions(caps)`（返回 `answersQuestions ?? interactive ?? false`，fail-closed）。

此前这条规则在 `plugins/runtime-env.ts` 的服务端 provider 与 `cli/surface-host.ts` 的 `buildSurfaceRuntime` 各写一遍——规则若变，两处会不同步，且没有任何测试钉住。现在两个读它的地方共用这一个函数，规则变更先改函数、`core/test/user-question.test.ts` 先红。直测钉住：有人 surface 且有声明 ⇒ true、交互式 surface 缺省 ⇒ true、无人值守 ⇒ false、显式 `answersQuestions: false` 不会被 `interactive: true` 复活。
