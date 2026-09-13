---
"@nova-agent/core": patch
"@nova-agent/plugins": patch
"@nova-agent/tui-view": patch
"@nova-agent/cli": patch
---

后台子代理可见性 + 内置工具对 shell 的信息量反超：`JobRegistry` 快照新增 `startedAt`/`progress`（peek，不占模型输出游标），后台 subagent 的嵌套活动（N tools · 最近调用）喂入 TUI——每个运行中的后台委派钉一行 `⧉ 子代理 label · Ns · …`（自带刷新 interval，活过父轮仍更新），结束原位改写为状态+用量行。`list_dir` 输出携带文件字节数（不再输给 `ls -la`）；bash 子进程注入 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`（Windows 下 python heredoc 免手写编码样板）；系统提示的 `run_code` 引用改为模式中性表述。
