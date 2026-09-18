---
'@nova-agent/tui': patch
'@nova-agent/cli': patch
---

Terminal capability gates and focus re-assertion (M10 R6, ported from Grok Build): `detectCaps` now disables ?2026 synchronized output inside tmux (`TERM_PROGRAM=tmux` / `TMUX` set) — tmux repaints the whole pane when a sync block closes, so the wrapper amplifies paints there instead of preventing them; color is unaffected. `LineScreen` enables DEC 1004 focus reports and exposes `reassertModes()`; the TUI shell calls it on every focusin because Windows ConPTY relays can strip DEC private modes mid-session, silently degrading SGR mouse to X10 and painting raw mouse reports as escape garbage into the frame. `KeyDecoder` decodes `CSI I`/`CSI O` as new `focusin`/`focusout` key events (consumed at the chain head, never leaking into the composer).
