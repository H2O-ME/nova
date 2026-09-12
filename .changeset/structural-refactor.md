---
'nova-agent': patch
'@nova-agent/core': patch
'@nova-agent/ai': patch
'@nova-agent/plugins': patch
'@nova-agent/tui': patch
'@nova-agent/tui-view': patch
'@nova-agent/cli': patch
---

Structural refactor: extracted createSessionRuntime (packages/cli/src/session-runtime.ts) merging the ~60-line duplicated session/client/host/skills/fragment startup across all three runners (exec/repl/tui); runtime exposes reloadWorkspaceContext for workspace switches so fragment closures stay consistent. TuiStore convergence: removed all three `as any`/`as unknown as TuiStore` casts from tui-mode.ts by fixing structural compatibility (sessionPicker/approval types already matched; appendTail implemented inline; blocksVersion wired as getter; onChange made public on TuiStore). store.ts onChange promoted from private constructor param to public field for structural assignability.
