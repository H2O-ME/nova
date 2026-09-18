---
'@nova-agent/tui': patch
---

Empty-frame drop and cursor-action dedup in `LineScreen` (M10 R2, design ported from Grok Build's presenter): a render whose frame is byte-identical to the previous one and whose hardware-cursor target hasn't moved now writes **zero bytes** — not even the ?2026 synchronized-output wrapper. Idle animation ticks on SSH/Windows consoles stop paying the write-amplification tax. The cursor `MoveTo` is only re-emitted when its target changes or when the frame actually rewrote rows (row writes land the physical cursor at their tail, which invalidates the remembered position).
