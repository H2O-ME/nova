---
'@nova-agent/core': patch
'@nova-agent/ai': patch
'@nova-agent/plugins': patch
'@nova-agent/tui': patch
'@nova-agent/tui-view': patch
'@nova-agent/cli': patch
---

Unified TokenGate (auto-compact.ts shared by all runners): preflight uses anchor-or-full-estimate so resume of a large session can no longer blow the context window on its first request; compactConversation/compactSession accept an optional AbortSignal forwarded to the summarizer. always-approval scope narrows compound commands to the whole normalized chain. TUI error path discards uncommitted partial assistant blocks (screen/log divergence fix); REPL gets an equivalent dim hint. agentTurn gets a catch guard so errors outside the event loop surface as blocks, not unhandled rejections.
