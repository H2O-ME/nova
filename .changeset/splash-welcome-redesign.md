---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

开屏重做（Grok welcome 移植）：面板只留**去处**（工作区根 / 会话根，家目录前缀折成 `~/…`）并按终端列数居中成 hero 框——删掉 figlet ASCII logotype，删掉 模型 · 审批 · 模式 行（状态栏独占身份，开屏不再复读）。启动模式选择器从 5 行列表换成**单行分段控件** `执行模式 [普通]│[PTC]│[混合]`（选中段反色胶囊、↑↓ 只挪胶囊、塌缩前后同占一行不跳版；窄屏整字段降级：先丢说明再丢按键最后裁剪）。原「提示」行的按键知识迁进空 composer **占位提示** `composerPlaceholder`（选择器在架教 `↑↓ 选模式`、塌缩后教 `/ 命令面板 · Esc 中断 · Ctrl+C×2 退出`，光标落在占位首字、一打字即消失）。`SplashInfo` 破坏性变更：删 `model`/`approval`/`codeMode`，增必填 `home`（仅显示用，真实值仍在 `/session`）。
