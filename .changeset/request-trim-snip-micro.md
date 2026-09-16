---
'@nova-agent/core': patch
---

Request-level middle compression: new pure `request-trim.ts` (`groupMessages` / `snipMessages` / `microMessages` / `trimRequestMessages`) runs between the `beforeLLMCall` chain and the ephemeral notice tails in `assembleRequest` — snip drops whole middle tool groups past 50 (head 3 + marker + tail), micro ages older tool result bodies into re-runnable placeholders keeping the newest 3 groups verbatim. Units are atomic tool groups (never message indices), inputs are never mutated, and the trimmed snapshot lives on a fresh array so the in-place auto-compact alias contract, the canonical log, and the compaction projection stay intact.
