---
"@nova-agent/cli": patch
---

TUI 压缩可取消 + 进度可见：`/compact` 与自动压缩期间按 Esc/Ctrl+C 现在会中止摘要请求（与 REPL 的 compactAbort 对齐，此前 TUI 是唯一无法取消压缩的入口，卡住的压缩只能杀进程）；「正在压缩…」等待行实时显示已耗时，成功/取消行附带耗时。压缩请求的 AbortController 会在退出时一并清理，不再吊住进程。
