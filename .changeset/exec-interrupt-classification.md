---
"@nova-agent/cli": patch
---

`nova exec` 回补中断归类（ffdc595 契约漏了第三个 runner）：SIGINT 真正解绕运行时不再误发 `run_error`（退出码 1）——现在 `--json` 下发 `{"type":"notice","text":"任务已中断（SIGINT）…"}`、人类输出亮「已中断」、进程退出码 130（惯例 SIGINT 语义）；错误文案含 "aborted" 的网络超时仍照常走 `run_error` + 退出码 1，与 repl/TUI 的「归类以本轮 signal 是否触发为准」对齐。
