---
'@nova-agent/plugins': patch
'@nova-agent/cli': patch
'@nova-agent/web': patch
---

**插件开关真生效：热开热关、跨重启持久、页面跟随；审批选择器回归输入框。**

### 关掉的不再「自动打开」（此前重启即复活）

`tools.code.mode: "ptc"` 与配置里的 `qqbot` 块都是第二个录取口，此前启动时**无条件**推导一条 `enable`：关掉插件只是移出列表，文件里没留下「关过」的痕迹，下次启动推导又把它打开。现在推导统一让位于显式 `disable`（`impliedOptIns`，boot `kernel-config.ts` 与 live `runtime-roster.ts` 同一规则），`ptc` / `qqbot` 两行的开关**两个方向都写**（关闭也写 `disable`），开关跨重启持久。

### 关掉 PTC 时模式不再自相矛盾

此前关掉 PTC 插件后 live 模式仍显示 ptc，设置与输入栏还能照选。现在：关闭时生效模式归回 `native`（文件保留操作者自己的 `tools.code.mode`，重新打开即恢复）；插件关闭期间 `setCodeMode` 对非 `native` 模式以中文原因拒绝——插件没加载的模式绝不运行；插件 flip 后浏览器立即收到 `state` 广播，模式 chip 不再停在旧值。

### 关掉的插件从页面消失

设置导航由**活 roster** 派生：QQ 机器人插件关闭后其设置页从导航消失；重开的门是它在「插件管理」里的行（关掉的行永不从面板消失，不会单向）。

### 连带修复：boot 期关闭的插件本进程永远打不开

重 roster 曾把启动文档的 `plugins.disable` 与 live 列表求并集，开关打开后又被这行加回来（`did not load after enabling`）。已改为以 live 列表为准。

### 审批权限选择器回归输入框（对齐 dsh）

此前它被挂到会话头部右上角；现在输入框在**每个会话**都带审批档与执行模式两个 chip，运行中仍可调审批档（dsh 的 `conversation.input.permission` 语义），执行模式运行中锁定。
