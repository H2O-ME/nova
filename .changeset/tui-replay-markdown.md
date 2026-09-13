---
"@nova-agent/cli": patch
---

TUI 会话切换（`/session` 选择器）的回放面过同一 markdown 渲染：此前实时流式回答经 markdown 渲染（粗体/标题/列表/围栏），切回历史会话却推裸文本——同一回答两套观感。现在回放的 assistant 消息走 `renderMarkdownLite`，实时与 resume 长得一样。
