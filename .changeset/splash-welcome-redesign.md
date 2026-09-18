---
'@nova-agent/tui-view': minor
'@nova-agent/cli': patch
---

开屏重做成**一张居中卡片**（Grok welcome 二稿）：`buildSplash` + 独立的选择器块合成单一 `buildWelcome`——工作区 / 会话（家目录前缀折成 `~/…`）/ 技能计数 / 模式选择器 / 沙箱姿态五行同处一框，粗框线 + 水平垂直双向居中（首轮提交前把视口空白挪到卡片上方，消掉整屏空洞；选择器塌缩不跳宽）。figlet ASCII logotype 与 模型·审批·模式 复读行一并删除，按键提示寄生在空 composer 占位行（`composerPlaceholder`），且光标独占一格、不再吃掉占位文本首字。模式选择器改为框内单行分段控件：反色胶囊 = 光标，已生效档位带 `•`，尾注明说「将切到 X / 当前模式」；**状态栏不再并排三档芯片**（与卡片选择器重复且互相矛盾），只报当前档。`SplashInfo`→`WelcomeView`：删 `model`/`approval`/`codeMode` 与 `buildSplash`/`modeSelectRows`/`modeSelectedRow`，增 `home` 与 `codeMode`；`StatusView.pristine` 移除；`frameMap` 增 `topPad`（点击行号先减合成空白）。
