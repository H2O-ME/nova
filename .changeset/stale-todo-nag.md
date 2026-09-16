---
'@nova-agent/core': patch
---

Stale-plan nudge: the loop now counts assistant tool turns without a persisted `todo/write` snapshot and, after three, injects one ephemeral reminder into the next request (same request-scoped channel as job notices — never logged, never in the compaction projection, re-armed when the carrying request dies). Detection keys on the durable session event, not the tool name; pure-Q&A turns never count.
