---
"@nova-agent/tui": patch
"@nova-agent/cli": patch
---

composer 词级移动：KeyDecoder 的 CSI 方向键此前丢弃全部参数，`1;5C`（Ctrl+Right）被静默解成普通 right——现在保留修饰键参数并产出 `ctrl+left`/`ctrl+right`（其余修饰组合回落普通方向，行为不变）；composer 绑定 Ctrl+←/→ 词级光标移动（切词边界与 Ctrl+W 一致）。
