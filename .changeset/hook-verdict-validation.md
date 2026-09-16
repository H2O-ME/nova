---
'@nova-agent/core': minor
'@nova-agent/plugins': minor
---

Hook verdicts go structural: `ToolCallVerdict` is now a discriminated union (`allow` carries nothing, `deny` carries only `reason`, `rewrite` requires plain-object `args`), validated by the new `validateToolCallVerdict` pure function. The plugin host rejects malformed verdicts fail-closed (deny with an actionable reason) and rejects `beforeLLMCall` hooks that widen the tool set (narrowing, e.g. the PTC projection, still passes). `runAgent` re-validates at its own gate so hand-rolled `AgentHooks` implementations get the same fail-closed net. No built-in plugin changes behavior — none rewrites or widens.
