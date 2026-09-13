---
"@nova-agent/tui-view": patch
"@nova-agent/cli": patch
---

开屏页重设计：splash 顶部加 ASCII figlet 版字 logo（窄终端自动省略），信息盒下新增交互式执行模式选择块——↑↓/滚轮移动、Enter 确认、Esc 保持当前、直接打字立即开始（首条提交自动塌缩为确认行）；Node < 22.19 时 PTC/混合行置灰并在移动中跳过；选择器为纯视图函数 + 按键责任链新层，块原位塌缩不留交互残骸；`toggleCodeMode` 抽出 `setCodeMode` 供 Tab 循环与开屏选择共用。
