---
'@nova-agent/core': minor
'@nova-agent/web': minor
---

`@` 引用对齐 deepseek-harness：菜单、输入框与消息气泡三处的观感，外加两处实测才发现的缺陷修复。

**core：`list_files` 拆成两种语义（dsh `file-reference-local` 的切分）**

- 查询**带 `/`（或为空）= 活目录列表**：列出该目录自己的孩子，目录在前、按名字母序。此前带 `/` 的查询按子串匹配全工作区，下钻 `@src/` 看到的是满屏散件而不是 `src` 的内容——下钻机制因此形同虚设。空查询从「漫游全树的前 200 条」改为只列根目录的孩子。
- **裸词 = 模糊走**：维持原有的广度优先子串匹配。
- 点条目默认隐藏、查询以 `.` 开头才现身（敲 `.env` 找得到 `.env`）；目录路径越界（`../`）回空列表而非报错。两种模式都跳过 `.git`/`node_modules`/`dist`、绝不跟随符号链接。

**web/ui：@ 菜单效果对齐 dsh `MenuView` / `ui-reference`**

- **下钻面包屑头**：下钻（Tab / chevron）后菜单顶部钉出「根目录 → … → 当前」导航，当前步不可点，点击任一上级直接钻回该目录；手打的路径不出面包屑（dsh `crumbsFor` 同一规则）。有面包屑时行不再重复父目录描述。
- 行带 folder/file 图标（dsh `BrowseOutline` / `FolderClose` 逐路径移植）与「文件」节标题；排序从「文件在前」翻转为 dsh 的**目录在前**。
- 截断提示移到列表状态行（「结果已截断」），不再占用组标题。

**web/ui：mention 到处都画成 chip**

- 输入框与消息气泡都把 `@path` / `@"path with spaces"` 显示为药丸（品牌蓝字 + 圆角 + 浅底 + 文件/文件夹图标），**文本本身一个字节不改**——引用仍是用户本可以手打的文本，「model-visible ⟺ logged」不受影响。两处共用 `ui/src/mention-tokens.ts` 一条规则。
- 输入框没有富编辑器，用**同字体的镜像层**画在 textarea 后面、真文字透明只留光标；chip 的 padding 由等量负 margin 抵消，装饰不会移动它装饰的字。
- 裸 token 在**中文标点处断词**：`@src/main.ts，然后看` 不会把后半句吞进路径（`@"…"` 内不受影响）。这是对 dsh 规则的一处刻意偏离——dsh 的 chip 是原子插入的，我们的引用是普通文本，中文又没有空格。

**web：原生 pick 对话框置前 + PWA 不再停在旧界面**

- 对话框弹出后由脚本自己顶到最前（WinForms 定时器轮询 `SetWindowPos(HWND_TOPMOST)` + `SetForegroundWindow`）：后台宿主没有前台权，不这样做对话框开在浏览器后面，用户看到的就是「点了没反应」；选目录那条（`FolderBrowserDialog`）尤其如此。**刻意不用 dsh 的合成 Alt 按键**——Alt 是全球按键，在火狐里会弹出传统菜单栏。
- 脚本改用 `-EncodedCommand`（UTF-16LE 的 base64）传给 PowerShell：脚本里带中文标题/描述，这种形式对引号、转义和命令行重编码免疫，进程代码页与系统语言不再参与。
- 安装成 PWA 后不会再永远跑旧代码：页面重新可见时比对「服务器当前 index.html 指向的产物」与「自己正在跑的产物」，不同才自动刷新一次（每产物一次，`sessionStorage` 记账）。
