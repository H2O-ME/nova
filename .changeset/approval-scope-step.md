---
'@nova-agent/plugins': minor
'@nova-agent/cli': patch
---

审批「总是允许」粒度可交互调节（Grok 组件6 移植）：弹窗选中 always 行时 ←/→ 调整授权词数（命令前 N 词实时预览、Enter/a 携带 `{answer:'always', scopeWords:N}`）；PermissionService 按**词前缀匹配**放行同前缀命令（`git status` 范围放行 `git status -sb`、不波及 `git commit`），N 越界/复合命令回落默认记忆粒度，畸形 grant fail-closed 拒绝；AskFn 返回值加宽（仍接受原 AskAnswer 字符串），弹窗提示行补全列裁剪。
