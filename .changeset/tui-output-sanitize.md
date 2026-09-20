---
'@nova-agent/tui': minor
---

Display sanitizer for external content (M10 R1, ported design from Grok Build's terminal_output emulation). New `@nova-agent/tui` export `sanitizeForDisplay`: keeps SGR sequences, strips every other escape (CSI cursor moves/erases, OSC, private modes, stray ESC), normalizes `\r\n`, drops lone `\r` without ever adding newlines, expands tabs, and removes C0/C1/DEL. Wired at three points: `LineScreen.render` (the TUI choke point — a `\x1b[2K` riding in a frame line used to execute on the real screen while the diff cache remembered stale text, desyncing rendering until `invalidate()`), `toolDoneLine` content, and `toolArgSummary` results. Width math now runs after sanitizing, so stripped bytes no longer inflate styledWidth and trigger phantom `…` truncation.
